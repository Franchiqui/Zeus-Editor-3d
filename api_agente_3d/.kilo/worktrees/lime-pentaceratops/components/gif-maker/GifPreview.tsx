'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Play, Pause, Save } from 'lucide-react';
import { FrameData } from '@/lib/gif-utils';
import { useI18n } from '@/lib/i18n';

// Función para eliminar rectángulos de selección del ImageData
function removeRectanglesFromImageData(imageData: ImageData): ImageData {
  const cleanData = new Uint8ClampedArray(imageData.data);
  const { width, height } = imageData;
  
  // Colores característicos de rectángulos que queremos eliminar
  const rectangleColors = [
    { r: 239, g: 68, b: 68 },   // Rojo (#ef4444) - modo crop
    { r: 245, g: 158, b: 11 },  // Naranja (#f59e0b) - modo selección
    { r: 59, g: 130, b: 246 },  // Azul (#3b82f6) - bordes de edición
    { r: 16, g: 185, b: 129 },  // Verde (#10b981) - bordes de texto
  ];

  // Detectar y eliminar píxeles de rectángulos
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = cleanData[idx];
      const g = cleanData[idx + 1];
      const b = cleanData[idx + 2];
      const a = cleanData[idx + 3];

      // Verificar si el píxel coincide con colores de rectángulo
      const isRectanglePixel = rectangleColors.some(color => 
        Math.abs(r - color.r) <= 5 && 
        Math.abs(g - color.g) <= 5 && 
        Math.abs(b - color.b) <= 5
      );

      if (isRectanglePixel) {
        // Hacer el píxel transparente
        cleanData[idx + 3] = 0;
      }
    }
  }

  // Crear nuevo ImageData limpio
  const cleanImageData = new ImageData(cleanData, width, height);
  return cleanImageData;
}

interface GifPreviewProps {
  frames: FrameData[];
  generatedGif: Blob | null;
  isGenerating: boolean;
  onGenerate: () => void;
  onDownload: () => void;
  onSaveToLibrary?: (gif: Blob) => void;
}

export function GifPreview({
  frames,
  generatedGif,
  isGenerating,
  onGenerate,
  onDownload,
  onSaveToLibrary,
}: GifPreviewProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!canvasRef.current || frames.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frame = frames[currentFrame];
    if (!frame) return;

    canvas.width = frame.imageData.width;
    canvas.height = frame.imageData.height;

    // Limpiar el frame de rectángulos antes de mostrarlo
    const cleanImageData = removeRectanglesFromImageData(frame.imageData);
    ctx.putImageData(cleanImageData, 0, 0);
  }, [currentFrame, frames]);

  useEffect(() => {
    if (frames.length === 0 || !isPlaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % frames.length);
    }, frames[currentFrame]?.duration || 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [frames, isPlaying, currentFrame]);

  useEffect(() => {
    if (generatedGif) {
      setIsPlaying(false);
    }
  }, [generatedGif]);

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  return (
    <Card className="sticky top-4 bg-gray-900 border-gray-800 text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-white">{t('gifEditor.previewTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-gray-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[300px] border border-gray-800 shadow-inner">
          {generatedGif ? (
            <img
              src={URL.createObjectURL(generatedGif)}
              alt={t('gifEditor.previewAltGenerated')}
              className="max-w-full max-h-[500px] object-contain"
            />
          ) : frames.length > 0 ? (
            <canvas ref={canvasRef} className="max-w-full max-h-[500px] object-contain" />
          ) : (
            <div className="text-gray-500 text-center py-12">
              <p className="font-bold uppercase tracking-widest text-xs">{t('gifEditor.previewNoFrames')}</p>
            </div>
          )}
        </div>

        {frames.length > 0 && !generatedGif && (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={togglePlayPause} className="border-gray-700 hover:bg-gray-800 text-gray-300">
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <div className="flex-1 text-xs font-bold text-gray-500 uppercase tracking-tighter">
              {t('gifEditor.previewFrameOf', { current: currentFrame + 1, total: frames.length })}
            </div>
          </div>
        )}

        <div className="space-y-3 pt-2">
          <Button
            onClick={onGenerate}
            disabled={frames.length === 0 || isGenerating}
            className="w-full bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-black font-bold py-6 rounded-xl shadow-lg shadow-green-900/20 transition-all active:scale-[0.98]"
          >
            {isGenerating ? t('gifEditor.previewGenerating') : t('gifEditor.previewGenerate')}
          </Button>

          {generatedGif && (
            <div className="space-y-2">
              <Button onClick={onDownload} variant="secondary" className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-6 rounded-xl transition-all active:scale-[0.98]">
                <Download className="w-4 h-4 mr-2" />
                {t('gifEditor.previewDownload')}
              </Button>
              {onSaveToLibrary && (
                <Button onClick={() => onSaveToLibrary(generatedGif)} variant="outline" className="w-full border-green-600 text-green-600 hover:bg-green-600 hover:text-white font-bold py-6 rounded-xl transition-all active:scale-[0.98]">
                  <Save className="w-4 h-4 mr-2" />
                  {t('gifEditor.previewSaveToLibrary')}
                </Button>
              )}
            </div>
          )}
        </div>

        {frames.length > 0 && (
          <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 space-y-2 pt-2 border-t border-gray-800">
            <div className="flex justify-between">
              <span>{t('gifEditor.previewTotalFrames')}</span>
              <span className="text-gray-300">{frames.length}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('gifEditor.previewEstimatedSize')}</span>
              <span className="text-green-400">
                {generatedGif
                  ? `${(generatedGif.size / 1024).toFixed(2)} KB`
                  : t('gifEditor.previewNA')}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
