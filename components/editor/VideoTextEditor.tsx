import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Type, Palette, Clock, Move, Plus, Trash2, AlignLeft, AlignCenter, AlignRight, KeyRound, Save, X, Pencil, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TimelineClip, TextClip, TextKeyframe } from '@/types';
import { FontStyle } from './FontEditor';
import { useLocalFonts } from '@/lib/useLocalFonts';
import { getTextValuesAtTime } from '@/lib/text-keyframes';
import { useI18n } from '@/lib/i18n';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface VideoTextClip extends TextClip {
  id: string;
}

interface VideoTextEditorProps {
  textClips: VideoTextClip[];
  onAddTextClip: (clip: Omit<VideoTextClip, 'id'>) => void;
  onUpdateTextClip: (id: string, updates: Partial<VideoTextClip>) => void;
  onDeleteTextClip: (id: string) => void;
  currentTime: number;
  videoDuration: number;
  customStyle?: FontStyle;
  pendingStyleApplication?: { nonce: number; style: FontStyle } | null;
  onSeek?: (time: number) => void;
}

const FONTS = [
  'Custom Style ✨',
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
];

const DEFAULT_COLORS = [
  '#FFFFFF', // Blanco
  '#000000', // Negro
  '#FF0000', // Rojo
  '#00FF00', // Verde
  '#0000FF', // Azul
  '#FFFF00', // Amarillo
  '#FF00FF', // Magenta
  '#00FFFF', // Cian
];

/** Convierte segundos a "MM:SS" (ej: 165 → "02:45") */
function formatSecondsToMmSs(seconds: number): string {
  const s = Math.max(0, Number(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const secPart = sec % 1 === 0 ? String(Math.floor(sec)).padStart(2, '0') : sec.toFixed(1);
  return `${String(m).padStart(2, '0')}:${secPart}`;
}

/** Parsea "MM:SS" o "M:SS" a segundos (ej: "02:45" → 165). Acepta decimales en segundos "02:45.5" */
function parseMmSsToSeconds(str: string): number {
  const trimmed = String(str).trim();
  if (!trimmed) return 0;
  const match = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (match) {
    const m = Math.max(0, parseInt(match[1], 10));
    const s = Math.max(0, parseFloat(match[2]));
    return m * 60 + s;
  }
  const asNumber = parseFloat(trimmed);
  return !isNaN(asNumber) && asNumber >= 0 ? asNumber : NaN;
}

/** Input de tiempo en formato MM:SS; valor en segundos, máximo ajustado a la duración del vídeo */
function TimeInput({
  value,
  max,
  onChange,
  label,
  className,
}: {
  value: number;
  max: number;
  onChange: (seconds: number) => void;
  label?: string;
  className?: string;
}) {
  const [localStr, setLocalStr] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const { t } = useI18n();

  const displayValue = isFocused ? localStr : formatSecondsToMmSs(value);
  const safeMax = Math.max(0, max);

  const handleFocus = () => {
    setIsFocused(true);
    setLocalStr(formatSecondsToMmSs(value));
  };

  const handleBlur = () => {
    const s = parseMmSsToSeconds(localStr);
    if (!isNaN(s)) {
      const clamped = Math.max(0, Math.min(safeMax, s));
      onChange(clamped);
    }
    setIsFocused(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalStr(e.target.value);
  };

  return (
    <div className={className}>
      {label && (
        <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{label}</Label>
      )}
      <Input
        type="text"
        inputMode="numeric"
        placeholder="00:00"
        value={displayValue}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        className="text-sm bg-gray-950 border-gray-600 text-white font-mono focus:border-emerald-500"
        title={t('videoEditor.text.timeFormatTitle', { max: formatSecondsToMmSs(safeMax) })}
      />
    </div>
  );
}

// ResizableTextarea component
const ResizableTextarea = ({ value, onChange, placeholder, className, textAlign = 'left' }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  textAlign?: 'left' | 'center' | 'right';
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [height, setHeight] = useState(60);
  const { t } = useI18n();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = `${height}px`;
    }
  }, [height]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startY;
      const newHeight = Math.max(40, Math.min(200, startHeight + deltaY));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full resize-none p-2 text-sm bg-gray-950 border-gray-600 text-white placeholder:text-gray-500 focus:border-emerald-500 transition-colors rounded-md custom-scrollbar ${className}`}
        style={{ 
          height: `${height}px`,
          textAlign: textAlign
        }}
      />
      <div
        className={`absolute bottom-0 right-0 w-6 h-6 cursor-se-resize ${isResizing ? 'bg-emerald-500' : 'bg-gray-600'} rounded-tl-md opacity-70 hover:opacity-100 transition-opacity flex items-center justify-center`}
        onMouseDown={handleMouseDown}
        title={t('videoEditor.text.resizeTitle')}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 10L10 2M10 6V2H6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
};

export default function VideoTextEditor({
  textClips,
  onAddTextClip,
  onUpdateTextClip,
  onDeleteTextClip,
  currentTime,
  videoDuration,
  customStyle,
  pendingStyleApplication,
  onSeek,
}: VideoTextEditorProps) {
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [listHeight, setListHeight] = useState(120);
  const [isResizingList, setIsResizingList] = useState(false);
  const { toast } = useToast();
  const { t } = useI18n();

  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace } = useLocalFonts();

  const renderLocalFontOptions = () =>
    localFonts.length === 0 ? null : (
      <>
        <SelectItem value="__local_fonts_sep__" disabled className="text-gray-400 text-[11px] uppercase font-bold">
          {t('editorHTML.text.localFonts')}
        </SelectItem>
        {localFonts.map((f) => (
          <SelectItem key={f.family} value={f.family} style={{ fontFamily: f.family }} className="focus:bg-emerald-500 focus:text-white">
            {f.name}
          </SelectItem>
        ))}
      </>
    );

  // --- Keyframes de texto (espejo de VideoObjectEditor) ---
  const [editingKfId, setEditingKfId] = useState<string | null>(null);
  const [isNewKf, setIsNewKf] = useState(false);
  const [snapshot, setSnapshot] = useState<TextKeyframe | null>(null);

  // Al cambiar de texto seleccionado cerramos la sesión de edición de instante.
  useEffect(() => {
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  }, [selectedClipId]);

  const handleListResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingList(true);
    const startY = e.clientY;
    const startHeight = listHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startY;
      setListHeight(Math.max(80, Math.min(400, startHeight + deltaY)));
    };

    const handleMouseUp = () => {
      setIsResizingList(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const [newTextClip, setNewTextClip] = useState<Omit<VideoTextClip, 'id'>>({
    text: '',
    fontSize: 24,
    fontFamily: 'Custom Style ✨',
    color: '#FFFFFF',
    backgroundColor: '#000000',
    position: { x: 50, y: 50 }, // Porcentaje
    startTime: currentTime,
    duration: 5,
    opacity: 100,
    textAlign: 'center',
    backgroundBlur: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: '#000000',
    shadowBlur: 0,
    shadowOffset: 0,
    shadowColor: '#000000',
  });

  const selectedClip = textClips.find(clip => clip.id === selectedClipId);

  // --- Keyframes del texto seleccionado (movimiento/animación, igual que objetos) ---
  const hasKeyframes = !!(selectedClip?.keyframes && selectedClip.keyframes.length > 0);
  const sortedKeyframes = useMemo(
    () => (selectedClip?.keyframes ? [...selectedClip.keyframes].sort((a, b) => a.time - b.time) : []),
    [selectedClip?.keyframes],
  );
  const currentLocalTime = selectedClip ? clamp(currentTime - selectedClip.startTime, 0, selectedClip.duration) : 0;
  const editingKf = sortedKeyframes.find((k) => k.id === editingKfId) ?? null;

  const updateKeyframe = (kfId: string, partial: Partial<TextKeyframe>) => {
    if (!selectedClip) return;
    const next = (selectedClip.keyframes || []).map((k) => (k.id === kfId ? { ...k, ...partial } : k));
    onUpdateTextClip(selectedClip.id, { keyframes: next });
  };

  const deleteKeyframe = (kfId: string) => {
    if (!selectedClip) return;
    const next = (selectedClip.keyframes || []).filter((k) => k.id !== kfId);
    onUpdateTextClip(selectedClip.id, { keyframes: next });
    if (editingKfId === kfId) {
      setEditingKfId(null);
      setSnapshot(null);
      setIsNewKf(false);
    }
  };

  const startNewKeyframe = () => {
    if (!selectedClip) return;
    let time = currentLocalTime;
    if ((selectedClip.keyframes || []).some((k) => Math.abs(k.time - time) < 0.05)) {
      time = clamp(time + 1, 0, selectedClip.duration);
    }
    const cur = getTextValuesAtTime(selectedClip, currentTime);
    const newKf: TextKeyframe = {
      id: `kf-${selectedClip.id}-${Date.now()}`,
      time,
      x: Math.round(cur.x),
      y: Math.round(cur.y),
      fontSize: clamp(Math.round(cur.fontSize), 8, 120),
      opacity: Math.round(cur.opacity),
    };
    onUpdateTextClip(selectedClip.id, { keyframes: [...(selectedClip.keyframes || []), newKf] });
    setEditingKfId(newKf.id);
    setIsNewKf(true);
    setSnapshot(null);
    onSeek?.(selectedClip.startTime + time);
  };

  const startEditKeyframe = (kf: TextKeyframe) => {
    setEditingKfId(kf.id);
    setIsNewKf(false);
    setSnapshot({ ...kf });
    onSeek?.(selectedClip!.startTime + kf.time);
  };

  const finishEditing = () => {
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  };

  const cancelEditing = () => {
    if (editingKfId) {
      if (isNewKf) {
        deleteKeyframe(editingKfId);
      } else if (snapshot) {
        updateKeyframe(editingKfId, { ...snapshot });
      }
    }
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  };

  // Los mandos (X/Y/Tamaño/Opacidad) editan el instante en vivo (si hay sesión) o
  // el clip base (sin keyframes). Análogo a VideoObjectEditor.
  const sliderVals = editingKf
    ? { x: editingKf.x, y: editingKf.y, fontSize: editingKf.fontSize, opacity: editingKf.opacity }
    : selectedClip
      ? { x: selectedClip.position.x, y: selectedClip.position.y, fontSize: selectedClip.fontSize, opacity: selectedClip.opacity }
      : { x: 0, y: 0, fontSize: 24, opacity: 100 };

  const onSliderChange = (field: 'x' | 'y' | 'fontSize' | 'opacity', value: number) => {
    if (!selectedClip) return;
    if (editingKf) {
      updateKeyframe(editingKf.id, { [field]: value });
    } else if (!hasKeyframes) {
      if (field === 'x' || field === 'y') {
        onUpdateTextClip(selectedClip.id, { position: { ...selectedClip.position, [field]: value } });
      } else {
        onUpdateTextClip(selectedClip.id, { [field]: value } as Partial<VideoTextClip>);
      }
    }
  };

  const mapFontStyleToTextClipUpdates = (style: FontStyle): Partial<VideoTextClip> => ({
    text: style.text,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: style.color,
    backgroundColor: style.backgroundColor,
    backgroundOpacity: style.backgroundOpacity,
    backgroundBlur: style.backgroundBlur,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    shadowBlur: style.shadowBlur,
    shadowOffset: style.shadowOffset,
    shadowColor: style.shadowColor,
    isBold: style.isBold,
    isItalic: style.isItalic,
    isUnderline: style.isUnderline,
  });

  useEffect(() => {
    if (!pendingStyleApplication) return;

    const updates = mapFontStyleToTextClipUpdates(pendingStyleApplication.style);

    if (selectedClipId) {
      onUpdateTextClip(selectedClipId, updates);
      return;
    }

    setIsAddingNew(true);
    setNewTextClip((prev) => ({
      ...prev,
      ...updates,
    }));
  }, [pendingStyleApplication?.nonce]);

  const handleAddNewClip = () => {
    if (!newTextClip.text.trim()) {
      toast({
        title: t('videoEditor.text.emptyError'),
        description: t('videoEditor.text.emptyDesc'),
        variant: 'destructive',
      });
      return;
    }

    // Si la fuente es Custom Style, aplicamos los estilos del FontEditor
    let finalClip = { ...newTextClip };
    if (newTextClip.fontFamily === 'Custom Style ✨' && customStyle) {
      finalClip = {
        ...finalClip,
        fontFamily: customStyle.fontFamily,
        fontSize: customStyle.fontSize,
        color: customStyle.color,
        backgroundColor: customStyle.backgroundColor,
        backgroundOpacity: customStyle.backgroundOpacity,
        backgroundBlur: customStyle.backgroundBlur,
        borderRadius: customStyle.borderRadius,
        borderWidth: customStyle.borderWidth,
        borderColor: customStyle.borderColor,
        shadowBlur: customStyle.shadowBlur,
        shadowOffset: customStyle.shadowOffset,
        shadowColor: customStyle.shadowColor,
        isBold: customStyle.isBold,
        isItalic: customStyle.isItalic,
        isUnderline: customStyle.isUnderline,
      };
    }

    onAddTextClip(finalClip);
    setNewTextClip({
      ...newTextClip,
      text: '',
      startTime: currentTime,
    });
    setIsAddingNew(false);
    
    toast({
      title: t('videoEditor.text.added'),
      description: t('videoEditor.text.addedDesc'),
    });
  };

  const handleUpdateSelectedClip = (updates: Partial<VideoTextClip>) => {
    if (!selectedClipId) return;
    onUpdateTextClip(selectedClipId, updates);
  };

  const handleDeleteSelectedClip = () => {
    if (!selectedClipId) return;
    onDeleteTextClip(selectedClipId);
    setSelectedClipId(null);
    
    toast({
      title: t('videoEditor.text.deleted'),
      description: t('videoEditor.text.deletedDesc'),
    });
  };

  const getActiveTextClips = () => {
    return textClips.filter(clip => 
      currentTime >= clip.startTime && 
      currentTime < clip.startTime + clip.duration
    );
  };

  return (
    <div className="space-y-1 mt-14 pt-0 relative overflow-visible">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
      
      {/* Lista de textos existentes */}
      <div className="space-y-1 overflow-visible">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Type className="h-4 w-4" />
            {t('videoEditor.text.textsInVideo', { count: textClips.length })}
          </Label>
        </div>

        <div className="relative group/list">
          <div 
            className="space-y-1 bg-black/20 rounded-md p-1 border border-white/5 custom-scrollbar"
            style={{ height: `${listHeight}px`, overflowY: 'auto', overflowX: 'visible' }}
          >
            {textClips.map((clip) => {
              const isActive = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
              const isSelected = selectedClipId === clip.id;
              
              return (
                <div
                  key={clip.id}
                  className={`flex items-center justify-between p-2 rounded-md border cursor-pointer transition-all group/card relative ${
                    isSelected 
                      ? 'border-emerald-500 bg-white shadow-lg text-black z-10' 
                      : isActive 
                        ? 'border-green-500 bg-green-600/20 text-white' 
                        : 'border-white/10 bg-white/5 text-white hover:bg-white hover:text-black hover:z-20'
                  }`}
                  onClick={() => setSelectedClipId(clip.id)}
                >
                  {/* Tooltip flotante - Aparece arriba de la tarjeta */}
                  {clip.text.length > 25 && (
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[300px] pointer-events-none opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 z-[9999]">
                      <div className="bg-gray-900 text-white text-xs p-4 rounded-xl border border-emerald-500/50 shadow-[0_10px_40px_rgba(0,0,0,0.8)] leading-relaxed relative">
                        <div className="text-emerald-400 font-black uppercase text-[10px] mb-1 tracking-widest">{t('videoEditor.text.content')}</div>
                        <div className="text-gray-100">{clip.text}</div>
                        {/* Flecha apuntando hacia abajo */}
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 border-l border-b border-emerald-500/50 rotate-45" />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 truncate">
                    <Type className={`h-4 w-4 ${
                      isSelected ? 'text-emerald-600' : 
                      isActive ? 'text-green-400' : 
                      'text-gray-500 group-hover/card:text-emerald-600'
                    }`} />
                    <span className="text-sm font-bold truncate pr-2">
                      {clip.text.length > 25 ? clip.text.substring(0, 25) + '...' : clip.text}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`flex flex-col items-end px-3 py-2 rounded-xl border shadow-sm ${
                      isSelected ? 'bg-black/5 border-black/10 text-black' : 'bg-white/10 border-white/5 text-gray-100 group-hover/card:bg-black/5 group-hover/card:border-black/10 group-hover/card:text-black'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 opacity-90 text-emerald-500 group-hover/card:text-black" />
                        <span className="text-[15px] font-mono font-black tracking-normal">
                          {clip.startTime.toFixed(1)}s <span className="opacity-30">→</span> {(clip.startTime + clip.duration).toFixed(1)}s
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTextClip(clip.id);
                        if (selectedClipId === clip.id) setSelectedClipId(null);
                      }}
                      className="h-8 w-8 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {textClips.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-4 text-muted-foreground text-sm opacity-50">
                <Type className="h-8 w-8 mb-2" />
                <p>{t('videoEditor.text.noTexts')}</p>
              </div>
            )}
          </div>
          
          {/* Tirador para redimensionar la lista */}
          <div
            className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-12 h-1.5 cursor-ns-resize rounded-full transition-all ${
              isResizingList ? 'bg-emerald-500 w-24' : 'bg-gray-700 hover:bg-gray-500'
            }`}
            onMouseDown={handleListResizeMouseDown}
            title={t('videoEditor.text.resizeListTitle')}
          />
        </div>
      </div>

      {/* Botón de Añadir siempre visible como cabecera de la sección de formulario si no hay nada activo */}
      {!isAddingNew && !selectedClip && (
        <div className="flex items-center justify-end p-2">
          <Button
            size="sm"
            onClick={() => setIsAddingNew(true)}
            className="h-9 px-4 text-[10px] font-black uppercase tracking-widest text-emerald-400 border-2 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_25px_rgba(16,185,129,0.2)] hover:border-emerald-500/50 transition-all duration-500 rounded-xl"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t('videoEditor.text.addNewText')}
          </Button>
        </div>
      )}

      {/* Formulario para añadir nuevo texto */}
      {isAddingNew && (
        <div className="space-y-2 p-2 bg-transparent">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">{t('videoEditor.text.addNewText')}</h4>
            <Button
              size="sm"
              onClick={() => setIsAddingNew(true)}
              disabled={true}
              className="bg-emerald-600/50 cursor-not-allowed opacity-50"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('videoEditor.text.addText')}
            </Button>
          </div>
          
          <div className="space-y-3 mt-2">
            <div>
              <Label htmlFor="new-text" className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.text')}</Label>
              <ResizableTextarea
                value={newTextClip.text}
                onChange={(value) => setNewTextClip({ ...newTextClip, text: value })}
                placeholder={t('videoEditor.text.textPlaceholder')}
                className="border"
                textAlign={newTextClip.textAlign}
              />
            </div>

            <div>
              <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.alignment')}</Label>
              <div className="flex gap-1 bg-black/20 p-2 rounded-lg border border-white/5">
                <Button
                  size="sm"
                  variant={newTextClip.textAlign === 'left' ? 'default' : 'outline'}
                  onClick={() => setNewTextClip({ ...newTextClip, textAlign: 'left' })}
                  className="flex-1"
                >
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={newTextClip.textAlign === 'center' ? 'default' : 'outline'}
                  onClick={() => setNewTextClip({ ...newTextClip, textAlign: 'center' })}
                  className="flex-1"
                >
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={newTextClip.textAlign === 'right' ? 'default' : 'outline'}
                  onClick={() => setNewTextClip({ ...newTextClip, textAlign: 'right' })}
                  className="flex-1"
                >
                  <AlignRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.font')}</Label>
                  <button
                    type="button"
                    onClick={loadLocalFonts}
                    title={t('editorHTML.text.refreshLocalFonts')}
                    className="mb-2 text-gray-400 hover:text-emerald-400 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${localFontsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <Select value={newTextClip.fontFamily} onValueChange={async (value: string) => {
                  const lf = localFonts.find((f) => f.family === value);
                  if (lf) await ensureLocalFontFace(lf);
                  setNewTextClip({ ...newTextClip, fontFamily: value });
                }}>
                  <SelectTrigger className="text-sm bg-gray-950 border-gray-600 text-white focus:border-emerald-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {FONTS.map(font => (
                      <SelectItem key={font} value={font} className="focus:bg-emerald-500 focus:text-white">{font}</SelectItem>
                    ))}
                    {renderLocalFontOptions()}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.size')}</Label>
                <Input
                  type="number"
                  min="8"
                  max="120"
                  value={newTextClip.fontSize}
                  onChange={(e) => setNewTextClip({ ...newTextClip, fontSize: Number(e.target.value) })}
                  className="text-sm bg-gray-950 border-gray-600 text-white focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.textColor')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={newTextClip.color}
                    onChange={(e) => setNewTextClip({ ...newTextClip, color: e.target.value })}
                    className="w-10 h-10 p-0 border border-gray-600 cursor-pointer rounded-lg bg-gray-950"
                  />
                  <Input
                    value={newTextClip.color}
                    onChange={(e) => setNewTextClip({ ...newTextClip, color: e.target.value })}
                    className="text-sm flex-1 bg-gray-950 border-gray-600 text-white font-mono focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.bgColor')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={newTextClip.backgroundColor}
                    onChange={(e) => setNewTextClip({ ...newTextClip, backgroundColor: e.target.value, backgroundOpacity: 100 })}
                    className="w-10 h-10 p-0 border border-gray-600 cursor-pointer rounded-lg bg-gray-950"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewTextClip({ ...newTextClip, backgroundOpacity: 0 })}
                    className={`flex-1 text-[10px] uppercase font-bold ${newTextClip.backgroundOpacity === 0 ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' : 'border-gray-600 text-gray-400'}`}
                  >
                    {t('videoEditor.text.transparent')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <TimeInput
                  label={t('videoEditor.text.startTime')}
                  value={newTextClip.startTime}
                  max={videoDuration}
                  onChange={(s) => setNewTextClip({ ...newTextClip, startTime: s })}
                />
              </div>

              <div>
                <TimeInput
                  label={t('videoEditor.text.duration')}
                  value={newTextClip.duration}
                  max={Math.max(0, videoDuration - newTextClip.startTime)}
                  onChange={(s) => setNewTextClip({ ...newTextClip, duration: Math.max(0.1, s) })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.position')}</Label>
              <div className="grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-lg border border-white/5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posX', { value: newTextClip.position.x })}</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={newTextClip.position.x}
                      onChange={(e) => setNewTextClip({ ...newTextClip, position: { ...newTextClip.position, x: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
                      className="w-20 h-8 text-xs bg-gray-950 border-gray-600 text-white"
                    />
                  </div>
                  <Slider
                    value={[newTextClip.position.x]}
                    onValueChange={([value]) => setNewTextClip({ ...newTextClip, position: { ...newTextClip.position, x: value } })}
                    min={0}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posY', { value: newTextClip.position.y })}</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={newTextClip.position.y}
                      onChange={(e) => setNewTextClip({ ...newTextClip, position: { ...newTextClip.position, y: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
                      className="w-20 h-8 text-xs bg-gray-950 border-gray-600 text-white"
                    />
                  </div>
                  <Slider
                    value={[newTextClip.position.y]}
                    onValueChange={([value]) => setNewTextClip({ ...newTextClip, position: { ...newTextClip.position, y: value } })}
                    min={0}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-white/5">
              <Label className="text-xs text-green-400 font-bold mb-2 block uppercase text-center">{t('videoEditor.text.opacity', { value: newTextClip.opacity })}</Label>
              <Slider
                value={[newTextClip.opacity]}
                onValueChange={([value]) => setNewTextClip({ ...newTextClip, opacity: value })}
                min={0}
                max={100}
                step={5}
                className="w-full px-2"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddNewClip}>
              {t('videoEditor.text.addText')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsAddingNew(false)}>
              {t('videoEditor.text.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Editor de texto seleccionado */}
      {selectedClip && !isAddingNew && (
        <div className="space-y-2 p-2 bg-transparent">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">{t('videoEditor.text.editSelected')}</h4>
            <Button
              size="sm"
              onClick={() => {
                setSelectedClipId(null);
                setIsAddingNew(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('videoEditor.text.addText')}
            </Button>
          </div>
          
          <div className="space-y-3 mt-2">
            <div>
              <Label htmlFor="edit-text" className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.text')}</Label>
              <ResizableTextarea
                value={selectedClip.text}
                onChange={(value) => handleUpdateSelectedClip({ text: value })}
                placeholder={t('videoEditor.text.textPlaceholder')}
                className="border"
                textAlign={selectedClip.textAlign}
              />
            </div>

            <div>
              <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.alignment')}</Label>
              <div className="flex gap-1 bg-black/20 p-2 rounded-lg border border-white/5">
                <Button
                  size="sm"
                  variant={selectedClip.textAlign === 'left' ? 'default' : 'outline'}
                  onClick={() => handleUpdateSelectedClip({ textAlign: 'left' })}
                  className="flex-1"
                >
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={selectedClip.textAlign === 'center' ? 'default' : 'outline'}
                  onClick={() => handleUpdateSelectedClip({ textAlign: 'center' })}
                  className="flex-1"
                >
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={selectedClip.textAlign === 'right' ? 'default' : 'outline'}
                  onClick={() => handleUpdateSelectedClip({ textAlign: 'right' })}
                  className="flex-1"
                >
                  <AlignRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.font')}</Label>
                  <button
                    type="button"
                    onClick={loadLocalFonts}
                    title={t('editorHTML.text.refreshLocalFonts')}
                    className="mb-2 text-gray-400 hover:text-emerald-400 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${localFontsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <Select value={selectedClip.fontFamily} onValueChange={async (value: string) => {
                  const lf = localFonts.find((f) => f.family === value);
                  if (lf) await ensureLocalFontFace(lf);
                  handleUpdateSelectedClip({ fontFamily: value });
                }}>
                  <SelectTrigger className="text-sm bg-gray-950 border-gray-600 text-white focus:border-emerald-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {FONTS.map(font => (
                      <SelectItem key={font} value={font} className="focus:bg-emerald-500 focus:text-white">{font}</SelectItem>
                    ))}
                    {renderLocalFontOptions()}
                  </SelectContent>
                </Select>
              </div>

              {(!hasKeyframes || editingKf) && (
                <div>
                  <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.size')}</Label>
                  <Input
                    type="number"
                    min="8"
                    max="120"
                    value={sliderVals.fontSize}
                    onChange={(e) => onSliderChange('fontSize', clamp(Number(e.target.value) || 8, 8, 120))}
                    className="text-sm bg-gray-950 border-gray-600 text-white focus:border-emerald-500"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.textColor')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={selectedClip.color}
                    onChange={(e) => handleUpdateSelectedClip({ color: e.target.value })}
                    className="w-10 h-10 p-0 border border-gray-600 cursor-pointer rounded-lg bg-gray-950"
                  />
                  <Input
                    value={selectedClip.color}
                    onChange={(e) => handleUpdateSelectedClip({ color: e.target.value })}
                    className="text-sm flex-1 bg-gray-950 border-gray-600 text-white font-mono focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.bgColor')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={selectedClip.backgroundColor}
                    onChange={(e) => handleUpdateSelectedClip({ backgroundColor: e.target.value, backgroundOpacity: 100 })}
                    className="w-10 h-10 p-0 border border-gray-600 cursor-pointer rounded-lg bg-gray-950"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdateSelectedClip({ backgroundOpacity: 0 })}
                    className={`flex-1 text-[10px] uppercase font-bold ${selectedClip.backgroundOpacity === 0 ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' : 'border-gray-600 text-gray-400'}`}
                  >
                    {t('videoEditor.text.transparent')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <TimeInput
                  label={t('videoEditor.text.startTime')}
                  value={selectedClip.startTime}
                  max={videoDuration}
                  onChange={(s) => handleUpdateSelectedClip({ startTime: s })}
                />
              </div>

              <div>
                <TimeInput
                  label={t('videoEditor.text.duration')}
                  value={selectedClip.duration}
                  max={Math.max(0, videoDuration - selectedClip.startTime)}
                  onChange={(s) => handleUpdateSelectedClip({ duration: Math.max(0.1, s) })}
                />
              </div>
            </div>

            {/* Movimiento del texto (instantes / fotogramas clave) — espejo de objetos */}
            <div className="rounded-lg bg-gray-950/50 border border-emerald-500/30 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <h5 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">{t('videoEditor.text.motionTitle')}</h5>
                </div>
                {!editingKf && (
                  <Button
                    size="sm"
                    onClick={startNewKeyframe}
                    className="whitespace-nowrap"
                    title={t('videoEditor.text.newKfTitle')}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t('videoEditor.text.createKf', { time: (selectedClip.startTime + currentLocalTime).toFixed(1) })}
                  </Button>
                )}
              </div>

              <div className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-2 text-[11px] text-emerald-200 leading-snug">
                <b>{t('videoEditor.text.kfHelp1')}</b> {t('videoEditor.text.kfHelp2')} {t('videoEditor.text.kfHelp3')}
              </div>

              {editingKf && (
                <div className="rounded-md border border-emerald-500/60 bg-emerald-500/5 p-3 space-y-3">
                  <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                    {isNewKf ? t('videoEditor.text.newKf') : t('videoEditor.text.editingKf')}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfMinute')}</Label>
                      <Input
                        type="number"
                        min={selectedClip.startTime}
                        max={selectedClip.startTime + selectedClip.duration}
                        step="0.1"
                        value={Number((selectedClip.startTime + editingKf.time).toFixed(1))}
                        onChange={(e) => {
                          const newTime = clamp(Number(e.target.value) - selectedClip.startTime, 0, selectedClip.duration);
                          updateKeyframe(editingKf.id, { time: newTime });
                          onSeek?.(selectedClip.startTime + newTime);
                        }}
                        className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfOpacity')}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        value={editingKf.opacity}
                        onChange={(e) => updateKeyframe(editingKf.id, { opacity: clamp(Number(e.target.value), 0, 100) })}
                        className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfPosX')}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        value={editingKf.x}
                        onChange={(e) => updateKeyframe(editingKf.id, { x: clamp(Number(e.target.value), 0, 100) })}
                        className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfPosY')}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        value={editingKf.y}
                        onChange={(e) => updateKeyframe(editingKf.id, { y: clamp(Number(e.target.value), 0, 100) })}
                        className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfSize')}</Label>
                      <Input
                        type="number"
                        min={8}
                        max={120}
                        step="1"
                        value={editingKf.fontSize}
                        onChange={(e) => updateKeyframe(editingKf.id, { fontSize: clamp(Number(e.target.value), 8, 120) })}
                        className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button size="sm" variant="ghost" onClick={cancelEditing} className="text-gray-300">
                      <X className="w-3.5 h-3.5 mr-1" />
                      {t('videoEditor.text.cancel')}
                    </Button>
                    <Button size="sm" onClick={finishEditing} className="bg-emerald-600 hover:bg-emerald-500">
                      <Save className="w-3.5 h-3.5 mr-1" />
                      {t('videoEditor.text.save')}
                    </Button>
                  </div>
                </div>
              )}

              {!editingKf && sortedKeyframes.length > 0 && (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {sortedKeyframes.map((kf, idx) => (
                    <div key={kf.id} className="rounded-md border border-gray-700 bg-gray-900/40 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] text-emerald-400 uppercase font-black">
                          {t('videoEditor.text.kfBadge', { n: idx + 1, time: (selectedClip.startTime + kf.time).toFixed(1) })}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditKeyframe(kf)}
                            className="h-7 px-2 text-gray-300 hover:text-emerald-400"
                            title={t('videoEditor.text.editKfTitle')}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteKeyframe(kf.id)}
                            className="h-7 px-2 text-gray-400 hover:text-red-400"
                            title={t('videoEditor.text.deleteKfTitle')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 text-[11px] text-gray-300">
                        <span>{t('videoEditor.text.posX', { value: Math.round(kf.x) })}</span>
                        <span>{t('videoEditor.text.posY', { value: Math.round(kf.y) })}</span>
                        <span>{t('videoEditor.text.kfSizeShort', { value: Math.round(kf.fontSize) })}</span>
                        <span>{t('videoEditor.text.kfOpacityShort', { value: Math.round(kf.opacity) })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!editingKf && sortedKeyframes.length === 0 && (
                <p className="text-[11px] text-gray-500 leading-snug">
                  {t('videoEditor.text.noMotion')}
                </p>
              )}
            </div>

            {(!hasKeyframes || editingKf) && (
              <div className="space-y-3">
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase">{t('videoEditor.text.position')}</Label>
                <div className="grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-lg border border-white/5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posX', { value: sliderVals.x })}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={sliderVals.x}
                        onChange={(e) => onSliderChange('x', clamp(Number(e.target.value) || 0, 0, 100))}
                        className="w-20 h-8 text-xs bg-gray-950 border-gray-600 text-white"
                      />
                    </div>
                    <Slider
                      value={[sliderVals.x]}
                      onValueChange={([value]) => onSliderChange('x', value)}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posY', { value: sliderVals.y })}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={sliderVals.y}
                        onChange={(e) => onSliderChange('y', clamp(Number(e.target.value) || 0, 0, 100))}
                        className="w-20 h-8 text-xs bg-gray-950 border-gray-600 text-white"
                      />
                    </div>
                    <Slider
                      value={[sliderVals.y]}
                      onValueChange={([value]) => onSliderChange('y', value)}
                      min={0}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            )}

            {(!hasKeyframes || editingKf) && (
              <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-white/5">
                <Label className="text-xs text-green-400 font-bold mb-2 block uppercase text-center">{t('videoEditor.text.opacity', { value: sliderVals.opacity })}</Label>
                <Slider
                  value={[sliderVals.opacity]}
                  onValueChange={([value]) => onSliderChange('opacity', value)}
                  min={0}
                  max={100}
                  step={5}
                  className="w-full px-2"
                />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleDeleteSelectedClip}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('videoEditor.text.deleteText')}
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}

