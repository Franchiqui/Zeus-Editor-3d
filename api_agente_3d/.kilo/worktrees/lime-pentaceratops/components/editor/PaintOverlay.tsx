'use client';

// PaintOverlay: capa de pintura sobre el vídeo en la pestaña Efectos.
// - Muestra la pintura (paint.mask) compositeada con la opacidad. Si timeEnabled está
//   OFF se ve durante todo el vídeo; si ON, sólo en [timeStart, timeEnd] (igual que el
//   PaintNode del export → WYSIWYG).
// - Si al pintar había selección 'inside', paint.baseBox fija la caja de selección al
//   pintar; al compositear (preview y export) la máscara se transforma de baseBox→caja
//   actual de la selección (effectiveSelectionShape al currentTime, que interpola entre
//   los keyframes de selección). Así la pintura va "pegada" a la selección: se mueve/
//   escala con ella. Mientras se edita (tool activo) se dibuja full-frame (sin
//   transformar) para que el trazo se vea donde se pinta; al soltar y en reproducción
//   aplica el seguimiento.
// - Edición con brocha/bote/gotero/borrador. La fuente de verdad es un canvas offscreen
//   a resolución nativa (paintCanvasRef); el canvas visible (overlayRef) es su espejo.
//   Al soltar el trazo / rellenar, se committea paint.mask como dataURL y snapshot.
// Coord-mapping: contenedor inset-0 del div aspect-ratio → 0-100 % == área del vídeo.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VideoPaintState, VideoSelectionState } from '@/types';
import { isPaintTimeActive, paintTimeStrength } from '@/lib/video-render/nodes/paint-node';
import { buildSelectionPath, buildSelectionPaths, paintFollowRect } from '@/lib/video-render/composite/selection-path';
import { effectiveSelectionShapeForPaint, effectiveSelectionMotionPaths, pathsBBox } from '@/lib/selection-keyframes';

type Tool = 'brush' | 'bucket' | 'eyedropper' | 'eraser' | null;

interface PaintOverlayProps {
  paint: VideoPaintState;
  tool: Tool;
  videoNativeSize: { width: number; height: number };
  previewVideoSize: { width: number; height: number };
  previewCanvasRef: React.RefObject<HTMLCanvasElement>;
  currentTime: number;
  previewOriginal: boolean;
  /** Selección de efectos activa (rect/circle/lazo + scope + seguimiento). Si está
   *  activa, brocha y bote recortan la pintura a ella; y si scope 'inside', la pintura
   *  la sigue (baseBox). */
  selection?: VideoSelectionState | null;
  onChange: (next: VideoPaintState) => void;
  onCommit: () => void;
  onToast?: (msg: string) => void;
}

const TOLERANCE = 15; // ± por canal para el flood fill (bote)
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export default function PaintOverlay({
  paint,
  tool,
  videoNativeSize,
  previewVideoSize,
  previewCanvasRef,
  currentTime,
  previewOriginal,
  selection,
  onChange,
  onCommit,
  onToast,
}: PaintOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen, resolución nativa
  const overlayRef = useRef<HTMLCanvasElement | null>(null); // visible, resolución preview
  const lastCommittedMaskRef = useRef<string | undefined>(undefined);

  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null); // px nativos
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null); // %

  const interactive = !!tool;
  // Mientras se edita mostramos la capa siempre; en reproducción, sólo dentro del
  // intervalo (o siempre si timeEnabled OFF). "Ver original" la oculta siempre.
  const visible = !previewOriginal && (interactive || isPaintTimeActive(paint, currentTime));
  // Fuerza 0..1 por rango temporal + fades in/out (1 sin rango o sin fades): la
  // opacidad de la capa se multiplica por ella.
  const strength = paintTimeStrength(paint, currentTime);
  // ¿La pintura va pegada a la selección (la sigue)? Sólo en reproducción (no mientras
  // se edita, para que el trazo se vea donde se pinta), con baseBox y selección inside.
  const followActive =
    !interactive &&
    !!paint.baseBox &&
    !!selection?.enabled &&
    selection.scope === 'inside' &&
    !!selection.shape;

  // Caja de selección efectiva al tiempo actual (%, 0-100), incluyendo el borrador de
  // seguimiento (draftBox) si lo hay — la posición que el usuario VE ahora, no la del
  // keyframe anterior.
  const selectionBoxNow = useCallback((): { x: number; y: number; width: number; height: number } | null => {
    if (!selection?.enabled || !selection.shape) return null;
    // Silueta cambiante (lazo por puntos): bbox de los paths deformados al instante.
    const motionPaths = effectiveSelectionMotionPaths(selection, currentTime);
    if (motionPaths && motionPaths.length > 0) return pathsBBox(motionPaths);
    const s = effectiveSelectionShapeForPaint(selection, currentTime);
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }, [selection, currentTime]);

  // Asegura el canvas de pintura offscreen a resolución nativa.
  const ensurePaintCanvas = useCallback(() => {
    const w = videoNativeSize.width;
    const h = videoNativeSize.height;
    if (!w || !h) return null;
    let c = paintCanvasRef.current;
    if (!c || c.width !== w || c.height !== h) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      paintCanvasRef.current = c;
    }
    return c;
  }, [videoNativeSize]);

  // Redibuja el overlay visible desde el canvas de pintura (escalado + opacidad). Si
  // followActive, transforma la máscara de baseBox→caja actual (la pintura sigue a la
  // selección). El overlay == área de vídeo (0,0,ov.width,ov.height).
  const redrawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const ctx = ov.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!visible) return;

    // Modo "rellenar todo menos la selección": rellena el overlay con el color y vacía la
    // región de la selección (según scope). El agujero usa effectiveSelectionShapeForPaint
    // (incluye el borrador draftBox) → en el preview se ve donde está la selección ahora.
    if (paint.inverseFill) {
      const sel = selection ?? null;
      const motionPaths = sel && sel.enabled && sel.shape ? effectiveSelectionMotionPaths(sel, currentTime) : null;
      const shape = !motionPaths && sel && sel.enabled && sel.shape ? effectiveSelectionShapeForPaint(sel, currentTime) : null;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (paint.opacity / 100) * strength));
      ctx.fillStyle = paint.color;
      ctx.fillRect(0, 0, ov.width, ov.height);
      const selPath = motionPaths && motionPaths.length > 0
        ? buildSelectionPaths(motionPaths, 0, 0, ov.width, ov.height)
        : (shape ? buildSelectionPath(shape, 0, 0, ov.width, ov.height) : null);
      if (selPath) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        if (sel?.scope === 'inside') {
          // scope 'dentro': pintar DENTRO → vaciar fuera.
          const combined = new Path2D();
          combined.rect(0, 0, ov.width, ov.height);
          combined.addPath(selPath);
          ctx.fill(combined, 'evenodd');
        } else {
          // scope 'fuera': pintar FUERA (el fondo) → vaciar dentro.
          ctx.fill(selPath);
        }
      }
      ctx.restore();
      return;
    }

    const pc = paintCanvasRef.current;
    if (!pc) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (paint.opacity / 100) * strength));
    if (followActive && paint.baseBox) {
      const cur = selectionBoxNow();
      if (cur) {
        const r = paintFollowRect(paint.baseBox, cur, 0, 0, ov.width, ov.height);
        ctx.drawImage(pc, 0, 0, pc.width, pc.height, r.x, r.y, r.width, r.height);
      } else {
        ctx.drawImage(pc, 0, 0, ov.width, ov.height);
      }
    } else {
      ctx.drawImage(pc, 0, 0, ov.width, ov.height);
    }
    ctx.restore();
  }, [paint.opacity, paint.color, paint.inverseFill, visible, followActive, paint.baseBox, selectionBoxNow, selection, currentTime, strength]);

  // Carga la máscara desde paint.mask cuando cambia externamente (carga de .zeus,
  // undo/redo). Si somos nosotros quienes acabamos de commitear (lastCommittedMask),
  // no recargamos: el canvas ya está al día.
  useEffect(() => {
    const mask = paint.mask;
    if (mask === lastCommittedMaskRef.current) return;
    const pc = ensurePaintCanvas();
    if (!pc) return;
    const ctx = pc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pc.width, pc.height);
    if (mask) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = paintCanvasRef.current;
        if (!c) return;
        const cctx = c.getContext('2d');
        if (!cctx) return;
        cctx.clearRect(0, 0, c.width, c.height);
        cctx.drawImage(img, 0, 0, c.width, c.height);
        redrawOverlay();
      };
      img.src = mask;
    } else {
      redrawOverlay();
    }
  }, [paint.mask, ensurePaintCanvas, redrawOverlay]);

  // Recrea el overlay visible cuando cambia el tamaño de preview y redibuja.
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const w = previewVideoSize.width;
    const h = previewVideoSize.height;
    if (w && h && (ov.width !== w || ov.height !== h)) {
      ov.width = w;
      ov.height = h;
    }
    redrawOverlay();
  }, [previewVideoSize, redrawOverlay]);

  // Redibujar al cambiar opacidad / visibilidad (intervalo/Ver original) / caja de
  // seguimiento (al mover currentTime la selección interpola su caja).
  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  const commit = useCallback(() => {
    const pc = paintCanvasRef.current;
    if (!pc) return;
    // ¿Hay algo pintado? Si no, committea mask undefined.
    let mask: string | undefined;
    try {
      const ctx = pc.getContext('2d');
      if (ctx) {
        const data = ctx.getImageData(0, 0, pc.width, pc.height).data;
        let any = false;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) { any = true; break; }
        }
        if (any) mask = pc.toDataURL('image/png');
      }
    } catch {
      mask = pc.toDataURL('image/png');
    }
    // Anclar la pintura a la caja de selección actual si hay selección 'inside': la
    // pintura quedará "pegada" y seguirá a la selección donde vaya. Sin selección,
    // capa libre (baseBox null).
    let baseBox: VideoPaintState['baseBox'] = null;
    if (selection?.enabled && selection.scope === 'inside' && selection.shape) {
      const motionPaths = effectiveSelectionMotionPaths(selection, currentTime);
      if (motionPaths && motionPaths.length > 0) {
        baseBox = pathsBBox(motionPaths);
      } else {
        const s = effectiveSelectionShapeForPaint(selection, currentTime);
        baseBox = { x: s.x, y: s.y, width: s.width, height: s.height };
      }
    }
    lastCommittedMaskRef.current = mask;
    onChange({ ...paint, mask, baseBox });
    onCommit();
  }, [onChange, onCommit, paint, selection, currentTime]);

  // ---- Mapeo de coords ----
  const pointFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const cw = rect.width || 1;
    const ch = rect.height || 1;
    const px = clamp(((e.clientX - rect.left) / cw) * 100, 0, 100);
    const py = clamp(((e.clientY - rect.top) / ch) * 100, 0, 100);
    return { px, py };
  };

  const toNative = (px: number, py: number) => ({
    x: (px / 100) * videoNativeSize.width,
    y: (py / 100) * videoNativeSize.height,
  });
  const toPreview = (px: number, py: number) => ({
    x: Math.round((px / 100) * previewVideoSize.width),
    y: Math.round((py / 100) * previewVideoSize.height),
  });

  // ---- Brocha ----
  const brushDot = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, paint.brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = paint.color;
    ctx.fill();
  };
  const brushSegment = (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    ctx.strokeStyle = paint.color;
    ctx.lineWidth = paint.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  // Recorta al path de la selección (al tiempo actual, respeta seguimiento) en espacio
  // nativo del canvas de pintura. Llamar dentro de ctx.save()/restore(). Si no hay
  // selección activa, no hace nada (pintura libre).
  const applySelectionClip = (ctx: CanvasRenderingContext2D) => {
    if (!selection?.enabled || !selection.shape) return;
    const pc = paintCanvasRef.current;
    if (!pc) return;
    // Silueta cambiante (lazo por puntos): clip a los paths deformados al instante
    // actual. Tiene prioridad sobre la caja/path estáticos. (SAM2/motionMasks es
    // raster: no se puede clip sincrono aquí → cae al shape estático; la pintura
    // dentro de una selección SAM2 se confina al lazo base, no a la máscara por frame.)
    const motionPaths = effectiveSelectionMotionPaths(selection, currentTime);
    if (motionPaths && motionPaths.length > 0) {
      const selPath = buildSelectionPaths(motionPaths, 0, 0, pc.width, pc.height);
      if (selection.scope === 'outside') {
        const combined = new Path2D();
        combined.rect(0, 0, pc.width, pc.height);
        combined.addPath(selPath);
        ctx.clip(combined, 'evenodd');
      } else {
        ctx.clip(selPath);
      }
      return;
    }
    const shape = effectiveSelectionShapeForPaint(selection, currentTime);
    const selPath = buildSelectionPath(shape, 0, 0, pc.width, pc.height);
    if (selection.scope === 'outside') {
      const combined = new Path2D();
      combined.rect(0, 0, pc.width, pc.height);
      combined.addPath(selPath);
      ctx.clip(combined, 'evenodd');
    } else {
      ctx.clip(selPath);
    }
  };

  const startBrush = (pt: { x: number; y: number }) => {
    const pc = ensurePaintCanvas();
    if (!pc) return;
    const ctx = pc.getContext('2d');
    if (!ctx) return;
    drawingRef.current = true;
    lastPtRef.current = pt;
    const erasing = tool === 'eraser';
    ctx.save();
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    if (!erasing) applySelectionClip(ctx); // borrar es libre (no recorta a la selección)
    brushDot(ctx, pt.x, pt.y);
    ctx.restore();
    redrawOverlay();
  };

  const moveBrush = (pt: { x: number; y: number }) => {
    if (!drawingRef.current) return;
    const pc = paintCanvasRef.current;
    if (!pc) return;
    const ctx = pc.getContext('2d');
    if (!ctx) return;
    const from = lastPtRef.current;
    if (!from) { lastPtRef.current = pt; return; }
    const erasing = tool === 'eraser';
    ctx.save();
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    if (!erasing) applySelectionClip(ctx);
    brushSegment(ctx, from, pt);
    ctx.restore();
    lastPtRef.current = pt;
    redrawOverlay();
  };

  // ---- Bote (flood fill) ----
  const bucketFill = (previewPt: { x: number; y: number }) => {
    const src = previewCanvasRef.current;
    if (!src) return;
    const sw = src.width;
    const sh = src.height;
    if (!sw || !sh) return;
    let srcCtx: CanvasRenderingContext2D | null = null;
    let imageData: ImageData;
    try {
      srcCtx = src.getContext('2d');
      if (!srcCtx) return;
      imageData = srcCtx.getImageData(0, 0, sw, sh);
    } catch {
      onToast?.('No se pudo leer el frame para rellenar.');
      return;
    }
    const px = clamp(previewPt.x, 0, sw - 1);
    const py = clamp(previewPt.y, 0, sh - 1);
    const data = imageData.data;
    const startIdx = (py * sw + px) * 4;
    const tR = data[startIdx], tG = data[startIdx + 1], tB = data[startIdx + 2];

    const fillR = parseInt(paint.color.slice(1, 3), 16);
    const fillG = parseInt(paint.color.slice(3, 5), 16);
    const fillB = parseInt(paint.color.slice(5, 7), 16);

    // Resultado a resolución de preview: sólo la región rellenada, resto transparente.
    const out = new ImageData(sw, sh);
    const outData = out.data;
    const seen = new Uint8Array(sw * sh);
    const stack: number[] = [px, py];
    while (stack.length > 0) {
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      const si = cy * sw + cx;
      if (seen[si] || cx < 0 || cx >= sw || cy < 0 || cy >= sh) continue;
      seen[si] = 1;
      const idx = si * 4;
      if (
        Math.abs(data[idx] - tR) <= TOLERANCE &&
        Math.abs(data[idx + 1] - tG) <= TOLERANCE &&
        Math.abs(data[idx + 2] - tB) <= TOLERANCE
      ) {
        outData[idx] = fillR;
        outData[idx + 1] = fillG;
        outData[idx + 2] = fillB;
        outData[idx + 3] = 255;
        stack.push(cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1);
      }
    }

    // Volcar el resultado (preview res) escalado al canvas de pintura (res nativa).
    const pc = ensurePaintCanvas();
    if (!pc) return;
    const pcCtx = pc.getContext('2d');
    if (!pcCtx) return;
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext('2d')!.putImageData(out, 0, 0);
    pcCtx.save();
    pcCtx.globalCompositeOperation = 'source-over';
    // Recortar el relleno a la selección de efectos (si hay). La forma se evalúa al
    // tiempo actual (respeta el seguimiento por keyframes de selección).
    applySelectionClip(pcCtx);
    pcCtx.drawImage(tmp, 0, 0, pc.width, pc.height);
    pcCtx.restore();
    redrawOverlay();
    commit();
  };

  // ---- Gotero ----
  const eyedrop = (previewPt: { x: number; y: number }) => {
    const src = previewCanvasRef.current;
    if (!src) return;
    try {
      const ctx = src.getContext('2d');
      if (!ctx) return;
      const x = clamp(previewPt.x, 0, src.width - 1);
      const y = clamp(previewPt.y, 0, src.height - 1);
      const d = ctx.getImageData(x, y, 1, 1).data;
      const hex =
        '#' +
        ('000000' + ((d[0] << 16) | (d[1] << 8) | d[2]).toString(16)).slice(-6);
      onChange({ ...paint, color: hex });
    } catch {
      onToast?.('No se pudo leer el color del frame.');
    }
  };

  // ---- Eventos ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (!tool) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const { px, py } = pointFromEvent(e);
    if (tool === 'brush' || tool === 'eraser') {
      startBrush(toNative(px, py));
    } else if (tool === 'bucket') {
      bucketFill(toPreview(px, py));
    } else if (tool === 'eyedropper') {
      eyedrop(toPreview(px, py));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { px, py } = pointFromEvent(e);
    if (interactive) setCursor({ x: px, y: py });
    if ((tool === 'brush' || tool === 'eraser') && drawingRef.current) {
      moveBrush(toNative(px, py));
    }
  };

  const endBrush = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPtRef.current = null;
      commit();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!tool) return;
    e.stopPropagation();
    if (tool === 'brush' || tool === 'eraser') endBrush();
  };

  const onPointerLeave = () => {
    if (!drawingRef.current) setCursor(null);
  };

  // Cursor circular (brocha/bote/borrador): diámetro en % del ancho/alto nativo.
  const cursorDiameterWPct =
    videoNativeSize.width > 0 ? (paint.brushSize / videoNativeSize.width) * 100 : 0;
  const cursorDiameterHPct =
    videoNativeSize.height > 0 ? (paint.brushSize / videoNativeSize.height) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerLeave={interactive ? onPointerLeave : undefined}
      className={`absolute inset-0 z-[25] overflow-hidden ${
        interactive ? 'pointer-events-auto' : 'pointer-events-none'
      } scrollbar-thin-transparent`}
      style={{
        cursor: tool === 'eyedropper' ? 'crosshair' : interactive ? 'crosshair' : 'default',
      }}
    >
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      {interactive && (tool === 'brush' || tool === 'bucket' || tool === 'eraser') && cursor && (
        <div
          className={`absolute rounded-full pointer-events-none ${tool === 'eraser' ? 'border-2 border-red-400 border-dashed' : 'border border-white/80 mix-blend-difference'}`}
          style={{
            left: `${cursor.x}%`,
            top: `${cursor.y}%`,
            width: `${cursorDiameterWPct}%`,
            height: `${cursorDiameterHPct}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  );
}