#!/usr/bin/env node
/**
 * Cambios (idempotentes):
 *  1) Subdivisiones por defecto = 5 (en vez de 10) en Editor3D.
 *  2) Zoom + paneo interactivo en las PLANTILLAS (drawing-canvas.tsx).
 *
 * path-canvas.tsx (el Recorrido) se reescribe aparte.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editorPath = path.join(root, 'components/editor/Editor3D.tsx');
const drawPath = path.join(root, 'components/drawing-canvas.tsx');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }
function backup(p) { if (!fs.existsSync(p + '.zoom.bak')) fs.copyFileSync(p, p + '.zoom.bak'); }
function replaceOnce(src, from, to, label) {
  const i = src.indexOf(from);
  if (i === -1) {
    if (src.indexOf(to) !== -1) { console.log('· ya aplicado:', label); return src; }
    throw new Error('No encontrado: ' + label + '\n---\n' + from + '\n---');
  }
  if (src.indexOf(from, i + 1) !== -1) throw new Error('No único: ' + label);
  console.log('✔', label);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

/* ---------------------------------------------------------------- *
 * 1) Subdivisiones por defecto = 5
 * ---------------------------------------------------------------- */
{
  backup(editorPath);
  let s = read(editorPath);
  s = replaceOnce(s,
    '(a.sweepSubdivisions ?? 10) === (b.sweepSubdivisions ?? 10)',
    '(a.sweepSubdivisions ?? 5) === (b.sweepSubdivisions ?? 5)',
    'isSameHistoryState: default subdivisiones');
  s = replaceOnce(s,
    'const [sweepSubdivisions, setSweepSubdivisions] = useState(10);',
    'const [sweepSubdivisions, setSweepSubdivisions] = useState(5);',
    'estado inicial subdivisiones = 5');
  s = replaceOnce(s,
    'setSweepSubdivisions(state.sweepSubdivisions ?? 10);',
    'setSweepSubdivisions(state.sweepSubdivisions ?? 5);',
    'applyHistoryState: default subdivisiones');
  write(editorPath, s);
}

/* ---------------------------------------------------------------- *
 * 2) drawing-canvas.tsx: zoom + paneo interactivo (plantillas)
 * ---------------------------------------------------------------- */
{
  backup(drawPath);
  let s = read(drawPath);

  // --- imports ---
  s = replaceOnce(s,
    "import { usePolygonEditor } from '@/hooks/use-polygon-editor';",
    "import { usePolygonEditor } from '@/hooks/use-polygon-editor';\nimport { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';",
    'import react hooks');
  s = replaceOnce(s,
    "  Star as StarIcon,\n} from 'lucide-react';",
    "  Star as StarIcon,\n  ZoomIn,\n  ZoomOut,\n  Hand,\n} from 'lucide-react';",
    'import iconos zoom');

  // --- props ---
  s = replaceOnce(s,
    '  /** Zoom (1 = tamaño original) */\n  zoom?: number;',
    '  /** Zoom inicial (1 = tamaño original). Si se omite, es interactivo. */\n  zoom?: number;',
    'prop zoom');

  // --- firma del componente ---
  s = replaceOnce(s,
    '  zoom = 1,\n  offsetX = 0,\n  offsetY = 0,\n  showHeader = true,\n  guideLines,\n  polylines,\n}: DrawingCanvasProps) {',
    '  zoom,\n  offsetX,\n  offsetY,\n  showHeader = true,\n  guideLines,\n  polylines,\n}: DrawingCanvasProps) {',
    'firma componente');

  // --- estado de zoom/paneo ANTES del hook ---
  s = replaceOnce(s,
    '  const {\n    svgRef,\n    dragIndex,',
    `  /* ---- Zoom / paneo interactivo de la plantilla ---- */
  // El zoom se aplica al viewBox (no con un transform) para que el editor de
  // polígonos siga mapeando bien el puntero: le pasamos el área VISIBLE.
  const [localZoom, setLocalZoom] = useState(zoom ?? 1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hand, setHand] = useState(false);
  const [panDragging, setPanDragging] = useState(false);
  const panStartRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const effZoom = zoom ?? localZoom;
  const offX = offsetX ?? 0;
  const offY = offsetY ?? 0;
  const span = 1 / effZoom; // lado del área visible (unidades 0..1)
  const cMinX = 0.5 - span / 2 + offX + pan.x;
  const cMinY = 0.5 - span / 2 + offY + pan.y;
  const canvasBounds = {
    minX: cMinX,
    maxX: cMinX + span,
    minY: cMinY,
    maxY: cMinY + span,
  };
  const viewMinX = cMinX * 100;
  const viewMinY = cMinY * 100;
  const viewSpan = span * 100;

  const clampZoom = (z: number) => Math.max(0.5, Math.min(8, z));
  const zoomStep = (factor: number) => {
    if (zoom !== undefined) return; // controlado por el padre
    setLocalZoom((z) => clampZoom(z * factor));
  };
  const resetView = () => {
    if (zoom !== undefined) return;
    setLocalZoom(zoom ?? 1);
    setPan({ x: 0, y: 0 });
  };

  // Rueda del ratón: acerca/aleja alrededor del cursor. Va en el contenedor
  // para que siga funcionando con la capa de la mano por encima.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (zoom !== undefined) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      // Punto del lienzo bajo el cursor (unidades 0..1).
      const cx = fx * span + cMinX;
      const cy = fy * span + cMinY;
      const nz = clampZoom(effZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      const nspan = 1 / nz;
      const nbase = 0.5 - nspan / 2;
      setLocalZoom(nz);
      setPan({ x: cx - fx * nspan - nbase - offX, y: cy - fy * nspan - nbase - offY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, effZoom, span, cMinX, cMinY, offX, offY]);

  const onPanPointerDown = (e: ReactPointerEvent) => {
    panStartRef.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
    setPanDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPanPointerMove = (e: ReactPointerEvent) => {
    const start = panStartRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!start || !rect || zoom !== undefined) return;
    const dx = ((e.clientX - start.px) / rect.width) * span;
    const dy = ((e.clientY - start.py) / rect.height) * span;
    setPan({ x: start.x - dx, y: start.y - dy });
  };
  const onPanPointerEnd = () => {
    panStartRef.current = null;
    setPanDragging(false);
  };

  const {\n    svgRef,\n    dragIndex,`,
    'estado zoom/paneo antes del hook');

  // --- inyectar coordinateBounds en el hook ---
  s = replaceOnce(s,
    'usePolygonEditor({ polygon, onChange, resolution })',
    'usePolygonEditor({ polygon, onChange, resolution, coordinateBounds: canvasBounds })',
    'coordinateBounds en el hook');

  // --- grid cubre el área visible ---
  s = replaceOnce(s,
    `  const gridLines = [];
  for (let i = 0; i <= resolution; i++) {
    const pos = (i / resolution) * 100;
    gridLines.push(
      <line
        key={\`v\${i}\`}
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
        key={\`h\${i}\`}
        x1={0}
        y1={pos}
        x2={100}
        y2={pos}
        stroke="hsl(224 30% 26%)"
        strokeWidth={0.15}
        opacity={i % 4 === 0 ? 0.8 : 0.4}
      />
    );
  }`,
    `  const gridLines = [];
  const gxStart = Math.floor(canvasBounds.minX * resolution);
  const gxEnd = Math.ceil(canvasBounds.maxX * resolution);
  const gyStart = Math.floor(canvasBounds.minY * resolution);
  const gyEnd = Math.ceil(canvasBounds.maxY * resolution);
  for (let i = gxStart; i <= gxEnd; i++) {
    const pos = (i / resolution) * 100;
    const major = i % 4 === 0;
    gridLines.push(
      <line
        key={\`v\${i}\`}
        x1={pos}
        y1={canvasBounds.minY * 100}
        x2={pos}
        y2={canvasBounds.maxY * 100}
        stroke="hsl(224 30% 26%)"
        strokeWidth={major ? 1.2 : 1}
        vectorEffect="non-scaling-stroke"
        opacity={major ? 0.8 : 0.4}
      />
    );
  }
  for (let i = gyStart; i <= gyEnd; i++) {
    const pos = (i / resolution) * 100;
    const major = i % 4 === 0;
    gridLines.push(
      <line
        key={\`h\${i}\`}
        x1={canvasBounds.minX * 100}
        y1={pos}
        x2={canvasBounds.maxX * 100}
        y2={pos}
        stroke="hsl(224 30% 26%)"
        strokeWidth={major ? 1.2 : 1}
        vectorEffect="non-scaling-stroke"
        opacity={major ? 0.8 : 0.4}
      />
    );
  }`,
    'grid cubre área visible');

  // --- dash arrays ---
  s = replaceOnce(s, 'strokeDasharray={`${2 / zoom} ${2 / zoom}`}', 'strokeDasharray={`${2 / effZoom} ${2 / effZoom}`}', 'dash eje');
  s = replaceOnce(s, 'strokeDasharray={`${2 / zoom} ${1.5 / zoom}`}', 'strokeDasharray={`${2 / effZoom} ${1.5 / effZoom}`}', 'dash guías');

  // --- contenedor con ref + viewBox dinámico ---
  s = replaceOnce(s,
    `      <div
        className="relative flex-1 rounded-lg overflow-hidden border border-white/10"
        style={{
          background:
            'radial-gradient(ellipse at center, hsl(224 45% 14%) 0%, hsl(224 50% 9%) 100%)',
        }}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"`,
    `      <div
        ref={containerRef}
        className="relative flex-1 rounded-lg overflow-hidden border border-white/10"
        style={{
          background:
            'radial-gradient(ellipse at center, hsl(224 45% 14%) 0%, hsl(224 50% 9%) 100%)',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={\`\${viewMinX} \${viewMinY} \${viewSpan} \${viewSpan}\`}
          preserveAspectRatio="xMidYMid meet"`,
    'contenedor ref + viewBox');

  // --- quitar el transform del grupo ---
  s = replaceOnce(s,
    '          <g transform={`translate(${50 + offsetX} ${50 + offsetY}) scale(${zoom}) translate(-50 -50)`}>',
    '          <g>',
    'quitar transform del grupo');

  // --- overlays (mano + controles de zoom) ---
  s = replaceOnce(s,
    `        </svg>
      </div>`,
    `        </svg>
        {/* Capa de la mano: captura el arrastre para desplazar la vista */}
        {hand && zoom === undefined && (
          <div
            className="absolute inset-0 z-10 touch-none select-none"
            onPointerDown={onPanPointerDown}
            onPointerMove={onPanPointerMove}
            onPointerUp={onPanPointerEnd}
            onPointerCancel={onPanPointerEnd}
            onDoubleClick={() => resetView()}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: panDragging ? 'grabbing' : 'grab' }}
          />
        )}
        {/* Controles de zoom (esquina inferior derecha) */}
        {zoom === undefined && (
          <div className="absolute bottom-1.5 right-1.5 z-20 flex items-center gap-0.5 rounded-md border border-white/10 bg-black/40 backdrop-blur-sm px-0.5 py-0.5">
            <button
              onClick={() => setHand((h) => !h)}
              className={\`p-1 rounded transition-colors \${hand ? 'text-green-300 bg-green-500/20' : 'text-muted-foreground hover:text-green-300 hover:bg-green-500/10'}\`}
              title="Mano: arrastra para desplazar la vista (zoom con la rueda)"
            >
              <Hand className="w-3 h-3" />
            </button>
            <button
              onClick={() => zoomStep(1 / 1.25)}
              className="p-1 rounded text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Alejar (también con la rueda del ratón)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              onClick={() => resetView()}
              className="px-1 text-[9px] font-mono text-muted-foreground hover:text-green-300 transition-colors tabular-nums"
              title="Restablecer zoom"
            >
              {Math.round(effZoom * 100)}%
            </button>
            <button
              onClick={() => zoomStep(1.25)}
              className="p-1 rounded text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Acercar (también con la rueda del ratón)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>`,
    'overlays mano + zoom');

  write(drawPath, s);
}

console.log('\nListo.');
