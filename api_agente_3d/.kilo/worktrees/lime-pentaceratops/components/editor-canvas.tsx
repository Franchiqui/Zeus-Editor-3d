'use client';

import { useState, useEffect, Key, useCallback, useRef } from 'react';
import { Polygon, Handle2D, roundedPolygonPath, rotatePolygon, DEFAULT_HANDLE_LEN } from '@/lib/geometry';
import { SHAPES } from '@/lib/shapes';
import { polylineToPathD } from '@/lib/polylines';
import type { Polyline, CanvasTool } from '@/lib/polylines';
import { usePolygonEditor } from '@/hooks/use-polygon-editor';
import { Slider } from '@/components/ui/slider';
import {
  Undo2,
  Redo2,
  Trash2,
  Magnet,
  Hand,
  ZoomIn,
  ZoomOut,
  X,
  Circle as CircleIcon,
  Square as SquareIcon,
  Triangle as TriangleIcon,
  Hexagon as HexagonIcon,
  Star as StarIcon,
  MousePointer2,
  Spline,
  Eraser,
  BoxSelect,
} from 'lucide-react';

/** Icono de cada forma geométrica de los botones */
const SHAPE_ICONS = {
  circulo: CircleIcon,
  cuadrado: SquareIcon,
  triangulo: TriangleIcon,
  hexagono: HexagonIcon,
  estrella: StarIcon,
} as const;

/** Herramientas del lienzo: edición de vértices, dibujar/borrar líneas
    libres y selección por marquesina. */
const TOOL_ICONS = {
  edit: MousePointer2,
  line: Spline,
  erase: Eraser,
  select: BoxSelect,
} as const;

const TOOLS: { id: CanvasTool; label: string; title: string }[] = [
  {
    id: 'edit',
    label: 'Editar',
    title:
      'Editar vértices: clic en una arista añade un vértice, arrastrar los mueve, doble clic los elimina',
  },
  {
    id: 'line',
    label: 'Línea',
    title:
      'Línea libre: clic para ir añadiendo puntos, doble clic o Enter para terminarla, Esc para cancelarla',
  },
  {
    id: 'erase',
    label: 'Borrar',
    title:
      'Borrar: si hay vértices seleccionados (marquesina), los elimina; si no, clic sobre una línea libre la elimina',
  },
  {
    id: 'select',
    label: 'Selección',
    title:
      'Selección: arrastra un cuadrado para seleccionar varios vértices (contorno y líneas) y muévelos todos a la vez; Ctrl+clic alterna uno',
  },
];

interface EditorCanvasProps {
  label?: string;
  axisLabel?: string;
  polygon?: any;
  resolution?: number;
  onChange?: (polygon: any) => void;
  onClose?: () => void;
  /** Muestra controles de escala para el perfil del torno. */
  enableScale?: boolean;
  gridResolution?: number;
  onGridResolutionChange?: (value: number) => void;
  canvasZoom?: number;
  onCanvasZoomChange?: (value: number) => void;
  onObjectSelect?: (id: string) => void;
  onObjectDeselect?: (id: string) => void;
  onTransform?: (id: string, transform: { x: number; y: number; z: number }) => void;
  children?: React.ReactNode;
  guideLines?: number[];
  /** Barra compacta de UNA fila (como la tira de plantillas): los
      controles no se apilan en varias filas aunque el panel sea
      estrecho; sobran desplazándose y el lienzo baja y ocupa el resto. */
  compact?: boolean;
  /** Polilíneas libres del lienzo (líneas abiertas aparte del
      contorno): se dibujan con la herramienta Línea y se guardan con
      la plantilla. Solo viven en el lienzo 2D. */
  polylines?: Polyline[];
  onPolylinesChange?: (lines: Polyline[]) => void;
  templateImage?: string | null;
  templateOpacity?: number;
  templateScale?: number;
}

/**
 * Lienzo grande para editar una vista ortogonal en lugar del visor 3D.
 * Igual de interactivo que DrawingCanvas, pero con imantación (snap)
 * a la cuadrícula activable con el botón del imán.
 */
export default function EditorCanvas({
  label,
  axisLabel,
  polygon,
  onChange,
  resolution = 16,
  onClose,
  enableScale = false,
  gridResolution: controlledGridResolution,
  onGridResolutionChange,
  canvasZoom: controlledCanvasZoom,
  onCanvasZoomChange,
  guideLines,
  compact = false,
  polylines,
  onPolylinesChange,
  templateImage = null,
  templateOpacity = 0.5,
  templateScale = 1,
}: EditorCanvasProps) {
  const [snap, setSnap] = useState(true);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, z: 0 });
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
  const [isRotating, setIsRotating] = useState(false);
  const [rotationAxis, setRotationAxis] = useState<'x' | 'y' | 'z'>('y');
  // Herramienta activa del lienzo (Editar/Línea/Borrar línea/Selección)
  const [tool, setTool] = useState<CanvasTool>('edit');
  const [localGridResolution, setLocalGridResolution] = useState(
    Math.max(4, Math.min(64, resolution))
  );
  const [localCanvasZoom, setLocalCanvasZoom] = useState(1);
  // Grado de la curva al curvar una esquina (Mayús con el vértice
  // seleccionado o pulsación larga): a más grado, más redondeada.
  const [curveAmount, setCurveAmount] = useState(DEFAULT_HANDLE_LEN);
  // Cantidad de vértices del arco al redondear una esquina (como el
  // slider de segmentos de la herramienta del editor de iconos): a
  // más vértices, el arco queda más suave.
  const [curveSegments, setCurveSegments] = useState(8);
  // Modo "Predibujar": al pasar por una esquina recta se predibuja la
  // curva en discontinuo con el grado del slider; pinchar la crea.
  const [curvePreview, setCurvePreview] = useState(false);
  // Herramienta mano: arrastra el lienzo para desplazar la vista cuando
  // el zoom no deja ver toda la figura. Se activa con su botón o
  // manteniendo pulsada la tecla Ctrl (mientras se mantenga).
  const [hand, setHand] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  // Desplazamiento del lienzo en unidades de dibujo (0..1): mueve la
  // ventana visible sin tocar el dibujo.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panDragging, setPanDragging] = useState(false);
  const panStartRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Ctrl mantiene la mano SOLO en modo edición: en Selección, Ctrl+clic
  // alterna vértices en la selección. El botón Mano funciona siempre.
  const panMode = hand || (ctrlHeld && tool === 'edit');
  const gridResolution = controlledGridResolution ?? localGridResolution;
  const canvasZoom = controlledCanvasZoom ?? localCanvasZoom;
  const setGridResolution = (value: number) => {
    setLocalGridResolution(value);
    onGridResolutionChange?.(value);
  };
  const setCanvasZoom = (value: number) => {
    setLocalCanvasZoom(value);
    onCanvasZoomChange?.(value);
  };
  // El perfil del torno usa coordenadas centradas en Y (también admite
  // valores negativos), así que su lienzo inicial necesita más rango que
  // las vistas normalizadas 0..1.
  const canvasBaseSpan = enableScale ? 2.4 : 1;
  const canvasSpan = canvasBaseSpan / canvasZoom;
  // La mano desplaza la ventana visible (el viewBox), no el dibujo.
  const canvasMinX = (1 - canvasSpan) / 2 + pan.x;
  const canvasMinY = (1 - canvasSpan) / 2 + pan.y;
  const canvasBounds = {
    minX: canvasMinX,
    maxX: canvasMinX + canvasSpan,
    minY: canvasMinY,
    maxY: canvasMinY + canvasSpan,
  };
  // Con el zoom, los puntos y segmentos de la figura mantienen SIEMPRE
  // el mismo tamaño en pantalla: sus medidas van divididas por el zoom
  // (a más zoom, menos unidades del lienzo ocupan los mismos píxeles).
  const uiScale = 1 / canvasZoom;

  const applyRotation = useCallback((poly: Polygon): Polygon => {
    if (rotation.y === 0) return poly;
    const cx = 0.5;
    const cy = 0.5;
    const cos = Math.cos(rotation.y);
    const sin = Math.sin(rotation.y);
    const rotatePoint = (pt: { x: number; y: number }) => {
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    };
    return poly.map((p) => ({
      ...rotatePoint(p),
      hIn: p.hIn ? rotatePoint(p.hIn) : undefined,
      hOut: p.hOut ? rotatePoint(p.hOut) : undefined,
    }));
  }, [rotation.y]);

  const rotate = (axis: 'x' | 'y' | 'z', delta: number) => {
    const nextRotation = { ...rotation, [axis]: rotation[axis] + delta };
    onChange?.(rotatePolygon(polygon, nextRotation.x, nextRotation.y, nextRotation.z));
    setRotation({ x: 0, y: 0, z: 0 });
  };

  const handleObjectSelect = useCallback((id: string) => {
    setSelectedObject(id);
  }, []);

  const handleObjectDeselect = useCallback((id: string) => {
    setSelectedObject(null);
  }, []);

  const handleTransform = useCallback((id: string, transformData: { x: number; y: number; z: number }) => {
    setTransform(transformData);
  }, []);

  const {
    svgRef,
    dragIndex,
    hoverIndex,
    curveIndex,
    handlers,
    vertexHandlers,
    handleHandlers,
    undo,
    redo,
    clear,
    applyShape,
    canUndo,
    canRedo,
    selectedVertex,
    getRoundPreview,
    draft,
    cursorPoint,
    hoverPolyline,
    marquee,
    selection,
    isSelected,
    setSelection,
    deleteSelectedVertices,
    commitDraft,
    cancelDraft,
    lastAddedAt,
    polylineVertexHandlers,
  } = usePolygonEditor({
    polygon,
    onChange: onChange ?? (() => { }),
    resolution: gridResolution,
    snap,
    // El puntero se mapea al área VISIBLE (que crece al alejar el zoom):
    // así se puede seguir dibujando con precisión con cualquier zoom y
    // hay lienzo de sobra alrededor para dibujar fuera de 0..1.
    coordinateBounds: canvasBounds,
    curveAmount,
    curveSegments,
    curvePreview,
    polylines,
    onPolylinesChange: onPolylinesChange ?? (() => { }),
    tool,
    // Radio de hit constante en pantalla con cualquier zoom
    pickRadius: 0.03 * uiScale,
  });

   // Cambiar de herramienta: cancela la línea a medias y la selección.
  // Reclic sobre la propia herramienta Línea confirma la línea en curso.
  // No se limpia la selección al pasar a la goma: así puedes seleccionar
  // varios vértices con Selección y borrarlos pulsando Borrar.
  const handleToolClick = useCallback(
    (id: CanvasTool) => {
      if (id === tool) {
        if (tool === 'line' && draft !== null) commitDraft();
        return;
      }
      if (draft !== null) cancelDraft();
      if (tool === 'select' && id !== 'select' && id !== 'erase') setSelection([]);
      setTool(id);
    },
    [tool, draft, commitDraft, cancelDraft, setSelection]
  );

  // Escape cierra el editor y vuelve al visor 3D… salvo mientras se
  // dibuja una línea: entonces cancela la polilínea (la cierra el hook)
  // en vez de cerrar todo el lienzo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draft === null) onClose?.();
      // Supr/Delete: borra los vértices seleccionados (marquesina)
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.ctrlKey &&
        !e.metaKey &&
        selection.length > 0
      ) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedVertices();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, draft, selection, deleteSelectedVertices]);

  // Mantener pulsado Ctrl activa la mano mientras se mantenga (soltar o
  // cambiar de ventana la desactiva).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false);
    };
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Arrastre con la mano: el dibujo sigue al puntero. La captura del
  // puntero permite seguir arrastrando aunque se salga del lienzo.
  const onPanPointerDown = (e: React.PointerEvent) => {
    panStartRef.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
    setPanDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPanPointerMove = (e: React.PointerEvent) => {
    const start = panStartRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!start || !rect) return;
    // Píxeles recorridos convertidos a unidades del lienzo (todo el
    // ancho visible son canvasSpan unidades).
    const dx = ((e.clientX - start.px) / rect.width) * canvasSpan;
    const dy = ((e.clientY - start.py) / rect.height) * canvasSpan;
    // Mover la mano a la derecha desplaza la ventana visible a la
    // izquierda: el dibujo se queda con el puntero.
    const clamp = (value: number) => Math.max(-1.5, Math.min(1.5, value));
    setPan({ x: clamp(start.x - dx), y: clamp(start.y - dy) });
  };
  const onPanPointerEnd = () => {
    panStartRef.current = null;
    setPanDragging(false);
  };

  // Zoom con la rueda del ratón: como acercar o alejar la figura. Solo
  // cambia la VISTA (el área visible y su cuadrícula); el dibujo no se
  // toca. Alejando aparece cuadrícula alrededor para tener más espacio
  // donde dibujar. Va en el contenedor (no en el svg) para que también
  // funcione cuando la capa de la mano está encima.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setCanvasZoom(Math.max(0.5, Math.min(2, canvasZoom * factor)));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [canvasZoom, setCanvasZoom]);

  // Rotación interactiva con el mouse
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isRotating) return;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 100;
      const y = (e.clientY - rect.top) / rect.height * 100;

      // Calcular rotación basada en la posición del mouse
      const angle = Math.atan2(y - 50, x - 50);
      setRotation(prev => ({
        x: 0,
        y: angle,
        z: 0
      }));
    };

    const handleMouseUp = () => {
      if (isRotating && rotation.y !== 0) {
        const cx = 0.5;
        const cy = 0.5;
        const cos = Math.cos(rotation.y);
        const sin = Math.sin(rotation.y);
        const rotated = polygon.map((p: { x: number; y: number }) => {
          const dx = p.x - cx;
          const dy = p.y - cy;
          return {
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos,
          };
        });
        onChange?.(rotated);
      }
      setIsRotating(false);
      setRotation({ x: 0, y: 0, z: 0 });
    };

    if (isRotating) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isRotating, polygon, rotation, onChange, svgRef]);

  const gridLines = [];
  // Cada dirección usa SU PROPIO rango visible: al mover el lienzo con
  // la mano, la vista se desplaza distinto en horizontal y en vertical,
  // y antes las líneas horizontales se calculaban con el rango de la
  // anchura — al subir o bajar desaparecían (solo quedaban líneas
  // verticales, sin cuadrícula).
  const xStart = Math.floor(canvasBounds.minX * gridResolution);
  const xEnd = Math.ceil(canvasBounds.maxX * gridResolution);
  const yStart = Math.floor(canvasBounds.minY * gridResolution);
  const yEnd = Math.ceil(canvasBounds.maxY * gridResolution);
  // vectorEffect="non-scaling-stroke": el grosor es SIEMPRE el mismo
  // en pantalla, haga el zoom que haga. Antes el grosor iba en
  // unidades del lienzo, y con mucho zoom quedaba más fino que un
  // píxel: el navegador las dejaba de pintar por zonas (sobre todo
  // arriba y abajo).
  for (let i = xStart; i <= xEnd; i++) {
    const isMajor = i % 4 === 0;
    const posX = (i / gridResolution) * 100;
    gridLines.push(
      <line
        key={`v${i}`}
        x1={posX}
        y1={canvasBounds.minY * 100}
        x2={posX}
        y2={canvasBounds.maxY * 100}
        stroke={isMajor ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.1)"}
        strokeWidth={isMajor ? 1.5 : 1}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  for (let i = yStart; i <= yEnd; i++) {
    const isMajor = i % 4 === 0;
    const posY = (i / gridResolution) * 100;
    gridLines.push(
      <line
        key={`h${i}`}
        x1={canvasBounds.minX * 100}
        y1={posY}
        x2={canvasBounds.maxX * 100}
        y2={posY}
        stroke={isMajor ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.1)"}
        strokeWidth={isMajor ? 1.5 : 1}
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  // Aplicar rotación a los puntos del polígono
  const rotatedPolygon = applyRotation(polygon);
  const closed = rotatedPolygon.length >= 3;
  const pathData = roundedPolygonPath(rotatedPolygon, closed);
  // Predibujo del arco (modo Predibujar): al pasar por una esquina
  // recta se ve en discontinuo el arco con el que quedará, con el radio
  // del slider. Mientras se ajusta el slider el predibujo se queda en
  // la última esquina sobrevolada, así se compara el tamaño en directo.
  let curvePreviewD: string | null = null;
  if (curvePreview && hoverIndex !== null && polygon.length >= 3) {
    const arc = getRoundPreview(hoverIndex);
    if (arc && arc.length >= 2) {
      const n = polygon.length;
      const i = hoverIndex;
      const prev = polygon[(i - 1 + n) % n];
      const next = polygon[(i + 1) % n];
      const c = (p: { x: number; y: number }) => `${p.x * 100} ${p.y * 100}`;
      curvePreviewD = [
        `M ${c(prev)}`,
        // Resto recto de la arista hasta el inicio del arco
        `L ${c(arc[0])}`,
        // Puntos del arco (de t1 a t2)
        ...arc.slice(1).map((p) => `L ${c(p)}`),
        // Resto recto hasta el vecino
        `L ${c(next)}`,
      ].join(' ');
    }
  }

  // Cuadrado discontinuo de la marquesina de selección, en unidades del
  // SVG (el viewBox va ×100).
  const marqueeRect = marquee
    ? {
        x: Math.min(marquee.x0, marquee.x1) * 100,
        y: Math.min(marquee.y0, marquee.y1) * 100,
        w: Math.abs(marquee.x1 - marquee.x0) * 100,
        h: Math.abs(marquee.y1 - marquee.y0) * 100,
      }
    : null;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 p-4">
      {compact && (
        /* Barra compacta de UNA sola fila (como la tira de plantillas):
           nunca se envuelve en varias filas — lo que no cabe sobra y se
           alcanza desplazando —, así el lienzo baja y ocupa todo el alto
           que dejan las herramientas, sin apilarse unas sobre otras. */
        <div className="flex items-center gap-1 mb-2 min-w-0 overflow-x-auto shrink-0 custom-scrollbar">
          <button
            onClick={onClose}
            className="p-1.5 shrink-0 rounded-md text-muted-foreground hover:text-foreground bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            title="Volver al visor 3D (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold text-foreground/90 shrink-0 whitespace-nowrap">
            {label}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-green-400/70 font-mono shrink-0 whitespace-nowrap">
            {axisLabel}
          </span>
          <div className="w-px h-4 bg-white/10 shrink-0" />
          {SHAPES.map((s) => {
            const Icon = SHAPE_ICONS[s.id];
            return (
              <button
                key={s.id}
                onClick={() => applyShape(s.build())}
                className="p-1 shrink-0 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
                title={`Insertar ${s.name.toLowerCase()} directamente`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
          <div className="w-px h-4 bg-white/10 shrink-0" />
          <button
            onClick={() => setSnap((s) => !s)}
            className={`p-1.5 shrink-0 rounded-md border transition-colors ${snap
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
              }`}
            title={
              snap
                ? 'Imantación activada: los puntos se ajustan a la cuadrícula'
                : 'Imantación desactivada: puntos libres'
            }
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setHand((h) => !h)}
            onDoubleClick={() => setPan({ x: 0, y: 0 })}
            className={`p-1.5 shrink-0 rounded-md border transition-colors ${panMode
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
              }`}
            title="Mano: arrastra el lienzo cuando la figura no cabe por el zoom (o mantén pulsado Ctrl). Doble clic aquí lo centra de nuevo"
          >
            <Hand className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-white/10 shrink-0" />
          {TOOLS.map((t) => {
            const Icon = TOOL_ICONS[t.id];
            return (
              <button
                key={t.id}
                onClick={() => handleToolClick(t.id)}
                className={`p-1.5 shrink-0 rounded-md border transition-colors ${tool === t.id
                  ? 'bg-green-500/20 text-green-300 border-green-500/30'
                  : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
                  }`}
                title={t.title}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
          <div className="w-px h-4 bg-white/10 shrink-0" />
          <label
            className="flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-md border border-white/10 bg-white/5"
            title="Ajustar el tamaño de los cuadrados de la cuadrícula"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Cuadrícula
            </span>
            <Slider
              min={4}
              max={64}
              step={1}
              value={[gridResolution]}
              onValueChange={([v]) => setGridResolution(v)}
              className="w-16"
            />
            <span className="w-5 text-right text-[10px] font-mono text-green-400">
              {gridResolution}
            </span>
          </label>
          <label
            className="flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-md border border-white/10 bg-white/5"
            title="Radio del arco al redondear una esquina (Predibujar, Mayús con el vértice seleccionado o Mayús+clic)"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Curva
            </span>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[curveAmount]}
              onValueChange={([v]) => setCurveAmount(v)}
              className="w-12"
            />
            <span className="w-7 text-right text-[10px] font-mono text-green-400">
              {Math.round(curveAmount * 100)}%
            </span>
          </label>
          <label
            className="flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-md border border-white/10 bg-white/5"
            title="Cantidad de vértices del arco al redondear una esquina"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Vértices
            </span>
            <Slider
              min={1}
              max={16}
              step={1}
              value={[curveSegments]}
              onValueChange={([v]) => setCurveSegments(v)}
              className="w-12"
            />
            <span className="w-5 text-right text-[10px] font-mono text-green-400">
              {curveSegments}
            </span>
          </label>
          <label
            className="flex items-center gap-1 shrink-0 px-1.5 py-1 rounded-md border border-white/10 bg-white/5 cursor-pointer"
            title="Modo predibujar: al pasar por una esquina recta se predibuja el arco en discontinuo; pinchar el vértice lo curva"
          >
            <input
              type="checkbox"
              checked={curvePreview}
              onChange={(event) => setCurvePreview(event.target.checked)}
              className="w-3 h-3 accent-green-500 cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Predibujar
            </span>
          </label>
          <div className="flex items-center gap-0.5 shrink-0 rounded-md border border-white/10 bg-white/5">
            <button
              onClick={() => setCanvasZoom(Math.max(0.5, canvasZoom * 0.8))}
              className="p-1.5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Alejar la figura (también con la rueda del ratón)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCanvasZoom(Math.min(2, canvasZoom * 1.25))}
              className="p-1.5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Acercar la figura (también con la rueda del ratón)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="px-1 text-[10px] font-mono text-muted-foreground w-8 text-right">
              {Math.round(canvasZoom * 100)}%
            </span>
          </div>
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Deshacer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Rehacer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clear}
            className="p-1.5 shrink-0 rounded-md text-muted-foreground hover:text-green-400 hover:bg-green-500/10 transition-colors"
            title="Limpiar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-white/10 shrink-0" />
          <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
            Rotación:
          </span>
          {([['x', 1, '+X'], ['x', -1, '-X'], ['y', 1, '+Y'], ['y', -1, '-Y'], ['z', 1, '+Z'], ['z', -1, '-Z']] as const).map(
            ([axis, sign, text]) => (
              <button
                key={text}
                onClick={() => rotate(axis as 'x' | 'y' | 'z', sign * Math.PI / 12)}
                className="px-1.5 py-1 shrink-0 rounded bg-white/10 text-[10px] hover:bg-white/20 transition-colors whitespace-nowrap"
                title={`Girar ${Math.round(sign * 15)}° en ${axis.toUpperCase()}`}
              >
                {text}
              </button>
            )
          )}
          <button
            onClick={() => setIsRotating(true)}
            className="p-1.5 shrink-0 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
            title="Girar con el mouse: haz clic y arrastra"
          >
            <span className="text-[10px]">↻</span>
          </button>
        </div>
      )}
      {!compact && (<>
      {/* Barra superior del editor: se parte en dos líneas limpias cuando
          el panel es estrecho, sin cortar botones por la mitad. */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors whitespace-nowrap shrink-0"
            title="Volver al visor 3D (Esc)"
          >
            <X className="w-3.5 h-3.5" />
            Volver al 3D
          </button>
          <span className="text-sm font-semibold text-foreground/90">
            Editando: {label}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-green-400/70 font-mono">
            {axisLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Formas geométricas de un clic: sustituyen la vista por la figura */}
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden mr-2">
            {SHAPES.map((s) => {
              const Icon = SHAPE_ICONS[s.id];
              return (
                <button
                  key={s.id}
                  onClick={() => applyShape(s.build())}
                  className="p-1.5 bg-white/5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10 border-r border-white/10 last:border-r-0 transition-colors"
                  title={`Insertar ${s.name.toLowerCase()} directamente`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setSnap((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${snap
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
              }`}
            title={
              snap
                ? 'Imantación activada: los puntos se ajustan a la cuadrícula'
                : 'Imantación desactivada: puntos libres'
            }
          >
            <Magnet className="w-3.5 h-3.5" />
            Imán
          </button>
          <button
            onClick={() => setHand((h) => !h)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${panMode
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10'
              }`}
            title={
              panMode
                ? 'Mano activada: arrastra el lienzo para mover la vista (también manteniendo pulsado Ctrl). Doble clic aquí lo centra de nuevo'
                : 'Mano: arrastra el lienzo cuando la figura no cabe por el zoom (o mantén pulsado Ctrl)'
            }
            onDoubleClick={() => setPan({ x: 0, y: 0 })}
          >
            <Hand className="w-3.5 h-3.5" />
            Mano
          </button>
          {/* Herramientas del lienzo: editar vértices, líneas libres y
              selección por marquesina */}
          <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
            {TOOLS.map((t) => {
              const Icon = TOOL_ICONS[t.id];
              return (
                <button
                  key={t.id}
                  onClick={() => handleToolClick(t.id)}
                  className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium border-r border-white/10 last:border-r-0 transition-colors whitespace-nowrap shrink-0 ${tool === t.id
                    ? 'bg-green-500/20 text-green-300'
                    : 'bg-white/5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10'
                    }`}
                  title={t.title}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <label
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 bg-white/5"
            title="Ajustar el tamaño de los cuadrados de la cuadrícula"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Cuadrícula
            </span>
            <Slider
              min={4}
              max={64}
              step={1}
              value={[gridResolution]}
              onValueChange={([v]) => setGridResolution(v)}
              className="w-20"
            />
            <span className="w-5 text-right text-[10px] font-mono text-green-400">
              {gridResolution}
            </span>
          </label>
          <label
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 bg-white/5"
            title="Radio del arco al redondear una esquina (casilla Predibujar, Mayús con el vértice seleccionado o Mayús+clic): es el mismo para todas las esquinas de la figura (fracción de su tamaño), así ninguna sale más chica que otra"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Curva
            </span>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[curveAmount]}
              onValueChange={([v]) => setCurveAmount(v)}
              className="w-14"
            />
            <span className="w-7 text-right text-[10px] font-mono text-green-400">
              {Math.round(curveAmount * 100)}%
            </span>
          </label>
          <label
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 bg-white/5"
            title="Cantidad de vértices del arco al redondear una esquina (como el slider de la herramienta del editor de iconos): a más vértices, el arco queda más suave"
          >
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Vértices
            </span>
            <Slider
              min={1}
              max={16}
              step={1}
              value={[curveSegments]}
              onValueChange={([v]) => setCurveSegments(v)}
              className="w-14"
            />
            <span className="w-5 text-right text-[10px] font-mono text-green-400">
              {curveSegments}
            </span>
          </label>
          <label
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10 bg-white/5 cursor-pointer"
            title="Modo predibujar (como la herramienta de esquina redondeada del editor de iconos): al pasar por una esquina recta se predibuja el arco en discontinuo con el radio del slider; pinchar el vértice sustituye la esquina por ese arco. Pinchar con Mayús mantenida hace lo mismo sin activar la casilla"
          >
            <input
              type="checkbox"
              checked={curvePreview}
              onChange={(event) => setCurvePreview(event.target.checked)}
              className="w-3 h-3 accent-green-500 cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              Predibujar
            </span>
          </label>
          <div className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5">
            <button
              onClick={() => setCanvasZoom(Math.max(0.5, canvasZoom * 0.8))}
              className="p-1.5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Alejar la figura (también con la rueda del ratón): solo cambia la vista, la figura no varía"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCanvasZoom(Math.min(2, canvasZoom * 1.25))}
              className="p-1.5 text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Acercar la figura (también con la rueda del ratón)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="px-1 text-[10px] font-mono text-muted-foreground w-8 text-right">
              {Math.round(canvasZoom * 100)}%
            </span>
          </div>
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Deshacer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Rehacer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clear}
            className="p-1.5 rounded-md text-muted-foreground hover:text-green-400 hover:bg-green-500/10 transition-colors"
            title="Limpiar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Controles de rotación */}
      <div className="flex items-center gap-2 mb-3 p-2 bg-white/5 rounded-md border border-white/10">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Rotación:</span>
          <button
            onClick={() => rotate('x', Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            +X
          </button>
          <button
            onClick={() => rotate('x', -Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            -X
          </button>
        </div>
        <div className="w-px h-4 bg-white/10"></div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => rotate('y', Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            +Y
          </button>
          <button
            onClick={() => rotate('y', -Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            -Y
          </button>
        </div>
        <div className="w-px h-4 bg-white/10"></div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => rotate('z', Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            +Z
          </button>
          <button
            onClick={() => rotate('z', -Math.PI / 12)}
            className="px-2 py-1 rounded bg-white/10 text-xs hover:bg-white/20 transition-colors"
          >
            -Z
          </button>
        </div>
        <div className="w-px h-4 bg-white/10"></div>
        <button
          onClick={() => setIsRotating(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
          title="Girar con el mouse: haz clic y arrastra"
        >
          <span className="text-[10px]">↻</span>
          Girar con mouse
        </button>
      </div>
      </>)}

      {/* Lienzo grande */}
      <div className="flex-1 min-h-0 w-full h-full flex items-center justify-center p-2">
        <div
          ref={containerRef}
          className="relative rounded-lg overflow-hidden border border-white/10 flex items-center justify-center"
          style={{
            background:
              'radial-gradient(ellipse at center, hsl(224 45% 14%) 0%, hsl(224 50% 9%) 100%)',
            aspectRatio: '1',
            height: '100%',
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`${canvasBounds.minX * 100} ${canvasBounds.minY * 100} ${canvasSpan * 100} ${canvasSpan * 100}`}
            className="w-full h-full touch-none block"
            {...handlers}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={() => {
              if (selectedObject && isRotating) {
                setIsRotating(true);
              }
            }}
            onDoubleClick={(e) => {
              // Doble clic mientras se dibuja una línea: la confirma. El
              // segundo clic del doble clic añadió un punto duplicado
              // justo en el mismo sitio: se confirma sin él.
              if (tool === 'line' && draft !== null) {
                e.preventDefault();
                if (
                  Date.now() - lastAddedAt.current < 350 &&
                  draft.length >= 3
                ) {
                  commitDraft(draft.slice(0, -1));
                } else {
                  commitDraft();
                }
              }
            }}
             style={{ cursor: tool === 'line' ? 'crosshair' : 'default' }}
             >
            {templateImage && (
              <image
                href={templateImage}
                x={50 - (templateScale * 100) / 2}
                y={50 - (templateScale * 100) / 2}
                width={templateScale * 100}
                height={templateScale * 100}
                opacity={templateOpacity}
                preserveAspectRatio="xMidYMid meet"
              />
            )}
            <defs>
              <linearGradient id={`fill-editor-${axisLabel}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(145 70% 45%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(145 80% 25%)" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            {gridLines}
            {enableScale ? (
              <>
                <line
                  x1={0}
                  y1={canvasBounds.minY * 100}
                  x2={0}
                  y2={canvasBounds.maxY * 100}
                  stroke="hsl(145 80% 60%)"
                  strokeWidth={0.8}
                  strokeDasharray={`${2 * uiScale} ${1.5 * uiScale}`}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.9}
                />
                <line
                  x1={canvasBounds.minX * 100}
                  y1={0}
                  x2={canvasBounds.maxX * 100}
                  y2={0}
                  stroke="hsl(145 80% 60%)"
                  strokeWidth={0.8}
                  strokeDasharray={`${2 * uiScale} ${1.5 * uiScale}`}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.6}
                />
              </>
            ) : (
              <>
                <line
                  x1={50}
                  y1={canvasBounds.minY * 100}
                  x2={50}
                  y2={canvasBounds.maxY * 100}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={0.8}
                  strokeDasharray={`${2 * uiScale} ${2 * uiScale}`}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={canvasBounds.minX * 100}
                  y1={50}
                  x2={canvasBounds.maxX * 100}
                  y2={50}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={0.8}
                  strokeDasharray={`${2 * uiScale} ${2 * uiScale}`}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
            {!enableScale && canvasSpan > 1.001 && (
              /* Borde del lienzo original (0..1) al alejar el zoom: la
                 cuadrícula de alrededor es espacio extra de dibujo */
              <rect
                x={0}
                y={0}
                width={100}
                height={100}
                fill="none"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth={0.8}
                strokeDasharray={`${3 * uiScale} ${2 * uiScale}`}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {closed && (
              <path
                d={pathData}
                fill={`url(#fill-editor-${axisLabel})`}
                stroke="none"
              />
            )}
            {guideLines?.map((y, i) => (
              <line
                key={`guide-${i}`}
                x1={canvasBounds.minX * 100}
                y1={y * 100}
                x2={canvasBounds.maxX * 100}
                y2={y * 100}
                stroke="hsl(0 80% 60%)"
                strokeWidth={0.8}
                strokeDasharray={`${2 * uiScale} ${1.5 * uiScale}`}
                vectorEffect="non-scaling-stroke"
                opacity={0.8}
              />
            ))}
            {rotatedPolygon.length > 0 && (
              <path
                d={pathData}
                fill="none"
                stroke="hsl(145 75% 55%)"
                strokeWidth={1.3}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* Polilíneas libres (solo 2D): no interactúan aquí; la goma
                hit-testea por distancia en el hook. La que quedaría
                borrada se resalta en rojo. */}
            {(polylines ?? []).map((line) => {
              const d = polylineToPathD(
                line.points.map((p) => ({ x: p.x * 100, y: p.y * 100 }))
              );
              if (!d) return null;
              const hovered = tool === 'erase' && hoverPolyline === line.id;
              return (
                <path
                  key={line.id}
                  d={d}
                  fill="none"
                  stroke={hovered ? 'hsl(0 80% 60%)' : 'hsl(190 85% 60%)'}
                  strokeWidth={hovered ? 1.6 : 1.1}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                  opacity={0.95}
                />
              );
            })}
            {/* Línea en curso (herramienta Línea): trazada + segmento
                discontinuo de previsualización hasta el cursor */}
            {draft !== null && draft.length > 0 && (
              <>
                <path
                  d={polylineToPathD(
                    draft.map((p) => ({ x: p.x * 100, y: p.y * 100 }))
                  )}
                  fill="none"
                  stroke="hsl(190 95% 75%)"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                {cursorPoint && (
                  <line
                    x1={draft[draft.length - 1].x * 100}
                    y1={draft[draft.length - 1].y * 100}
                    x2={cursorPoint.x * 100}
                    y2={cursorPoint.y * 100}
                    stroke="hsl(190 95% 75%)"
                    strokeWidth={1}
                    strokeDasharray={`${2 * uiScale} ${1.5 * uiScale}`}
                    vectorEffect="non-scaling-stroke"
                    opacity={0.8}
                    pointerEvents="none"
                  />
                )}
                {draft.map((p, i) => (
                  <circle
                    key={`d${i}`}
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={0.4 * uiScale}
                    fill="hsl(190 95% 75%)"
                    stroke="hsl(224 50% 8%)"
                    strokeWidth={0.2 * uiScale}
                    pointerEvents="none"
                  />
                ))}
              </>
            )}
            {/* Marquesina de selección: el cuadrado discontinuo que se
                arrastra con el ratón */}
            {marqueeRect && (
              <rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.w}
                height={marqueeRect.h}
                fill="hsl(145 90% 70%)"
                fillOpacity={0.08}
                stroke="hsl(145 90% 70%)"
                strokeWidth={1}
                strokeDasharray={`${2 * uiScale} ${1.5 * uiScale}`}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {/* Vértices de las polilíneas: solo interactúan con la
                herramienta Selección (halos arrastrables + anillo cuando
                están seleccionados) */}
            {tool === 'select' &&
              (polylines ?? []).map((line, li) =>
                line.points.map((p, i) => {
                  const vh = polylineVertexHandlers(li, i);
                  const sel = isSelected({ line: li, vertex: i });
                  return (
                    <g key={`pl-${li}-${i}`}>
                      {/* Halo invisible: zona de agarre del vértice */}
                      <circle
                        cx={p.x * 100}
                        cy={p.y * 100}
                        r={2.2 * uiScale}
                        fill="transparent"
                        onPointerDown={vh.onPointerDown}
                        onDoubleClick={vh.onDoubleClick}
                      />
                      {sel && (
                        <circle
                          cx={p.x * 100}
                          cy={p.y * 100}
                          r={1.4 * uiScale}
                          fill="none"
                          stroke="hsl(200 90% 70%)"
                          strokeWidth={0.4 * uiScale}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      )}
                      <circle
                        cx={p.x * 100}
                        cy={p.y * 100}
                        r={0.4 * uiScale}
                        fill="hsl(190 85% 60%)"
                        stroke="hsl(224 50% 8%)"
                        strokeWidth={0.2 * uiScale}
                        onPointerDown={vh.onPointerDown}
                        onDoubleClick={vh.onDoubleClick}
                      />
                    </g>
                  );
                })
              )}
            {curvePreviewD && (
              <path
                d={curvePreviewD}
                fill="none"
                stroke="hsl(145 95% 75%)"
                strokeWidth={1.2}
                strokeDasharray={`${3 * uiScale} ${2 * uiScale}`}
                vectorEffect="non-scaling-stroke"
                opacity={0.95}
              />
            )}
            {/* Asas de las esquinas curvadas: segmentos laterales arrastrables */}
            {closed &&
              rotatedPolygon.map((p, i) => {
                const handles: { side: 'in' | 'out'; h: Handle2D }[] = [];
                if (p.hIn) handles.push({ side: 'in', h: p.hIn });
                if (p.hOut) handles.push({ side: 'out', h: p.hOut });
                if (handles.length === 0) return null;
                return handles.map(({ side, h }) => {
                  const hh = handleHandlers(i, side);
                  return (
                    <g
                      key={`h${i}-${side}`}
                      style={{
                        pointerEvents:
                          tool === 'edit' || tool === 'select'
                            ? 'auto'
                            : 'none',
                      }}
                    >
                      {/* Halo invisible: zona de agarre del asa */}
                      <circle
                        cx={h.x * 100}
                        cy={h.y * 100}
                        r={2.2 * uiScale}
                        fill="transparent"
                        onPointerDown={hh.onPointerDown}
                      />
                      <line
                        x1={p.x * 100}
                        y1={p.y * 100}
                        x2={h.x * 100}
                        y2={h.y * 100}
                        stroke="hsl(200 80% 60%)"
                        strokeWidth={1}
                        strokeDasharray={`${1.2 * uiScale} ${1.2 * uiScale}`}
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={h.x * 100}
                        cy={h.y * 100}
                        r={0.55 * uiScale}
                        fill="hsl(200 80% 60%)"
                        stroke="hsl(224 50% 8%)"
                        strokeWidth={0.2 * uiScale}
                        onPointerDown={hh.onPointerDown}
                      />
                    </g>
                  );
                });
              })}
            {rotatedPolygon.map((p, i) => {
              const vh = vertexHandlers(i);
              const sel = isSelected({ line: -1, vertex: i });
              return (
                <g
                  key={i}
                  /* Con Línea o la goma, los vértices del contorno no se
                     dejan agarrar: los clics van al fondo del lienzo. */
                  style={{
                    pointerEvents:
                      tool === 'edit' || tool === 'select' ? 'auto' : 'none',
                  }}
                >
                  {/* Halo invisible: zona de agarre del vértice */}
                  <circle
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={3 * uiScale}
                    fill="transparent"
                    onPointerDown={vh.onPointerDown}
                    onDoubleClick={vh.onDoubleClick}
                  />
                  {(hoverIndex === i || dragIndex === i || curveIndex === i) &&
                    rotatedPolygon.length > 1 && (
                      <circle
                        cx={p.x * 100}
                        cy={p.y * 100}
                        r={1.7 * uiScale}
                        fill="none"
                        stroke={curveIndex === i ? 'hsl(45 95% 70%)' : 'hsl(145 90% 70%)'}
                        strokeWidth={0.3 * uiScale}
                        opacity={0.5}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                  {/* Anillo de selección múltiple (marquesina) */}
                  {sel && (
                    <circle
                      cx={p.x * 100}
                      cy={p.y * 100}
                      r={1.4 * uiScale}
                      fill="none"
                      stroke="hsl(200 90% 70%)"
                      strokeWidth={0.4 * uiScale}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  )}
                  <circle
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={(dragIndex === i ? 0.65 : 0.5) * uiScale}
                    fill={
                      curveIndex === i
                        ? 'hsl(45 95% 60%)'
                        : selectedVertex === i
                          ? 'hsl(0 0% 100%)'
                          : p.hIn || p.hOut
                            ? 'hsl(200 80% 60%)'
                            : dragIndex === i
                              ? 'hsl(145 90% 65%)'
                              : 'hsl(145 70% 50%)'
                    }
                    stroke="hsl(224 50% 8%)"
                    strokeWidth={0.2 * uiScale}
                    onPointerDown={vh.onPointerDown}
                    onDoubleClick={vh.onDoubleClick}
                  />
                </g>
              );
            })}
          </svg>
          {/* Capa de la mano: mientras está activada, cubre el lienzo para
              que arrastrar mueva la vista en vez de dibujar. Doble clic
              vuelve a centrar el lienzo. */}
          {panMode && (
            <div
              className="absolute inset-0 z-10 touch-none select-none"
              onPointerDown={onPanPointerDown}
              onPointerMove={onPanPointerMove}
              onPointerUp={onPanPointerEnd}
              onPointerCancel={onPanPointerEnd}
              onDoubleClick={() => setPan({ x: 0, y: 0 })}
              onContextMenu={(e) => e.preventDefault()}
              style={{ cursor: panDragging ? 'grabbing' : 'grab' }}
            />
          )}
          {rotatedPolygon.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-sm text-muted-foreground/50">
                Haz clic para dibujar
              </span>
            </div>
          )}
          <div className="absolute bottom-2 left-3 text-[10px] text-muted-foreground/40 font-mono pointer-events-none">
            {rotatedPolygon.length} pts · Herramientas: Editar (clic en
            una arista añade un vértice; doble clic elimina) · Línea
            (clic-clic…, doble clic o Enter termina, Esc cancela) · Borrar
            línea (clic sobre una línea libre) · Selección (arrastra el
            cuadrado discontinuo para marcar varios vértices del contorno
            y de las líneas, y moverlos todos a la vez; Ctrl+clic alterna) ·
            Mano (o Ctrl pulsado): arrastra el lienzo ·
            Doble clic con la mano lo centra
          </div>
          {/* Indicador del modo curva */}
          {curveIndex !== null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-amber-950/80 border border-amber-700/50 text-amber-200 text-xs backdrop-blur-sm pointer-events-none">
              Modo curva · mueve el ratón para graduar · luego arrastra las guías azules
            </div>
          )}
          {/* Indicador de rotación activa */}
          {isRotating && (
            <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-green-500/80 text-white text-xs font-medium pointer-events-none animate-pulse">
              Girando...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


