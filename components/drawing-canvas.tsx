'use client';

import { Polygon, Handle2D, roundedPolygonPath } from '@/lib/geometry';
import { SHAPES } from '@/lib/shapes';
import { polylineToPathD } from '@/lib/polylines';
import type { Polyline } from '@/lib/polylines';
import { usePolygonEditor } from '@/hooks/use-polygon-editor';
import {
  Undo2,
  Redo2,
  Trash2,
  Pencil,
  Maximize2,
  Circle as CircleIcon,
  Square as SquareIcon,
  Triangle as TriangleIcon,
  Hexagon as HexagonIcon,
  Star as StarIcon,
} from 'lucide-react';

// En el canvas, dibujar el eje
const drawAxis = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  axisVertical = false,
) => {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  if (axisVertical) {
    // Línea vertical en el centro
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
  } else {
    // Líneas horizontales y verticales (rejilla estándar)
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
  }

  ctx.restore();
};

/** Icono de cada forma geométrica de los botones */
const SHAPE_ICONS = {
  circulo: CircleIcon,
  cuadrado: SquareIcon,
  triangulo: TriangleIcon,
  hexagono: HexagonIcon,
  estrella: StarIcon,
} as const;

interface DrawingCanvasProps {
  label: string;
  axisLabel: string;
  polygon: Polygon;
  onChange: (polygon: Polygon) => void;
  resolution?: number;
  showAxis?: boolean;
  axisVertical?: boolean;
  onEdit?: () => void;
  /** Maximizar y ocupar todo el espacio del editor */
  onMaximize?: () => void;
  /** Zoom (1 = tamaño original) */
  zoom?: number;
  /** Desplazamiento en unidades del viewBox (100x100) */
  offsetX?: number;
  offsetY?: number;
  /** Ocultar cabecera con botones (para uso en grid principal) */
  showHeader?: boolean;
  guideLines?: number[];
  /** Polilíneas libres del lienzo grande: en la miniatura SOLO se
      muestran (finas, cian), no se editan aquí. */
  polylines?: Polyline[];
}

export default function DrawingCanvas({
  label,
  axisLabel,
  polygon,
  onChange,
  resolution = 16,
  showAxis = false,
  axisVertical = false,
  onEdit,
  onMaximize,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
  showHeader = true,
  guideLines,
  polylines,
}: DrawingCanvasProps) {
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
  } = usePolygonEditor({ polygon, onChange, resolution });

  const gridLines = [];
  for (let i = 0; i <= resolution; i++) {
    const pos = (i / resolution) * 100;
    gridLines.push(
      <line
        key={`v${i}`}
        x1={pos}
        y1={0}
        x2={pos}
        y2={100}
        stroke="hsl(224 30% 26%)"
        strokeWidth={0.15}
        opacity={i % 4 === 0 ? 0.8 : 0.4}
      />
    );
    gridLines.push(
      <line
        key={`h${i}`}
        x1={0}
        y1={pos}
        x2={100}
        y2={pos}
        stroke="hsl(224 30% 26%)"
        strokeWidth={0.15}
        opacity={i % 4 === 0 ? 0.8 : 0.4}
      />
    );
  }

  const closed = polygon.length >= 3;
  const pathData = roundedPolygonPath(polygon, closed);

  return (
    <div className="flex flex-col gap-2 h-full">
      {showHeader && (
        <div className="flex items-center justify-between min-w-0">
          <div className="flex items-center gap-2 min-w-0 shrink">
            <span className="text-sm font-semibold text-foreground/90">{label}</span>
            <span className="text-[10px] uppercase tracking-wider text-green-400/70 font-mono">
              {axisLabel}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Formas geométricas de un clic: sustituyen la vista por la figura */}
            {SHAPES.map((s) => {
              const Icon = SHAPE_ICONS[s.id];
              return (
                <button
                  key={s.id}
                  onClick={() => applyShape(s.build())}
                  className="p-1 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
                  title={`Insertar ${s.name.toLowerCase()} directamente`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
            {onEdit && (
              <button
                onClick={onEdit}
                className="p-1 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
                title="Editar en el lienzo grande"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {onMaximize && (
              <button
                onClick={onMaximize}
                className="p-1 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
                title="Maximizar (ocupar todo el espacio)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Deshacer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Rehacer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={clear}
              className="p-1 rounded-md text-muted-foreground hover:text-green-400 hover:bg-green-500/10 transition-colors"
              title="Limpiar"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      <div
        className="relative flex-1 rounded-lg overflow-hidden border border-white/10"
        style={{
          background:
            'radial-gradient(ellipse at center, hsl(224 45% 14%) 0%, hsl(224 50% 9%) 100%)',
        }}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full touch-none"
          {...handlers}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: 'default' }}
        >
          <defs>
            <linearGradient id={`fill-${axisLabel}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(145 70% 45%)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(145 80% 25%)" stopOpacity={0.2} />
            </linearGradient>
          </defs>
          <g transform={`translate(${50 + offsetX} ${50 + offsetY}) scale(${zoom}) translate(-50 -50)`}>
            {gridLines}
            {showAxis && (
              <line
                x1={axisVertical ? 50 : 0}
                y1={axisVertical ? 0 : 50}
                x2={axisVertical ? 50 : 100}
                y2={axisVertical ? 100 : 50}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={0.7}
                strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {closed && (
              <path
                d={pathData}
                fill={`url(#fill-${axisLabel})`}
                stroke="none"
              />
            )}
            {guideLines?.map((y, i) => (
              <line
                key={`guide-${i}`}
                x1={0}
                y1={y * 100}
                x2={100}
                y2={y * 100}
                stroke="hsl(0 80% 60%)"
                strokeWidth={0.8}
                strokeDasharray={`${2 / zoom} ${1.5 / zoom}`}
                vectorEffect="non-scaling-stroke"
                opacity={0.8}
              />
            ))}
            {polygon.length > 0 && (
              <path
                d={pathData}
                fill="none"
                stroke="hsl(145 75% 55%)"
                strokeWidth={0.3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* Polilíneas libres: solo se muestran en la miniatura (la
                edición con las herramientas está en el lienzo grande) */}
            {(polylines ?? []).map((line) => {
              const d = polylineToPathD(
                line.points.map((p) => ({ x: p.x * 100, y: p.y * 100 }))
              );
              if (!d) return null;
              return (
                <path
                  key={line.id}
                  d={d}
                  fill="none"
                  stroke="hsl(190 85% 60%)"
                  strokeWidth={0.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                  opacity={0.95}
                />
              );
            })}
            {/* Asas de las esquinas curvadas: segmentos laterales arrastrables */}
            {closed &&
              polygon.map((p, i) => {
                const handles: { side: 'in' | 'out'; h: Handle2D }[] = [];
                if (p.hIn) handles.push({ side: 'in', h: p.hIn });
                if (p.hOut) handles.push({ side: 'out', h: p.hOut });
                if (handles.length === 0) return null;
                return handles.map(({ side, h }) => {
                  const hh = handleHandlers(i, side);
                  return (
                    <g key={`h${i}-${side}`}>
                      {/* Halo invisible: zona de agarre del asa */}
                      <circle
                        cx={h.x * 100}
                        cy={h.y * 100}
                        r={2.2}
                        fill="transparent"
                        onPointerDown={hh.onPointerDown}
                      />
                      <line
                        x1={p.x * 100}
                        y1={p.y * 100}
                        x2={h.x * 100}
                        y2={h.y * 100}
                        stroke="hsl(200 80% 60%)"
                        strokeWidth={0.15}
                        strokeDasharray="1 1"
                        opacity={0.7}
                      />
                      <circle
                        cx={h.x * 100}
                        cy={h.y * 100}
                        r={0.65}
                        fill="hsl(200 80% 60%)"
                        stroke="hsl(224 50% 8%)"
                        strokeWidth={0.2}
                        onPointerDown={hh.onPointerDown}
                      />
                    </g>
                  );
                });
              })}
            {polygon.map((p, i) => {
              const vh = vertexHandlers(i);
              return (
                <g key={i}>
                  {/* Halo invisible: zona de agarre del vértice */}
                  <circle
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={3}
                    fill="transparent"
                    onPointerDown={vh.onPointerDown}
                    onDoubleClick={vh.onDoubleClick}
                  />
                  {(hoverIndex === i || dragIndex === i) && polygon.length > 1 && (
                    <circle
                      cx={p.x * 100}
                      cy={p.y * 100}
                      r={1.8}
                      fill="none"
                      stroke="hsl(145 90% 70%)"
                      strokeWidth={0.3}
                      opacity={0.5}
                    />
                  )}
                  <circle
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={dragIndex === i ? 0.65 : 0.5}
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
                    strokeWidth={0.2}
                    className="transition-all"
                    onPointerDown={vh.onPointerDown}
                    onDoubleClick={vh.onDoubleClick}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {polygon.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-muted-foreground/50">
            Haz clic para dibujar
          </span>
        </div>
      )}
      <div className="absolute bottom-1.5 left-2 text-[9px] text-muted-foreground/40 font-mono pointer-events-none">
        {polygon.length} pts
      </div>
    </div>
  );
}