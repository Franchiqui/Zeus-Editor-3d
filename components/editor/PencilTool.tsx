import React, { useRef, useEffect, useState } from 'react';
import { PenTool, Eraser, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n';

interface PencilToolProps {
  isActive: boolean;
  onToggle: () => void;
  onSettingsChange: (settings: PencilSettings) => void;
}

interface PencilSettings {
  brushSize: number;
  brushShape: 'round' | 'square';
  cementWidth: number;
  magnetism: boolean;
  color: string;
  opacity: number;
  smoothness: number;
}

export default function PencilTool({
  isActive,
  onToggle,
  onSettingsChange,
}: PencilToolProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  
  const defaultSettings: PencilSettings = {
    brushSize: 4,
    brushShape: 'round',
    cementWidth: 2,
    magnetism: true,
    color: '#000000',
    opacity: 100,
    smoothness: 5,
  };

  useEffect(() => {
    if (isActive && containerRef.current && canvasRef.current) {
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
  }, [isActive]);

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
      ctx.strokeStyle = defaultSettings.color;
      ctx.lineWidth = defaultSettings.brushSize;
      ctx.lineCap = defaultSettings.brushShape === 'round' ? 'round' : 'square';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = defaultSettings.opacity / 100;
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPoint || !canvasRef.current) return;
    e.preventDefault();

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const currentPos = getMousePos(e);
    const settings = defaultSettings;

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

    // Cement effect - draw two parallel lines
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.brushSize + settings.cementWidth * 2;
    ctx.lineCap = settings.brushShape === 'round' ? 'round' : 'square';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = settings.opacity / 100;

    // Main line
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(drawX, drawY);
    ctx.stroke();

    // Cement lines (left and right)
    const cementOffset = settings.cementWidth;
    const angle = Math.atan2(currentPos.y - lastPoint.y, currentPos.x - lastPoint.x);
    
    if (settings.brushShape === 'round') {
      // Round brush cement effect
      ctx.beginPath();
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = settings.brushSize;
      ctx.globalAlpha = settings.opacity / 100;
      
      // Left cement line
      ctx.moveTo(lastPoint.x - cementOffset, lastPoint.y);
      ctx.lineTo(drawX - cementOffset, drawY);
      ctx.stroke();
      
      // Right cement line
      ctx.beginPath();
      ctx.moveTo(lastPoint.x + cementOffset, lastPoint.y);
      ctx.lineTo(drawX + cementOffset, drawY);
      ctx.stroke();
    } else {
      // Square brush cement effect
      ctx.beginPath();
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = settings.brushSize;
      ctx.globalAlpha = settings.opacity / 100;
      
      // Left cement line
      ctx.moveTo(lastPoint.x - cementOffset, lastPoint.y - cementOffset);
      ctx.lineTo(drawX - cementOffset, drawY - cementOffset);
      ctx.stroke();
      
      // Right cement line
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

  return (
    <div ref={containerRef} className="relative w-full h-64 bg-black rounded-lg border border-gray-800 overflow-hidden cursor-crosshair">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      
      {/* Overlay Controls */}
      <div className="absolute top-2 right-2 flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={clearCanvas}
          className="bg-black/50 hover:bg-black/70 text-white"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={resetCanvas}
          className="bg-black/50 hover:bg-black/70 text-white"
        >
          <Eraser className="w-4 h-4" />
        </Button>
      </div>

      {/* Settings Panel */}
      <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-gray-700 w-64">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <PenTool className="w-3 h-3" /> {t('pencil.brushSize')}
            </Label>
            <span className="text-xs text-emerald-500">{defaultSettings.brushSize}px</span>
          </div>
          <Slider
            value={[defaultSettings.brushSize]}
            onValueChange={([v]) => onSettingsChange({ ...defaultSettings, brushSize: v })}
            min={1}
            max={50}
            step={0.5}
            className="py-2"
          />

          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> {t('pencil.shape')}
            </Label>
            <div className="flex bg-gray-900 rounded-md p-1 border border-gray-700">
              <Toggle
                pressed={defaultSettings.brushShape === 'round'}
                onPressedChange={(v) => onSettingsChange({ ...defaultSettings, brushShape: v ? 'round' : 'square' })}
                className="bg-gray-800 border-gray-700"
              >
                <span className="text-xs">O</span>
              </Toggle>
              <Toggle
                pressed={defaultSettings.brushShape === 'square'}
                onPressedChange={(v) => onSettingsChange({ ...defaultSettings, brushShape: v ? 'square' : 'round' })}
                className="bg-gray-800 border-gray-700"
              >
                <span className="text-xs">□</span>
              </Toggle>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> {t('pencil.cement')}
            </Label>
            <span className="text-xs text-emerald-500">{defaultSettings.cementWidth}px</span>
          </div>
          <Slider
            value={[defaultSettings.cementWidth]}
            onValueChange={([v]) => onSettingsChange({ ...defaultSettings, cementWidth: v })}
            min={0}
            max={10}
            step={0.5}
            className="py-2"
          />

          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> {t('pencil.magnetism')}
            </Label>
            <Toggle
              pressed={defaultSettings.magnetism}
              onPressedChange={(v) => onSettingsChange({ ...defaultSettings, magnetism: v })}
              className="bg-gray-800 border-gray-700"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> {t('pencil.opacity')}
            </Label>
            <span className="text-xs text-emerald-500">{defaultSettings.opacity}%</span>
          </div>
          <Slider
            value={[defaultSettings.opacity]}
            onValueChange={([v]) => onSettingsChange({ ...defaultSettings, opacity: v })}
            min={1}
            max={100}
            step={1}
            className="py-2"
          />

          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> {t('pencil.color')}
            </Label>
          </div>
          <input
            type="color"
            value={defaultSettings.color}
            onChange={(e) => onSettingsChange({ ...defaultSettings, color: e.target.value })}
            className="w-10 h-10 p-0 border-none bg-transparent cursor-pointer rounded"
          />
        </div>
      </div>
    </div>
  );
}
