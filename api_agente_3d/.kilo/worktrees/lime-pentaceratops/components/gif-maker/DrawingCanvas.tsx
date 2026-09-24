'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Pencil, Eraser, Trash2, Download, Copy, Square, Circle, Minus, Upload, Check, X, Move, Scissors, ClipboardPaste, LassoSelect, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { imageDataToThumbnail } from '@/lib/gif-utils';

import { TextOverlay } from '@/lib/gif-utils';
import { useI18n } from '@/lib/i18n';

interface DrawingCanvasProps {
  onFrameCreated: (frame: { id: string; imageData: ImageData; thumbnail: string }) => void;
  textStyle?: TextOverlay;
}

interface EditingImage {
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EditingText {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

const CANVAS_BASE_WIDTH = 1200;
const CANVAS_BASE_HEIGHT = 800;

export function DrawingCanvas({ onFrameCreated, textStyle }: DrawingCanvasProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(5);
  const [color, setColor] = useState('#000000');
  const [tool, setTool] = useState<'pen' | 'eraser' | 'shape' | 'image' | 'text'>('pen');
  const [shapeType, setShapeType] = useState<'rectangle' | 'ellipse' | 'line'>('rectangle');
  const [shapeFillColor, setShapeFillColor] = useState('#ffffff');
  const [shapeStrokeColor, setShapeStrokeColor] = useState('#000000');
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [canvasSnapshot, setCanvasSnapshot] = useState<ImageData | null>(null);
  const [isBackgroundTransparent, setIsBackgroundTransparent] = useState(false);
  const [isCropMode, setIsCropMode] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [clipboard, setClipboard] = useState<string | null>(null);
  const [shapePath, setShapePath] = useState<{ x: number; y: number }[]>([]);
  const [isNearClosingPoint, setIsNearClosingPoint] = useState(false);
  const [lassoPath, setLassoPath] = useState<{ x: number; y: number }[] | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [removeBgError, setRemoveBgError] = useState<string | null>(null);

  const LINE_CLOSE_THRESHOLD = 12;
  const isNearFirstVertex = useCallback((point: { x: number; y: number }) => {
    if (shapePath.length === 0) return false;
    const first = shapePath[0];
    return Math.hypot(point.x - first.x, point.y - first.y) <= LINE_CLOSE_THRESHOLD;
  }, [shapePath]);

  const CLOSING_CURSOR_DATA =
    'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22%3E%3Cline x1=%2216%22 y1=%220%22 x2=%2216%22 y2=%2232%22 stroke=%22%23ef4444%22 stroke-width=%222%22/%3E%3Cline x1=%220%22 y1=%2216%22 x2=%2232%22 y2=%2216%22 stroke=%22%23ef4444%22 stroke-width=%222%22/%3E%3C/svg%3E") 16 16, crosshair';

  // Estados para la imagen cargada
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isResizingImage, setIsResizingImage] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Estados para el texto interactivo
  const [editingText, setEditingText] = useState<EditingText | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [isResizingText, setIsResizingText] = useState(false);

  // Sincronizar cambios del panel lateral con el texto que se está editando en el lienzo
  useEffect(() => {
    if (editingText && textStyle) {
      setEditingText(prev => {
        if (!prev) return null;
        return {
          ...prev,
          text: textStyle.text,
          color: textStyle.color,
          fontFamily: textStyle.fontFamily,
          strokeColor: textStyle.strokeColor,
          strokeWidth: textStyle.strokeWidth,
          shadowColor: textStyle.shadowColor,
          shadowBlur: textStyle.shadowBlur,
          shadowOffsetX: textStyle.shadowOffsetX,
          shadowOffsetY: textStyle.shadowOffsetY,
        };
      });
    }
  }, [textStyle]);

  useEffect(() => {
    if (tool === 'shape' && shapeType === 'line') return;
    setIsNearClosingPoint(false);
  }, [tool, shapeType]);

  const applyBackground = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (isBackgroundTransparent) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [isBackgroundTransparent]);

  useEffect(() => {
    applyBackground();
  }, [applyBackground]);

  const redrawCanvas = useCallback((showHandles: boolean = true) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasSnapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(canvasSnapshot, 0, 0);

    if (editingImage) {
      // Dibujar la imagen en su posición actual
      ctx.drawImage(editingImage.img, editingImage.x, editingImage.y, editingImage.width, editingImage.height);
      
      if (showHandles) {
        // Dibujar borde de selección y manejador de redimensionado
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(editingImage.x, editingImage.y, editingImage.width, editingImage.height);
        ctx.setLineDash([]);
        
        // Manejador de redimensionado (esquina inferior derecha)
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(editingImage.x + editingImage.width - 8, editingImage.y + editingImage.height - 8, 16, 16);
      }
    }

    if (editingText) {
      ctx.save(); // Guardar estado para no afectar a otros elementos
      ctx.textBaseline = 'top';
      ctx.font = `${editingText.fontSize}px ${editingText.fontFamily}`;
      const metrics = ctx.measureText(editingText.text);
      const textWidth = metrics.width;
      const textHeight = editingText.fontSize;

      // 1. Dibujar relleno con sombra
      if (editingText.shadowColor && editingText.shadowColor !== '') {
        ctx.shadowColor = editingText.shadowColor;
        ctx.shadowBlur = editingText.shadowBlur || 0;
        ctx.shadowOffsetX = editingText.shadowOffsetX || 0;
        ctx.shadowOffsetY = editingText.shadowOffsetY || 0;
      }
      ctx.fillStyle = editingText.color;
      ctx.fillText(editingText.text, editingText.x, editingText.y);

      // 2. Desactivar sombra para que el borde sea nítido y no se desplace
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // 3. Dibujar borde (siempre en su sitio)
      if (editingText.strokeColor && editingText.strokeColor !== '' && (editingText.strokeWidth || 0) > 0) {
        ctx.strokeStyle = editingText.strokeColor;
        ctx.lineWidth = editingText.strokeWidth || 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(editingText.text, editingText.x, editingText.y);
      }

      ctx.restore(); // Restaurar estado para el borde de selección

      if (showHandles) {
        // Borde de selección (siempre visible para edición)
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.strokeRect(editingText.x - 4, editingText.y - 4, textWidth + 8, textHeight + 8);
        ctx.setLineDash([]);

        // Manejador de redimensionado
        ctx.fillStyle = '#10b981';
        ctx.fillRect(editingText.x + textWidth, editingText.y + textHeight, 16, 16);
      }
    }
  }, [canvasSnapshot, editingImage, editingText]);

  useEffect(() => {
    if (editingImage || editingText) {
      redrawCanvas();
    }
  }, [editingImage, editingText, redrawCanvas]);

  // Función expuesta para añadir texto desde el panel lateral
  const addText = useCallback((textData: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Capturamos el snapshot inmediatamente
      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setCanvasSnapshot(snapshot);

      setEditingText({
        text: textData.text,
        x: (canvas.width / 2) - 100,
        y: (canvas.height / 2) - (textData.fontSize / 2),
        fontSize: textData.fontSize,
        fontFamily: textData.fontFamily,
        color: textData.color,
        strokeColor: textData.strokeColor,
        strokeWidth: textData.strokeWidth,
        shadowColor: textData.shadowColor,
        shadowBlur: textData.shadowBlur,
        shadowOffsetX: textData.shadowOffsetX,
        shadowOffsetY: textData.shadowOffsetY
      });
      setTool('text');
    }
  }, []);

  // Hacer disponible la función addText a través de window para prototipado rápido (o usar refs)
  useEffect(() => {
    (window as any).addTextToCanvas = addText;
    return () => { delete (window as any).addTextToCanvas; };
  }, [addText]);
const confirmText = useCallback(() => {
  const canvas = canvasRef.current;
  if (!canvas || !editingText || !canvasSnapshot) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Estampar definitivamente
  ctx.putImageData(canvasSnapshot, 0, 0);
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `${editingText.fontSize}px ${editingText.fontFamily}`;

  // 1. Dibujar relleno con sombra
  if (editingText.shadowColor && editingText.shadowColor !== '') {
    ctx.shadowColor = editingText.shadowColor;
    ctx.shadowBlur = editingText.shadowBlur || 0;
    ctx.shadowOffsetX = editingText.shadowOffsetX || 0;
    ctx.shadowOffsetY = editingText.shadowOffsetY || 0;
  }
  ctx.fillStyle = editingText.color;
  ctx.fillText(editingText.text, editingText.x, editingText.y);

  // 2. Desactivar sombra para el borde
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 3. Dibujar borde nítido
  if (editingText.strokeColor && editingText.strokeColor !== '' && (editingText.strokeWidth || 0) > 0) {
    ctx.strokeStyle = editingText.strokeColor;
    ctx.lineWidth = editingText.strokeWidth ?? 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(editingText.text, editingText.x, editingText.y);
  }

  ctx.restore();
  
  setEditingText(null);
  setCanvasSnapshot(null);
  setTool('pen');
}, [editingText, canvasSnapshot]);


  const cancelText = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasSnapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(canvasSnapshot, 0, 0);
    setEditingText(null);
    setCanvasSnapshot(null);
    setTool('pen');
  }, [canvasSnapshot]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    return { x, y };
  }, []);

  const handleLocalLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Guardar snapshot actual del lienzo antes de entrar en modo imagen
        const ctx = canvas.getContext('2d');
        if (ctx) {
          setCanvasSnapshot(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }

        // Calcular tamaño inicial (máximo 50% del lienzo)
        let w = img.width;
        let h = img.height;
        const maxW = canvas.width * 0.5;
        const maxH = canvas.height * 0.5;
        
        if (w > maxW) {
          h = (maxW / w) * h;
          w = maxW;
        }
        if (h > maxH) {
          w = (maxH / h) * w;
          h = maxH;
        }

        setEditingImage({
          img,
          x: (canvas.width - w) / 2,
          y: (canvas.height - h) / 2,
          width: w,
          height: h
        });
        setTool('image');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const confirmImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !editingImage || !canvasSnapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Estampar definitivamente
    ctx.putImageData(canvasSnapshot, 0, 0);
    ctx.drawImage(editingImage.img, editingImage.x, editingImage.y, editingImage.width, editingImage.height);
    
    setEditingImage(null);
    setCanvasSnapshot(null);
    setTool('pen');
  }, [editingImage, canvasSnapshot]);

  const cancelImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasSnapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(canvasSnapshot, 0, 0);
    setEditingImage(null);
    setCanvasSnapshot(null);
    setTool('pen');
  }, [canvasSnapshot]);

  const drawShape = useCallback(
    (ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }) => {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      const isLineShape = shapeType === 'line';

      ctx.beginPath();
      
      // Estilo para Recorte y Selección
      if (isCropMode || isSelectionMode) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = isCropMode ? '#ef4444' : '#f59e0b'; // Rojo vs Naranja
        ctx.lineWidth = 2;
        ctx.fillStyle = isCropMode ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = shapeStrokeColor;
        ctx.lineWidth = brushSize;
      }

      if (isLineShape) {
        const path = shapePath.length ? shapePath : [start];
        const preview = end ? [...path, end] : path;
        if (preview.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(preview[0].x, preview[0].y);
          preview.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        return;
      }

      if (shapeType === 'rectangle') {
        ctx.rect(x, y, width, height);
      } else if (shapeType === 'ellipse') {
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }

      // Aplicar relleno y trazo para Recorte/Selección
      if (isCropMode || isSelectionMode) {
        if (!isLineShape) ctx.fill();
        ctx.stroke();
      } else {
        // Relleno normal para dibujo
        if (!isLineShape && shapeFillColor) {
          ctx.fillStyle = shapeFillColor;
          ctx.fill();
        }
        ctx.stroke();
      }
      
      ctx.setLineDash([]); // Resetear siempre
    },
    [shapeType, shapeFillColor, shapeStrokeColor, brushSize, isCropMode, isSelectionMode, shapePath]
  );

  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const point = getCanvasCoords(e);
    if (!point) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (editingText) {
      ctx.textBaseline = 'top';
      ctx.font = `${editingText.fontSize}px ${editingText.fontFamily}`;
      const metrics = ctx.measureText(editingText.text);
      const textWidth = metrics.width;
      const textHeight = editingText.fontSize;

      const isOverResizeHandle =
        point.x >= editingText.x + textWidth - 10 &&
        point.x <= editingText.x + textWidth + 25 &&
        point.y >= editingText.y + textHeight - 10 &&
        point.y <= editingText.y + textHeight + 25;

      if (isOverResizeHandle) {
        setIsResizingText(true);
        setIsDrawing(true);
        return;
      }

      if (
        point.x >= editingText.x - 15 &&
        point.x <= editingText.x + textWidth + 15 &&
        point.y >= editingText.y - 15 &&
        point.y <= editingText.y + textHeight + 15
      ) {
        setIsDraggingText(true);
        setIsDrawing(true);
        setDragOffset({
          x: point.x - editingText.x,
          y: point.y - editingText.y
        });
        return;
      }
    }

    if (editingImage) {
      const resizeThreshold = 25;
      const isOverResizeHandle =
        point.x >= editingImage.x + editingImage.width - resizeThreshold &&
        point.x <= editingImage.x + editingImage.width + 15 &&
        point.y >= editingImage.y + editingImage.height - resizeThreshold &&
        point.y <= editingImage.y + editingImage.height + 15;

      if (isOverResizeHandle) {
        setIsResizingImage(true);
        setIsDrawing(true);
        return;
      }

      if (
        point.x >= editingImage.x &&
        point.x <= editingImage.x + editingImage.width &&
        point.y >= editingImage.y &&
        point.y <= editingImage.y + editingImage.height
      ) {
        setIsDraggingImage(true);
        setIsDrawing(true);
        setDragOffset({
          x: point.x - editingImage.x,
          y: point.y - editingImage.y
        });
        return;
      }
    }

    if (tool === 'shape') {
      const isLineMode = shapeType === 'line' && (isCropMode || isSelectionMode);
      if (isLineMode) {
        if (!canvasSnapshot) {
          const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
          setCanvasSnapshot(snapshot);
        }
        if (shapePath.length === 0) {
          setShapeStart(point);
          setShapePath([point]);
        }
        setIsNearClosingPoint(false);
        setIsDrawing(true);
        return;
      }
      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setCanvasSnapshot(snapshot);
      setShapeStart(point);
    } else {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    }

    setIsDrawing(true);
  }, [getCanvasCoords, tool, editingImage, editingText, shapePath, shapeType, isCropMode, isSelectionMode, canvasSnapshot]);

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = getCanvasCoords(e);
      if (!point) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const isLineMode = tool === 'shape' && shapeType === 'line' && (isCropMode || isSelectionMode);
      const nearClosing = isLineMode && shapePath.length >= 2 && isNearFirstVertex(point);
      setIsNearClosingPoint(nearClosing);

      if (isResizingText && editingText) {
        const newFontSize = Math.max(12, point.y - editingText.y);
        setEditingText(prev => prev ? { ...prev, fontSize: newFontSize } : null);
        return;
      }

      if (isDraggingText && editingText) {
        setEditingText(prev => prev ? {
          ...prev,
          x: point.x - dragOffset.x,
          y: point.y - dragOffset.y
        } : null);
        return;
      }

      if (isResizingImage && editingImage) {
        const newWidth = Math.max(20, point.x - editingImage.x);
        const newHeight = Math.max(20, point.y - editingImage.y);
        setEditingImage(prev => prev ? { ...prev, width: newWidth, height: newHeight } : null);
        return;
      }

      if (isDraggingImage && editingImage) {
        setEditingImage(prev => prev ? {
          ...prev,
          x: point.x - dragOffset.x,
          y: point.y - dragOffset.y
        } : null);
        return;
      }

      if (!isDrawing) return;

      if (tool === 'shape' && shapeStart && canvasSnapshot) {
        ctx.putImageData(canvasSnapshot, 0, 0);
        drawShape(ctx, shapeStart, point);
        return;
      }

      ctx.lineTo(point.x, point.y);
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const prevComposite = ctx.globalCompositeOperation;
      if (tool === 'eraser' && isBackgroundTransparent) {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = tool === 'eraser' ? 'rgba(255, 255, 255, 0.5)' : color;
      ctx.stroke();
      ctx.globalCompositeOperation = prevComposite;
    },
    [isDrawing, brushSize, color, tool, getCanvasCoords, shapeStart, canvasSnapshot, drawShape, isBackgroundTransparent, isResizingImage, isDraggingImage, editingImage, isResizingText, isDraggingText, editingText, dragOffset, isCropMode, isSelectionMode, shapePath, isNearFirstVertex]
  );

  const resetDrawingState = useCallback(() => {
    setIsDrawing(false);
    setIsDraggingImage(false);
    setIsResizingImage(false);
    setIsDraggingText(false);
    setIsResizingText(false);
    setShapeStart(null);
    setShapePath([]);
    setIsNearClosingPoint(false);
    if (tool !== 'image' && tool !== 'text') setCanvasSnapshot(null);
  }, [tool]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setIsDraggingImage(false);
    setIsResizingImage(false);
    setIsDraggingText(false);
    setIsResizingText(false);
  }, []);

  const cancelDrawing = useCallback(() => {
    if (tool === 'shape' && canvasSnapshot) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.putImageData(canvasSnapshot, 0, 0);
      }
    }
    resetDrawingState();
  }, [canvasSnapshot, tool, resetDrawingState]);

  const finishDrawing = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      let preservedSnapshot: ImageData | null = null;
      const isLineMode = shapeType === 'line' && (isCropMode || isSelectionMode);
      if (tool === 'shape' && shapeStart && canvasSnapshot) {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const point = getCanvasCoords(e);
            if (point) {
              if (isCropMode || isSelectionMode) {
                let points: { x: number; y: number }[];
                if (isLineMode) {
                  const nextPath = [...shapePath, point];
                  const shouldClose = nextPath.length > 2 && isNearFirstVertex(point);
                  setShapePath(nextPath);
                  if (!shouldClose) {
                    setShapeStart(point);
                    setIsDrawing(false);
                    return;
                  }
                  points = nextPath;
                } else {
                  const x = Math.min(shapeStart.x, point.x);
                  const y = Math.min(shapeStart.y, point.y);
                  const width = Math.abs(point.x - shapeStart.x);
                  const height = Math.abs(point.y - shapeStart.y);
                  points = [
                    { x, y },
                    { x: x + width, y },
                    { x: x + width, y: y + height },
                    { x, y: y + height }
                  ];
                }
                const bounds = points.reduce(
                  (acc, curr) => ({
                    minX: Math.min(acc.minX, curr.x),
                    minY: Math.min(acc.minY, curr.y),
                    maxX: Math.max(acc.maxX, curr.x),
                    maxY: Math.max(acc.maxY, curr.y)
                  }),
                  {
                    minX: Infinity,
                    minY: Infinity,
                    maxX: -Infinity,
                    maxY: -Infinity
                  }
                );
                const areaWidth = Math.max(1, bounds.maxX - bounds.minX);
                const areaHeight = Math.max(1, bounds.maxY - bounds.minY);

                if (areaWidth > 5 && areaHeight > 5) {
                  const tempCanvas = document.createElement('canvas');
                  tempCanvas.width = Math.ceil(areaWidth);
                  tempCanvas.height = Math.ceil(areaHeight);
                  const tempCtx = tempCanvas.getContext('2d')!;
                  const sourceCanvas = document.createElement('canvas');
                  sourceCanvas.width = canvas.width;
                  sourceCanvas.height = canvas.height;
                  sourceCanvas.getContext('2d')!.putImageData(canvasSnapshot, 0, 0);

                  const offsetX = -bounds.minX;
                  const offsetY = -bounds.minY;
                  const drawCapturePath = (renderCtx: CanvasRenderingContext2D, forTemp: boolean) => {
                    renderCtx.beginPath();
                    if (isLineMode) {
                      const xOffset = forTemp ? offsetX : 0;
                      const yOffset = forTemp ? offsetY : 0;
                      renderCtx.moveTo(points[0].x + xOffset, points[0].y + yOffset);
                      points.slice(1).forEach((pt) => renderCtx.lineTo(pt.x + xOffset, pt.y + yOffset));
                      renderCtx.closePath();
                    } else if (shapeType === 'ellipse') {
                      const centerX = forTemp ? areaWidth / 2 : bounds.minX + areaWidth / 2;
                      const centerY = forTemp ? areaHeight / 2 : bounds.minY + areaHeight / 2;
                      renderCtx.ellipse(centerX, centerY, areaWidth / 2, areaHeight / 2, 0, 0, Math.PI * 2);
                      renderCtx.closePath();
                    } else {
                      const drawX = forTemp ? 0 : bounds.minX;
                      const drawY = forTemp ? 0 : bounds.minY;
                      renderCtx.rect(drawX, drawY, areaWidth, areaHeight);
                      renderCtx.closePath();
                    }
                  };

                  tempCtx.save();
                  drawCapturePath(tempCtx, true);
                  tempCtx.clip();
                  tempCtx.drawImage(
                    sourceCanvas,
                    bounds.minX,
                    bounds.minY,
                    areaWidth,
                    areaHeight,
                    0,
                    0,
                    tempCanvas.width,
                    tempCanvas.height
                  );
                  tempCtx.restore();
                  const dataUrl = tempCanvas.toDataURL();

                  if (isCropMode) {
                    ctx.putImageData(canvasSnapshot, 0, 0);
                    ctx.save();
                    drawCapturePath(ctx, false);
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.fill();
                    ctx.restore();
                    preservedSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

                    const img = new Image();
                    img.onload = () => {
                      setEditingImage({
                        img,
                        x: bounds.minX,
                        y: bounds.minY,
                        width: tempCanvas.width,
                        height: tempCanvas.height
                      });
                      setTool('image');
                    };
                    img.src = dataUrl;
                    setIsCropMode(false);
                  } else {
                    setClipboard(dataUrl);
                    ctx.putImageData(canvasSnapshot, 0, 0);
                    setIsSelectionMode(false);
                  }
                } else {
                  ctx.putImageData(canvasSnapshot, 0, 0);
                  setIsCropMode(false);
                  setIsSelectionMode(false);
                }
              } else {
                ctx.putImageData(canvasSnapshot, 0, 0);
                drawShape(ctx, shapeStart, point);
              }
            }
          }
        }
      }
      resetDrawingState();
      if (preservedSnapshot) {
        setCanvasSnapshot(preservedSnapshot);
      }
    },
    [
      tool,
      shapeStart,
      canvasSnapshot,
      getCanvasCoords,
      drawShape,
      resetDrawingState,
      isCropMode,
      isSelectionMode,
      shapeType,
      isBackgroundTransparent,
      shapePath
    ]
  );

  const handlePaste = useCallback(() => {
    if (!clipboard) return;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (ctx && !canvasSnapshot) {
        setCanvasSnapshot(ctx.getImageData(0, 0, canvas.width, canvas.height));
      }

      setEditingImage({
        img,
        x: 50,
        y: 50,
        width: img.width,
        height: img.height
      });
      setTool('image');
    };
    img.src = clipboard;
  }, [clipboard, canvasSnapshot]);

  const handleCanvasMouseUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool === 'shape') {
        finishDrawing(event);
      } else {
        stopDrawing();
      }
    },
    [tool, finishDrawing, stopDrawing]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    if (tool === 'shape') {
      cancelDrawing();
    } else {
      stopDrawing();
    }
  }, [tool, cancelDrawing, stopDrawing]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    applyBackground();
    // Limpiar toda la memoria y estados
    setCanvasSnapshot(null);
    setEditingImage(null);
    setEditingText(null);
    setIsCropMode(false);
    setIsSelectionMode(false);
  }, [applyBackground]);

  const handleRemoveGifBackground = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRemoveBgError(null);
    setIsRemovingBg(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error(t('gifEditor.drawErrCaptureCanvas'));
      const file = new File([blob], `canvas-${Date.now()}.png`, { type: 'image/png' });
      const formData = new FormData();
      formData.append('image_file', file);
      const response = await fetch('/api/remove-bg', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || t('gifEditor.drawErrRemoveBgService'));
      }
      const resultBlob = await response.blob();
      const img = new Image();
      const objectUrl = URL.createObjectURL(resultBlob);
      await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = objectUrl; });
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(t('gifEditor.drawErrCanvasUnavailable'));
      applyBackground();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      setCanvasSnapshot(null);
      setEditingImage(null);
      setEditingText(null);
    } catch (error) {
      console.error(error);
      setRemoveBgError(error instanceof Error ? error.message : t('gifEditor.drawErrRemovingBg'));
    } finally {
      setIsRemovingBg(false);
    }
  }, [applyBackground]);

  const captureFrameFromCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    console.log('Capturando frame - Estados actuales:', {
      isSelectionMode,
      isCropMode,
      shapeStart,
      shapePathLength: shapePath.length,
      tool,
      hasCanvasSnapshot: !!canvasSnapshot
    });

    // Enfoque directo: usar canvasSnapshot si existe, ya que tiene el contenido puro
    if (canvasSnapshot) {
      console.log('Usando canvasSnapshot para captura limpia');
      // Crear un canvas temporal para trabajar con el snapshot
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(canvasSnapshot, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
        const thumbnail = imageDataToThumbnail(imageData);
        
        // Verificar si el snapshot tiene rectángulos
        let hasRectangles = false;
        for (let i = 0; i < imageData.data.length; i += 4) {
          // Buscar colores característicos de rectángulos (rojo #ef4444, naranja #f59e0b)
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          
          if ((r === 239 && g === 68 && b === 68) || (r === 245 && g === 158 && b === 11)) {
            hasRectangles = true;
            break;
          }
        }
        console.log('Snapshot tiene rectángulos:', hasRectangles);
        
        return { imageData, thumbnail };
      }
    }

    console.log('No hay canvasSnapshot, capturando del canvas actual');
    // Si no hay snapshot, capturar directamente del canvas actual
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const thumbnail = imageDataToThumbnail(imageData);

    return { imageData, thumbnail };
  }, [canvasSnapshot, isSelectionMode, isCropMode, shapeStart, shapePath, tool]);

  const persistFrame = useCallback(() => {
    const snapshot = captureFrameFromCanvas();
    if (!snapshot) return;

    onFrameCreated({
      id: `${Date.now()}-${Math.random()}`,
      ...snapshot,
    });
  }, [captureFrameFromCanvas, onFrameCreated]);

  const finalizeFrame = useCallback(() => {
    persistFrame();
    clearCanvas();
  }, [persistFrame, clearCanvas]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-center bg-gray-800/50 p-4 rounded-2xl border border-gray-800">
        <div className="flex gap-2 bg-gray-900 p-1 rounded-xl border border-gray-800 shadow-inner">
          <Button
            variant={tool === 'pen' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { if(editingImage) confirmImage(); setTool('pen'); }}
            className={tool === 'pen' ? "bg-green-600 hover:bg-green-500 text-black font-bold rounded-lg transition-all" : "text-gray-400 hover:text-white rounded-lg"}
          >
            <Pencil className="w-4 h-4 mr-2" />
            {t('gifEditor.drawPen')}
          </Button>
          <Button
            variant={tool === 'eraser' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { if(editingImage) confirmImage(); setTool('eraser'); }}
            className={tool === 'eraser' ? "bg-white hover:bg-gray-200 text-black font-bold rounded-lg transition-all shadow-lg" : "text-gray-400 hover:text-white rounded-lg"}
          >
            <Eraser className="w-4 h-4 mr-2" />
            {t('gifEditor.drawEraser')}
          </Button>
          <Button
            variant={tool === 'shape' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { if(editingImage) confirmImage(); setTool('shape'); }}
            className={tool === 'shape' ? "bg-blue-600 hover:bg-blue-500 text-black font-bold rounded-lg transition-all" : "text-gray-400 hover:text-white rounded-lg"}
          >
            <Square className="w-4 h-4 mr-2" />
            {t('gifEditor.drawShape')}
          </Button>
        </div>

        {tool === 'pen' && (
          <div className="flex items-center gap-3 px-3 border-l border-gray-700">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t('gifEditor.drawColor')}</label>
            <div className="relative w-10 h-10 group">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 w-full h-full rounded-xl cursor-pointer p-0 border-none bg-transparent"
              />
              <div className="absolute inset-0 pointer-events-none rounded-xl border-2 border-gray-700 group-hover:border-green-500/50 transition-colors" />
            </div>
          </div>
        )}

        {tool === 'shape' && (
          <div className="flex items-center gap-3 px-3 border-l border-gray-700">
            <div className="flex gap-2 items-center">
              <Button
                variant={shapeType === 'rectangle' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShapeType('rectangle')}
                className={shapeType === 'rectangle' ? 'bg-slate-700/80 text-white rounded-lg' : 'text-gray-400 hover:text-white'}
              >
                <Square className="w-4 h-4" />
              </Button>
              <Button
                variant={shapeType === 'ellipse' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShapeType('ellipse')}
                className={shapeType === 'ellipse' ? 'bg-slate-700/80 text-white rounded-lg' : 'text-gray-400 hover:text-white'}
              >
                <Circle className="w-4 h-4" />
              </Button>
              <Button
                variant={shapeType === 'line' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShapeType('line')}
                className={shapeType === 'line' ? 'bg-slate-700/80 text-white rounded-lg' : 'text-gray-400 hover:text-white'}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <div className="h-6 w-px bg-gray-700 mx-1" />
              <Button
                variant={isCropMode ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setIsCropMode(!isCropMode)}
                className={isCropMode ? 'bg-red-600 hover:bg-red-500 text-white rounded-lg animate-pulse' : 'text-gray-400 hover:text-white'}
                title={t('gifEditor.drawCropTitle')}
              >
                <Scissors className="w-4 h-4 mr-2" />
                {t('gifEditor.drawCrop')}
              </Button>
              <Button
                variant={isSelectionMode ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setIsSelectionMode(!isSelectionMode)}
                className={isSelectionMode ? 'bg-orange-600 hover:bg-orange-500 text-white rounded-lg animate-pulse' : 'text-gray-400 hover:text-white rounded-lg'}
                title={t('gifEditor.drawSelectTitle')}
              >
                <Copy className="w-4 h-4 mr-2" />
                {t('gifEditor.drawSelect')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePaste}
                disabled={!clipboard}
                className={clipboard ? 'text-green-400 hover:text-green-300' : 'text-gray-600 cursor-not-allowed'}
                title={t('gifEditor.drawPasteTitle')}
              >
                <ClipboardPaste className="w-4 h-4 mr-2" />
                {t('gifEditor.drawPaste')}
              </Button>
            </div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t('gifEditor.drawStroke')}</label>
            <div className="relative w-10 h-10 group">
              <input
                type="color"
                value={shapeStrokeColor}
                onChange={(e) => setShapeStrokeColor(e.target.value)}
                className="absolute inset-0 w-full h-full rounded-xl cursor-pointer p-0 border-none bg-transparent"
              />
              <div className="absolute inset-0 pointer-events-none rounded-xl border-2 border-gray-700 group-hover:border-blue-500/50 transition-colors" />
            </div>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t('gifEditor.drawFill')}</label>
            <div className="relative w-10 h-10 group">
              <input
                type="color"
                value={shapeFillColor}
                onChange={(e) => setShapeFillColor(e.target.value)}
                className="absolute inset-0 w-full h-full rounded-xl cursor-pointer p-0 border-none bg-transparent"
              />
              <div className="absolute inset-0 pointer-events-none rounded-xl border-2 border-gray-700 group-hover:border-blue-500/50 transition-colors" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 flex-1 min-w-[200px] px-3 border-l border-gray-700">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t('gifEditor.drawThickness')}</label>
          <Slider
            value={[brushSize]}
            onValueChange={(values) => setBrushSize(values[0])}
            min={1}
            max={50}
            step={1}
            className="flex-1 [&>span:first-child]:bg-gray-900 [&>span:first-child>span]:bg-green-500"
          />
          <span className="text-xs font-black text-green-400 w-8 text-center">{brushSize}px</span>
        </div>

        <div className="flex items-center gap-2 border-l border-gray-700 px-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleLocalLoad}
            accept="image/*"
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10 rounded-xl"
          >
            <Upload className="w-4 h-4 mr-2" />
            {t('gifEditor.drawLoadLocal')}
          </Button>

          {editingImage && (
            <div className="flex gap-1 bg-blue-900/30 p-1 rounded-xl border border-blue-500/30">
              <Button
                size="sm"
                onClick={confirmImage}
                className="bg-green-600 hover:bg-green-500 text-white rounded-lg h-8 px-2"
                title={t('gifEditor.drawConfirmImage')}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                onClick={cancelImage}
                className="bg-red-600 hover:bg-red-500 text-white rounded-lg h-8 px-2"
                title={t('gifEditor.drawCancel')}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {editingText && (
            <div className="flex gap-1 bg-green-900/30 p-1 rounded-xl border border-green-500/30">
              <Button
                size="sm"
                onClick={confirmText}
                className="bg-green-600 hover:bg-green-500 text-white rounded-lg h-8 px-2"
                title={t('gifEditor.drawConfirmText')}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                onClick={cancelText}
                className="bg-red-600 hover:bg-red-500 text-white rounded-lg h-8 px-2"
                title={t('gifEditor.drawCancel')}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        <Button
          variant={isBackgroundTransparent ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setIsBackgroundTransparent(prev => !prev)}
          className="border border-white/30 text-white rounded-xl px-4"
        >
          {isBackgroundTransparent ? t('gifEditor.drawBgTransparent') : t('gifEditor.drawBgOpaque')}
        </Button>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearCanvas}
            className="text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-xl transition-all"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t('gifEditor.drawClear')}
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveGifBackground}
              disabled={isRemovingBg}
              className="flex items-center gap-2 border border-transparent bg-gradient-to-r from-green-600 to-emerald-500 text-white rounded-xl px-4"
            >
              {isRemovingBg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isRemovingBg ? t('gifEditor.drawProcessing') : t('gifEditor.drawRemoveBg')}
            </Button>
            {removeBgError && <p className="absolute top-full left-0 mt-1 text-[10px] text-red-400 w-full">{removeBgError}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={persistFrame} className="text-white border border-white/30 rounded-xl flex items-center gap-2 px-4">
            <Copy className="w-4 h-4" />
            {t('gifEditor.drawCopyCanvas')}
          </Button>
          <Button onClick={finalizeFrame} size="sm" className="bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-black font-bold rounded-xl px-6 transition-all shadow-lg shadow-green-900/20">
            <Download className="w-4 h-4 mr-2" />
            {t('gifEditor.drawSaveFrame')}
          </Button>
          <div className="flex items-center gap-3 px-3 border-l border-gray-700">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">{t('gifEditor.drawCanvas')}</label>
            <Slider
              value={[canvasZoom]}
              onValueChange={(values) => setCanvasZoom(values[0])}
              min={0.5}
              max={2}
              step={0.1}
              className="w-32 [&>span:first-child]:bg-gray-900 [&>span:first-child>span]:bg-yellow-500"
            />
            <span className="text-xs font-black text-green-400 w-10 text-center">{Math.round(canvasZoom * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="border-4 border-gray-800 rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-white/5 flex justify-center items-center">
        <div
          className="relative"
          style={{
            width: CANVAS_BASE_WIDTH * canvasZoom,
            height: CANVAS_BASE_HEIGHT * canvasZoom
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_BASE_WIDTH}
            height={CANVAS_BASE_HEIGHT}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            className="absolute touch-none"
            style={{
              transform: `translate(-50%, -50%) scale(${canvasZoom})`,
              top: '50%',
              left: '50%',
              transformOrigin: 'center',
              cursor: editingImage
                ? 'move'
                : isNearClosingPoint && tool === 'shape' && shapeType === 'line'
                  ? CLOSING_CURSOR_DATA
                  : 'crosshair'
            }}
          />
        </div>
        {editingImage && (
          <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg animate-pulse">
            <Move className="w-3 h-3" />
            {t('gifEditor.drawImageMode')}
          </div>
        )}
        {editingText && (
          <div className="absolute top-4 left-4 bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg animate-pulse">
            <Move className="w-3 h-3" />
            {t('gifEditor.drawTextMode')}
          </div>
        )}
      </div>
    </div>
  );
}
