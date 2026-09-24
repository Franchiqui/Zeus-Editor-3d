'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VideoSelectionState, SelectionPoint, BezierAnchor } from '@/types';
// Objetivo de edición de vértices: el lazo VIVO (paths) o, si no hay, el keyframe
// de silueta (motionPath frame) más cercano al playhead — así los vértices siguen
// visibles y editables tras fijar (se retoca la forma guardada de ese keyframe).
type VertexEditTarget =
  | { kind: 'live'; paths: BezierAnchor[][] }
  | { kind: 'frame'; time: number; paths: BezierAnchor[][] };
import {
  getSelectionBoxAtTime,
  pathsBBox,
  transformPaths,
  effectiveSelectionShape,
  effectiveSelectionMotionPaths,
  effectiveSelectionMaskUrl,
  SelectionBox,
} from '@/lib/selection-keyframes';
import { loadMaskImage } from '@/lib/video-render/selection-mask-cache';
import { useI18n } from '@/lib/i18n';

interface SelectionOverlayProps {
  selection: VideoSelectionState;
  videoAspectRatio: number | null; // w/h del vídeo (== aspect del cuadro del preview)
  currentTime: number; // segundos absolutos del timeline (para seguimiento por keyframes)
  onChange: (next: VideoSelectionState) => void;
  /** Modo de retoque de máscara SAM2 (motionMasks): 'erase' borra, 'add' pinta. null = inactivo. */
  maskEditMode?: 'erase' | 'add' | 'wand' | null;
  /** Tamaño del pincel en px del reproductor. */
  maskBrushSize?: number;
  /** Bump para forzar recarga tras un commit (se escribe el PNG y se evicta la caché). */
  maskEditVersion?: number;
  /** Commit por trazo: el overlay entrega el canvas editado (res nativa) y el editor
   *  lo guarda EN MEMORIA + override para el preview. No escribe a disco aquí. */
  onMaskEditCommit?: (url: string, canvas: HTMLCanvasElement) => void;
  /** Zoom del reproductor (100 = sin zoom). El anillo del pincel vive dentro de un
   *  contenedor con `transform: scale(zoom)`, así que hay que compensar para que el
   *  anillo en pantalla coincida con la pintura (que sí es correcta a cualquier zoom). */
  playerZoom?: number;
  /** Varita mágica (shape.type === 'wand'): clic sobre el reproductor → el editor
   *  hace flood fill por color y rellena la máscara raster. El overlay entrega el
   *  punto en % (0-100 del área de vídeo) y el modo según modificador: 'replace'
   *  (sin modificador), 'add' (Ctrl+clic), 'subtract' (Shift+clic). Sin esta prop,
   *  el modo varita está inactivo (la máscara ya generada se sigue mostrando). */
  onWandPick?: (xPct: number, yPct: number, mode: 'replace' | 'add' | 'subtract') => void;
  /** Varita en el retoque de máscara (maskEditMode === 'wand'): clic sobre el
   *  reproductor → el editor rellena por color y aplica la región sobre la máscara
   *  del fotograma actual. Mismo modo por modificador: 'add' (Ctrl), 'subtract'
   *  (Shift), 'replace' (sin modificador: añade o borra según el punto pulsado). */
  onMaskWandPick?: (xPct: number, yPct: number, mode: 'replace' | 'add' | 'subtract') => void;
  /** Trazo aditivo/sustractivo (como la varita mágica): al CERRAR un lazo con
   *  Ctrl (add) o Shift (subtract), el editor compone la región interior del lazo
   *  sobre la máscara del frame actual (unión / diferencia). Devuelve true si
   *  aplicó (entonces el lazo se descarta: la máscara compuesta es el resultado). */
  onLazoApply?: (paths: BezierAnchor[][], mode: 'add' | 'subtract') => Promise<boolean> | boolean;
  /** Modo "segunda pasada SAM2": permite redibujar el lazo (+ Figura / Redibujar)
   *  aunque haya motionMasks activas, para re-segmentar desde el frame actual y
   *  fusionar (añadir) lo capturado a las máscaras existentes. */
  maskMergeMode?: boolean;
}

type DragState = {
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startBox: SelectionBox; // caja mostrada al iniciar el arrastre (interpolada si tracking)
  startSelection: VideoSelectionState;
  track: boolean; // ¿upsertar keyframe en `time` en vez de mutar la caja estática?
  time: number;
  containerWidth: number;
  containerHeight: number;
} | null;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const MIN_SIZE = 5;

// Path SVG (en coords 0-100) para el contorno rect.
function rectOutlinePoints(b: SelectionBox): string {
  return `${b.x},${b.y} ${b.x + b.width},${b.y} ${b.x + b.width},${b.y + b.height} ${b.x},${b.y + b.height}`;
}

// Construye el `d` de un <path> SVG (coords 0-100) a partir de anclas Bézier. El
// segmento que va de la ancla A a la B usa el mango de salida de A (hOut) y el de
// entrada de B (hIn). Si `close`, une la última ancla con la primera (curvada por
// sus mangos) y cierra el subpath.
function bezierD(anchors: BezierAnchor[], close: boolean): string {
  if (anchors.length === 0) return '';
  const n = anchors.length;
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  const segCount = close ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    d += ` C ${a.hOutX} ${a.hOutY}, ${b.hInX} ${b.hInY}, ${b.x} ${b.y}`;
  }
  if (close) d += ' Z';
  return d;
}

export default function SelectionOverlay({ selection, videoAspectRatio, currentTime, onChange, maskEditMode, maskBrushSize, maskEditVersion, onMaskEditCommit, playerZoom, onWandPick, onMaskWandPick, onLazoApply, maskMergeMode }: SelectionOverlayProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  // Freehand (herramienta Pluma): un clic fija una ancla (vértice); si mantienes
  // pulsado y arrastras, tiras de un mango simétrico que CURVA el segmento que
  // entra a la ancla — cuanto más arrastres, más curvatura (grado). Un clic sin
  // arrastrar deja los mangos degenerados (= la ancla) → segmento recto. Se cierra
  // clicando cerca del 1.er vértice, con el botón "Cerrar figura" o pulsando Enter.
  const [drawingNew, setDrawingNew] = useState<boolean>(false); // modo dibujo activo
  const [pathOpen, setPathOpen] = useState<boolean>(false);     // ¿hay un trazado en curso?
  const [cursor, setCursor] = useState<SelectionPoint | null>(null); // ratón para la línea goma
  // Ancla en curso: la que se está fijando ahora (degenerada al clic, con mangos al arrastrar).
  const [dragging, setDragging] = useState<boolean>(false);
  const [dragAnchor, setDragAnchor] = useState<BezierAnchor | null>(null);
  // EDICIÓN DE VÉRTICES del lazo ya cerrado: arrastrar un puntito mueve ese vértice
  // (y sus mangos se desplazan con él) para retocar la forma antes de fijarla.
  const [vertexDrag, setVertexDrag] = useState<{ pi: number; ai: number } | null>(null);
  const vertexDragRef = useRef<{
    pi: number; ai: number;
    target: VertexEditTarget;
    startClientX: number; startClientY: number;
    startPaths: BezierAnchor[][];
  } | null>(null);
  // Vértice seleccionado (para borrarlo con Supr/Backspace o doble clic).
  const [selectedVertex, setSelectedVertex] = useState<{ pi: number; ai: number } | null>(null);

  const { shape, scope } = selection;
  const isFreehand = shape.type === 'freehand';
  // Varita mágica: activa cuando el editor ha conectado el handler de clic.
  const isWand = shape.type === 'wand';
  const wandActive = isWand && !!onWandPick;
  // `|| []` por si un .zeus antiguo trae `polygons`/`points` en vez de `paths`.
  const paths = shape.paths || [];
  // Con tracking activo y lazo ya dibujado, el dibujo sólo se reactiva con el
  // botón "+ Figura"/"Redibujar". Tras fijar un keyframe (paths vacíos + hay
  // keyframes/motionPaths) NO se autoactiva al pasar el ratón: el preview queda
  // limpio para dibujar el lazo nuevo del siguiente keyframe y el clic sobre el
  // reproductor sigue moviendo el cursor. El botón SÍ activa el dibujo
  // (drawingNew/pathOpen/dragging siempre habilitan). Con paths vacíos y SIN
  // historial (primer lazo) el dibujo arranca directo al hacer clic, como siempre.
  const drawingActive = isFreehand && (
    (paths.length === 0 && !(shape.keyframes?.length) && !(shape.motionPaths?.length))
    || drawingNew || pathOpen || dragging
  );
  // Seguimiento para rect/circle Y lazo (la caja del lazo se anima por keyframes).
  const tracking = selection.track;
  const hasKf = (shape.keyframes?.length ?? 0) > 0;
  // BORRADOR de seguimiento: caja arrastrada con seguimiento ON aún no fijada. Se muestra
  // en el tiempo actual mientras existía; el botón "{t('videoEditor.selection.fixKeyframe')}" la confirma.
  const draft = selection.draftBox ?? null;
  const draftActive = tracking && !!draft;
  // Caja base: bbox de los paths para freehand, caja estática para rect/circle.
  const baseBox: SelectionBox = isFreehand
    ? pathsBBox(paths)
    : { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  // Caja a mostrar en este instante: borrador > interpolada por keyframes > base.
  const displayBox: SelectionBox = draftActive && draft
    ? draft
    : (tracking && hasKf
      ? getSelectionBoxAtTime(shape, currentTime)
      : baseBox);
  // Paths efectivos a renderizar: borrador > interpolada por keyframes (lazo transformado)
  // > dibujados.
  const effectivePaths: BezierAnchor[][] = isFreehand && draftActive && draft
    ? transformPaths(paths, pathsBBox(paths), draft)
    : (isFreehand && tracking && hasKf
      ? (effectiveSelectionShape(selection, currentTime).paths ?? paths)
      : paths);

  // Silueta cambiante por frame (lazo por puntos / SAM2). Tiene PRIORIDAD sobre la
  // caja+path estáticos: cuando existe, el overlay ignora el bbox/edición y pinta el
  // contorno deformado (motionPaths, SVG) o la máscara raster (motionMasks, canvas).
  // motionMaskUrl (SAM2) tiene prioridad sobre motionPaths (lazo por puntos).
  const motionMaskUrl = effectiveSelectionMaskUrl(selection, currentTime);
  const motionPaths = motionMaskUrl ? null : effectiveSelectionMotionPaths(selection, currentTime);
  const hasMotion = !!(motionMaskUrl || motionPaths);

  // ---- Retoque de máscara SAM2 (motionMasks): borrar/añadir/varita al frame actual ----
  const maskEditModeOn = maskEditMode ?? null;
  const isEditingMask = !!maskEditModeOn && !!motionMaskUrl;
  // Varita dentro del retoque: el clic no pinta con pincel, entrega el punto al
  // editor (flood fill por color sobre la máscara del frame).
  const isMaskWand = maskEditModeOn === 'wand' && !!motionMaskUrl && !!onMaskWandPick;
  const onMaskEditCommitRef = useRef(onMaskEditCommit);
  onMaskEditCommitRef.current = onMaskEditCommit;
  // Trazo aditivo/sustractivo (Ctrl/Shift al cerrar el lazo): ref para leer la
  // prop más reciente desde los listeners (que se re-suscriben por deps).
  const onLazoApplyRef = useRef(onLazoApply);
  onLazoApplyRef.current = onLazoApply;
  // Modificadores al CERRAR el lazo: se capturan en el clic del 1.er vértice, en
  // Enter (keydown) y en el botón "Cerrar figura" (el evento de cierre es el que
  // decide el modo: Ctrl añade a la máscara, Shift extrae).
  const lazoModsRef = useRef<{ ctrl: boolean; shift: boolean }>({ ctrl: false, shift: false });
  const maskBrushSizeNum = maskBrushSize ?? 24;
  // El reproductor escala el contenedor padre con `transform: scale(zoom)`. El
  // anillo del pincel es hijo de ese contenedor, así que sus px CSS se multiplican
  // por `zoom` en pantalla. La pintura (pointerToNative) ya es correcta a cualquier
  // zoom (usa el rect escalado). Para que el anillo coincida con la pintura hay que
  // dividir su posición y tamaño por el zoom: en pantalla volverá a medir
  // `maskBrushSizeNum` y a centrarse bajo el ratón.
  const playerZoomFactor = (playerZoom ?? 100) / 100;
  // Canvas de edición a resolución NATIVA de la máscara (se modifica con el pincel
  // y se vuelca al disco al soltar). Se recarga al cambiar de frame o de versión.
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const editCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const editLoadedUrlRef = useRef<string | null>(null);
  const editingStrokeRef = useRef(false);
  const lastNativeRef = useRef<{ nx: number; ny: number } | null>(null);
  const [brushPos, setBrushPos] = useState<{ x: number; y: number } | null>(null);

  // Contain-fit del vídeo dentro del contenedor (display px). Igual que el renderer.
  const videoFit = useCallback((cw: number, ch: number) => {
    const ar = videoAspectRatio;
    let dw = cw, dh = ch, dx = 0, dy = 0;
    if (ar && ar > 0) {
      if (cw / ch > ar) { dw = ch * ar; dh = ch; } else { dw = cw; dh = cw / ar; }
      dx = (cw - dw) / 2; dy = (ch - dh) / 2;
    }
    return { dx, dy, dw, dh };
  }, [videoAspectRatio]);

  // Vuelca el canvas de edición al canvas de visualización (tintado por scope).
  const drawEditDisplay = useCallback(() => {
    const canvas = maskCanvasRef.current;
    const ec = editCanvasRef.current;
    if (!canvas || !ec) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    const { dx, dy, dw, dh } = videoFit(cw, ch);
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.drawImage(ec, dx, dy, dw, dh);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = scope === 'inside' ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }, [videoFit, scope]);

  // (Re)carga la máscara del frame actual en el canvas de edición a resolución nativa.
  useEffect(() => {
    if (!isEditingMask || !motionMaskUrl) return;
    let cancelled = false;
    loadMaskImage(motionMaskUrl).then((img) => {
      if (cancelled || !img.naturalWidth) return;
      if (!editCanvasRef.current) editCanvasRef.current = document.createElement('canvas');
      const c = editCanvasRef.current;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      editCtxRef.current = ctx;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, 0, 0);
      editLoadedUrlRef.current = motionMaskUrl;
      drawEditDisplay();
    }).catch(() => { /* máscara no cargada */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingMask, motionMaskUrl, maskEditVersion]);

  // Refs con los datos más recientes (para que el dibujo freehand no se re-suscriba por punto)
  const selRef = useRef(selection);
  selRef.current = selection;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Descarta el borrador de seguimiento al cambiar de tiempo: si el usuario se mueve a
  // otro fotograma sin haber pulsado "{t('videoEditor.selection.fixKeyframe')}", el borrador ya no aplica.
  useEffect(() => {
    if (selRef.current.draftBox) {
      onChangeRef.current({ ...selRef.current, draftBox: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime]);
  // Refs espejo para leer estado fresco en los listeners de window (drag).
  const dragAnchorRef = useRef<BezierAnchor | null>(null);
  dragAnchorRef.current = dragAnchor;
  const draggingRef = useRef(false);
  draggingRef.current = dragging;
  const pathOpenRef = useRef(false);
  pathOpenRef.current = pathOpen;

  // ---- Máscara raster por frame (SAM2): canvas absoluto sobre el vídeo ----
  // Dibuja el PNG de la máscara alineado al área de vídeo (contain-fit, igual que
  // el nodo de export) con un tinte del color de scope para que se vea como selección.
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setContainerSize({ w: cr.width || 1, h: cr.height || 1 });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!motionMaskUrl) return;
    // Mientras se edita la máscara, la visualización la pinta drawEditDisplay desde
    // el canvas de edición (live). Este effect sólo pinta la máscara de disco cuando
    // NO se edita.
    if (isEditingMask) {
      // Asegura el tamaño del canvas de visualización y vuelca la edición.
      const canvas = maskCanvasRef.current;
      if (canvas) {
        const cw = containerSize?.w ?? canvas.clientWidth;
        const ch = containerSize?.h ?? canvas.clientHeight;
        if (cw && ch) { canvas.width = Math.round(cw); canvas.height = Math.round(ch); }
      }
      drawEditDisplay();
      return;
    }
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const cw = containerSize?.w ?? canvas.clientWidth;
    const ch = containerSize?.h ?? canvas.clientHeight;
    if (!cw || !ch) return;
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Contain-fit del vídeo dentro del contenedor (== videoArea del renderer).
    const { dx, dy, dw, dh } = videoFit(canvas.width, canvas.height);
    const tint = scope === 'inside' ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)';
    loadMaskImage(motionMaskUrl).then((img) => {
      ctx.save();
      ctx.drawImage(img, dx, dy, dw, dh);
      // Tinte: pinta el color del scope con la máscara como canal alfa (source-in
      // respeta el alpha del PNG) → sólo se ve donde la máscara es opaca.
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }).catch(() => { /* máscara no cargada: no rompas el preview */ });
  }, [motionMaskUrl, currentTime, containerSize, videoAspectRatio, scope, isEditingMask, maskEditVersion, drawEditDisplay, videoFit]);

  // ---- Edición rect/circle: move + resize (proporción libre) ----
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cw = rect.width || dragState.containerWidth;
      const ch = rect.height || dragState.containerHeight;
      const sb = dragState.startBox;
      const startSel = dragState.startSelection;
      const startShape = startSel.shape;

      let newBox: SelectionBox;
      if (dragState.mode === 'move') {
        const dx = ((event.clientX - dragState.startX) / cw) * 100;
        const dy = ((event.clientY - dragState.startY) / ch) * 100;
        newBox = {
          x: clamp(sb.x + dx, 0, 100 - sb.width),
          y: clamp(sb.y + dy, 0, 100 - sb.height),
          width: sb.width,
          height: sb.height,
        };
      } else {
        // resize (handle inferior-derecha): ancho y alto libres
        const deltaW = ((event.clientX - dragState.startX) / cw) * 100;
        const deltaH = ((event.clientY - dragState.startY) / ch) * 100;
        newBox = {
          x: sb.x,
          y: sb.y,
          width: clamp(sb.width + deltaW, MIN_SIZE, 100 - sb.x),
          height: clamp(sb.height + deltaH, MIN_SIZE, 100 - sb.y),
        };
      }

      if (dragState.track) {
        // Seguimiento: NO se fija keyframe al arrastrar. Se guarda como BORRADOR (caja en
        // el tiempo actual) y se muestra encima. El keyframe lo fija el botón "Fijar
        // keyframe aquí" (addSelectionKeyframeHere), que lee este borrador. El lazo NO
        // muta sus paths: la base queda fija y el borrador la transforma (effectivePaths).
        onChange({ ...startSel, draftBox: newBox });
      } else if (startShape.type === 'freehand') {
        // Edición estática del lazo: traslada/escala los paths de su bbox base al nuevo.
        const base = pathsBBox(startShape.paths);
        const newPaths = transformPaths(startShape.paths, base, newBox);
        onChange({ ...startSel, shape: { ...startShape, paths: newPaths, ...newBox } });
      } else {
        // Edición estática: muta la caja de la shape.
        onChange({ ...startSel, shape: { ...startShape, ...newBox } });
      }
    };

    const handleMouseUp = () => setDragState(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onChange]);

  const startDrag = (event: React.MouseEvent, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDragState({
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: { ...displayBox },
      startSelection: { ...selection, shape: { ...shape } },
      track: tracking,
      time: currentTime,
      containerWidth: rect.width,
      containerHeight: rect.height,
    });
  };

  // ---- Freehand: herramienta Pluma (anclas Bézier) ----
  const pointFromEvent = (event: MouseEvent | React.MouseEvent): SelectionPoint => {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const cw = rect.width || 1;
    const ch = rect.height || 1;
    return {
      x: clamp(((event.clientX - rect.left) / cw) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / ch) * 100, 0, 100),
    };
  };

  const CLOSE_THRESHOLD = 2.5; // % de cercanía al 1.er vértice para cerrar la figura

  // Inicia el arrastre de un vértice (del lazo vivo o del keyframe más cercano).
  const startVertexDrag = (event: React.MouseEvent, pi: number, ai: number, target: VertexEditTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = target.paths[pi]?.[ai];
    if (!anchor) return;
    vertexDragRef.current = {
      pi, ai, target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPaths: target.paths.map((p) => p.map((a) => ({ ...a }))),
    };
    setVertexDrag({ pi, ai });
  };

  // Guarda los paths editados en el destino correcto (lazo vivo o keyframe).
  const commitTargetPaths = (target: VertexEditTarget, nextPaths: BezierAnchor[][]) => {
    const sel = selRef.current;
    if (target.kind === 'live') {
      onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: nextPaths } });
    } else {
      const t = target.time;
      const motionPaths = (sel.shape.motionPaths ?? []).map((f) =>
        Math.abs(f.time - t) < 0.001 ? { ...f, paths: nextPaths } : f
      );
      onChangeRef.current({ ...sel, shape: { ...sel.shape, motionPaths } });
    }
  };

  // Bucle de arrastre del vértice en window: el vértice (y sus mangos, que se
  // desplazan con él) sigue al ratón en % del contenedor. Se parte SIEMPRE de la
  // copia inicial (startPaths) para no acumular errores de redondeo.
  useEffect(() => {
    if (!vertexDragRef.current) return;
    const onMove = (event: MouseEvent) => {
      const drag = vertexDragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      const dx = ((event.clientX - drag.startClientX) / (rect.width || 1)) * 100;
      const dy = ((event.clientY - drag.startClientY) / (rect.height || 1)) * 100;
      const a = drag.startPaths[drag.pi]?.[drag.ai];
      if (!a) return;
      const moved: BezierAnchor = {
        x: clamp(a.x + dx, -10, 110),
        y: clamp(a.y + dy, -10, 110),
        hInX: a.hInX + dx, hInY: a.hInY + dy,
        hOutX: a.hOutX + dx, hOutY: a.hOutY + dy,
      };
      const nextPaths = drag.startPaths.map((p, pIdx) =>
        pIdx === drag.pi ? p.map((an, aIdx) => (aIdx === drag.ai ? moved : an)) : p
      );
      commitTargetPaths(drag.target, nextPaths);
    };
    const onUp = () => {
      vertexDragRef.current = null;
      setVertexDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [vertexDrag]);

  // AÑADIR vértice: clic sobre el borde de la malla inserta un vértice nuevo en el
  // tramo más cercano (entre las dos anclas adyacentes), con mangos rectos.
  const addVertexAt = (event: React.MouseEvent, pi: number, target: VertexEditTarget) => {
    if (drawingActive) return;
    event.preventDefault();
    event.stopPropagation();
    const p = pointFromEvent(event);
    const anchors = target.paths[pi];
    if (!anchors || anchors.length < 3) return;
    let bestAi = 0;
    let bestDist = Infinity;
    const n = anchors.length;
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % n];
      const c1x = a.hOutX ?? a.x; const c1y = a.hOutY ?? a.y;
      const c2x = b.hInX ?? b.x; const c2y = b.hInY ?? b.y;
      for (let s = 0; s <= 8; s++) {
        const u = s / 8; const v = 1 - u;
        const qx = v * v * v * a.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * b.x;
        const qy = v * v * v * a.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * b.y;
        const d = Math.hypot(qx - p.x, qy - p.y);
        if (d < bestDist) { bestDist = d; bestAi = i; }
      }
    }
    if (bestDist > 8) return; // el clic quedó lejos de la malla
    const newAnchor: BezierAnchor = { x: p.x, y: p.y, hInX: p.x, hInY: p.y, hOutX: p.x, hOutY: p.y };
    const next = anchors.slice(0, bestAi + 1).concat([newAnchor], anchors.slice(bestAi + 1));
    const nextPaths = target.paths.map((p2, pIdx) => (pIdx === pi ? next : p2));
    commitTargetPaths(target, nextPaths);
  };

  // QUITAR vértice: borra la ancla seleccionada (mínimo 3 anclas por trazado).
  const removeVertex = (pi: number, ai: number, target: VertexEditTarget) => {
    const anchors = target.paths[pi];
    if (!anchors || anchors.length <= 3) return;
    const next = anchors.filter((_, i) => i !== ai);
    const nextPaths = target.paths.map((p2, pIdx) => (pIdx === pi ? next : p2));
    commitTargetPaths(target, nextPaths);
  };

  // Ancla degenerada (mangos = la propia ancla) → segmento recto.
  const degenerateAnchor = (p: SelectionPoint): BezierAnchor => ({
    x: p.x, y: p.y, hInX: p.x, hInY: p.y, hOutX: p.x, hOutY: p.y,
  });

  // Entra en modo dibujo (botón "+ Figura" o "Redibujar").
  const startDrawing = () => {
    setDrawingNew(true);
    setPathOpen(false);
    setCursor(null);
    setDragAnchor(null);
    setDragging(false);
  };

  // Descarta el ancla en curso (sin fijarla).
  const cancelDrag = () => {
    setDragging(false);
    setDragAnchor(null);
  };

  // Cierra el trazado en curso (lo descarta si quedó con <3 anclas, sin área).
  // Si se cierra con Ctrl/Shift y hay onLazoApply, la región del lazo se compone
  // sobre la máscara del frame actual (Ctrl añade / Shift extrae, como la varita)
  // y, si aplicó, el lazo se descarta: la máscara compuesta es el resultado.
  const finishPath = () => {
    cancelDrag();
    const sel = selRef.current;
    const curPaths = sel.shape.paths || [];
    const validPaths = [...curPaths];
    if (curPaths.length > 0) {
      const last = curPaths[curPaths.length - 1];
      if (last.length < 3) {
        validPaths.pop();
        onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: validPaths } });
      }
    }
    const mods = lazoModsRef.current;
    const closed = validPaths.filter((p) => p.length >= 3);
    if ((mods.ctrl || mods.shift) && closed.length > 0 && onLazoApplyRef.current) {
      const mode = mods.ctrl ? 'add' : 'subtract';
      void Promise.resolve(onLazoApplyRef.current(closed, mode)).then((ok) => {
        if (ok) {
          const latest = selRef.current;
          onChangeRef.current({ ...latest, shape: { ...latest.shape, paths: [] } });
        }
      });
    }
    lazoModsRef.current = { ctrl: false, shift: false };
    setPathOpen(false);
    setDrawingNew(false);
    setCursor(null);
  };

  // Deshace la última ancla fijada (o cancela el ancla en curso si se está arrastrando).
  const undoVertex = () => {
    if (draggingRef.current) { cancelDrag(); return; }
    const sel = selRef.current;
    const curPaths = sel.shape.paths || [];
    if (curPaths.length === 0) return;
    const last = curPaths[curPaths.length - 1];
    if (last.length <= 1) {
      onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: curPaths.slice(0, -1) } });
      setPathOpen(false);
    } else {
      const newLast = last.slice(0, -1);
      const newPaths = curPaths.slice(0, -1);
      newPaths.push(newLast);
      onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: newPaths } });
    }
  };

  // Fija el ancla en curso en el trazado (al soltar el botón). Un clic (sin
  // arrastre) fija un ancla degenerada (segmento recto); un arrastre fija el
  // ancla con sus mangos (segmento curvado).
  const commitAnchor = () => {
    const a = dragAnchorRef.current;
    if (!a) { setDragging(false); return; }
    // Al soltar, sólo el mango de ENTRADA (hIn) conserva la curvatura arrastrada
    // (curvea el segmento que LLEGA a este vértice). El mango de SALIDA (hOut)
    // se degenera para que el siguiente segmento nazca recto salvo que se vuelva
    // a arrastrar al fijar el próximo vértice.
    const committed = { ...a, hOutX: a.x, hOutY: a.y };
    const sel = selRef.current;
    // Defensa: si la herramienta cambió durante el arrastre (p. ej. a varita
    // mágica), no fijar un ancla en una forma que no usa paths.
    if (sel.shape.type !== 'freehand') {
      setDragging(false);
      setDragAnchor(null);
      setCursor({ x: a.x, y: a.y });
      return;
    }
    const curPaths = sel.shape.paths || [];
    if (!pathOpenRef.current) {
      onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: [...curPaths, [committed]] } });
      setPathOpen(true);
    } else {
      const last = curPaths[curPaths.length - 1];
      // Defensa extra: paths vacíos con pathOpen en true (estado stale tras un
      // cambio de herramienta). Arranca un trazado nuevo en vez de propagar
      // undefined a `[...last]`.
      const newLast = last ? [...last, committed] : [committed];
      const newPaths = curPaths.slice(0, -1);
      newPaths.push(newLast);
      onChangeRef.current({ ...sel, shape: { ...sel.shape, paths: newPaths } });
    }
    setDragging(false);
    setDragAnchor(null);
    setCursor({ x: a.x, y: a.y });
  };

  // Pulsa en el contenedor: fija una ancla (clic) o inicia el arrastre del mango (mantener).
  const onContainerMouseDown = (event: React.MouseEvent) => {
    if (!drawingActive) return;
    // Ignora pulsaciones sobre los botones del overlay (los gestionan sus onClick).
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const p = pointFromEvent(event);
    const sel = selRef.current;
    const curPaths = sel.shape.paths || [];
    // Cerrar si se pulsa cerca del 1.er vértice con >=3 anclas.
    if (pathOpenRef.current && curPaths.length > 0) {
      const last = curPaths[curPaths.length - 1];
      if (last.length >= 3 && Math.hypot(p.x - last[0].x, p.y - last[0].y) < CLOSE_THRESHOLD) {
        // Modificadores del clic de cierre: Ctrl añade a la máscara, Shift extrae.
        lazoModsRef.current = { ctrl: event.ctrlKey, shift: event.shiftKey };
        finishPath();
        return;
      }
    }
    setDragAnchor(degenerateAnchor(p));
    setDragging(true);
    setCursor(p);
  };

  // Varita mágica: un clic sobre el vídeo entrega el punto (%) al editor, que hace
  // el flood fill por color y rellena la máscara (motionMasks). Ctrl+clic añade la
  // zona a la selección existente; Shift+clic la resta.
  const onWandMouseDown = (event: React.MouseEvent) => {
    if (!wandActive) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const p = pointFromEvent(event);
    const mode = event.ctrlKey ? 'add' : event.shiftKey ? 'subtract' : 'replace';
    onWandPick?.(p.x, p.y, mode);
  };

  // Varita en el retoque de máscara: un clic entrega el punto (%) al editor, que
  // rellena por color y aplica la región sobre la máscara del frame actual.
  const onMaskWandMouseDown = (event: React.MouseEvent) => {
    if (!isMaskWand) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const p = pointFromEvent(event);
    const mode = event.ctrlKey ? 'add' : event.shiftKey ? 'subtract' : 'replace';
    onMaskWandPick?.(p.x, p.y, mode);
  };

  // Bucle de arrastre del mango en window: mueve los mangos simétricos del ancla
  // en curso según la posición del ratón D. hOut = D, hIn = 2·ancla − D (espejo).
  // La longitud del mango = |D − ancla| = grado de la curva.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const d = pointFromEvent(event);
      setDragAnchor(prev => prev ? {
        ...prev,
        hOutX: d.x, hOutY: d.y,
        hInX: 2 * prev.x - d.x, hInY: 2 * prev.y - d.y,
      } : prev);
      setCursor(d);
    };
    const onUp = () => commitAnchor();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // Cambio de herramienta: descarta cualquier estado de dibujo pendiente. Un
  // arrastre freehand cuyo mouseup se pierde (soltar fuera de la ventana, sobre
  // un iframe, menú contextual…) deja `dragging` en true y los listeners de
  // window montados; al cambiar a varita (paths vacíos) el siguiente clic
  // dispararía commitAnchor contra undefined. Al poner dragging a false, el
  // efecto anterior desmonta sus listeners.
  useEffect(() => {
    setDrawingNew(false);
    setPathOpen(false);
    setDragging(false);
    setDragAnchor(null);
    setCursor(null);
  }, [shape.type]);

  const onContainerMouseMove = (event: React.MouseEvent) => {
    if (!drawingActive || draggingRef.current) return;
    setCursor(pointFromEvent(event));
  };

  const onContainerMouseLeave = () => {
    if (drawingActive && !draggingRef.current) setCursor(null);
  };

  // Atajos de teclado mientras se dibuja: Enter/Esc cierra, Z/Backspace deshace/cancela.
  useEffect(() => {
    if (!isFreehand || !drawingActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Enter') {
          // Modificadores del cierre por teclado: Ctrl añade, Shift extrae (varita).
          lazoModsRef.current = { ctrl: e.ctrlKey, shift: e.shiftKey };
        } else {
          // Escape sólo cierra/cancela el trazado: nunca compone sobre la máscara.
          lazoModsRef.current = { ctrl: false, shift: false };
        }
        finishPath();
      }
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') { e.preventDefault(); undoVertex(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFreehand, drawingActive]);

  const redraw = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onChange({ ...selection, shape: { ...shape, paths: [] } });
    startDrawing();
  };

  const addPolygon = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startDrawing();
  };

  const stopAnd = (fn: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    fn();
  };

  // ---- Pincel de retoque de máscara: mapea pointer → coords nativas de la máscara ----
  const pointerToNative = (clientX: number, clientY: number) => {
    const canvas = maskCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width || 1, ch = rect.height || 1;
    const { dx, dy, dw, dh } = videoFit(cw, ch);
    const ec = editCanvasRef.current!;
    const nx = ((clientX - rect.left) - dx) / dw * ec.width;
    const ny = ((clientY - rect.top) - dy) / dh * ec.height;
    // maskBrushSizeNum es el DIÁMETRO en px display → radio nativo = (diámetro/2) escalado.
    // Así el trazo (lineWidth = rNative*2) proyectado a display mide exactamente maskBrushSizeNum,
    // igual que el anillo del cursor.
    const rNative = (maskBrushSizeNum / 2 / dw) * ec.width;
    return { nx, ny, rNative };
  };

  const applyBrushAt = (clientX: number, clientY: number) => {
    const ectx = editCtxRef.current;
    const ec = editCanvasRef.current;
    if (!ectx || !ec) return;
    const cur = pointerToNative(clientX, clientY);
    const erase = maskEditModeOn === 'erase';
    ectx.save();
    ectx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ectx.strokeStyle = erase ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)';
    ectx.fillStyle = erase ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)';
    ectx.lineWidth = cur.rNative * 2;
    ectx.lineCap = 'round';
    ectx.lineJoin = 'round';
    const last = lastNativeRef.current;
    ectx.beginPath();
    if (last) ectx.moveTo(last.nx, last.ny);
    else ectx.moveTo(cur.nx, cur.ny);
    ectx.lineTo(cur.nx, cur.ny);
    ectx.stroke();
    // Punto inicial redondo (si no hay último, asegura un círculo).
    if (!last) { ectx.beginPath(); ectx.arc(cur.nx, cur.ny, cur.rNative, 0, Math.PI * 2); ectx.fill(); }
    ectx.restore();
    lastNativeRef.current = { nx: cur.nx, ny: cur.ny };
    drawEditDisplay();
  };

  const onBrushDown = (event: React.MouseEvent) => {
    if (!isEditingMask) return;
    event.preventDefault();
    event.stopPropagation();
    editingStrokeRef.current = true;
    lastNativeRef.current = null;
    applyBrushAt(event.clientX, event.clientY);
  };

  const onBrushMove = (event: React.MouseEvent) => {
    if (!isEditingMask) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setBrushPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (!editingStrokeRef.current) return;
    applyBrushAt(event.clientX, event.clientY);
  };

  const onBrushLeave = () => {
    setBrushPos(null);
  };

  // Al soltar el trazo: entrega el canvas editado al padre (EN MEMORIA, no disco).
  // El padre lo acumula + activa un override para que el preview lo muestre en vivo.
  const commitBrush = () => {
    if (!editingStrokeRef.current) return;
    editingStrokeRef.current = false;
    lastNativeRef.current = null;
    const ec = editCanvasRef.current;
    const url = editLoadedUrlRef.current;
    if (!ec || !url) return;
    onMaskEditCommitRef.current?.(url, ec);
  };

  const { x, y, width, height } = displayBox;
  const accent = scope === 'inside' ? '#10b981' : '#f59e0b'; // emerald dentro, amber fuera

  // Trazado en curso (el último) cuando se está dibujando: sus anclas ya fijadas.
  const inProgress = isFreehand && drawingActive && (pathOpen || dragging) && paths.length > 0;
  // Si hay un lazo nuevo dibujado (paths, sin fijar), se muestra TAL CUAL — donde
  // se dibujó — NO transformado a la caja interpolada del keyframe anterior
  // (eso hacía que la malla "desapareciera" o apareciera en la posición vieja).
  // La transformación por caja (effectivePaths) solo aplica sin dibujo nuevo
  // (morph de silueta / lazo fijo que sigue al objeto).
  const committedPaths = inProgress ? paths.slice(0, -1) : (paths.length > 0 ? paths : effectivePaths);
  // Objetivo de edición de vértices: el lazo VIVO si lo hay; si no (tras fijar el
  // keyframe), el motionPath frame MÁS CERCANO al playhead — así los vértices
  // siguen visibles y editables en cualquier frame (se retoca la forma guardada).
  const editTarget: VertexEditTarget | null = !drawingActive
    ? paths.length > 0
      ? { kind: 'live', paths }
      : (() => {
          const frames = selection.shape.motionPaths ?? [];
          if (frames.length === 0) return null;
          const nearest = frames.reduce((best, f) =>
            Math.abs(f.time - currentTime) < Math.abs(best.time - currentTime) ? f : best, frames[0]);
          return { kind: 'frame', time: nearest.time, paths: nearest.paths };
        })()
    : null;
  // Atajo: con un vértice seleccionado y sin dibujar, Supr/Backspace lo elimina.
  useEffect(() => {
    if (drawingActive || !selectedVertex || !editTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeVertex(selectedVertex.pi, selectedVertex.ai, editTarget);
        setSelectedVertex(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingActive, selectedVertex, editTarget]);
  const livePath = inProgress ? paths[paths.length - 1] : null;
  const liveAnchors: BezierAnchor[] = livePath ? livePath : [];
  // Anclas a renderizar como curva abierta: las fijadas + la que se está arrastrando.
  const renderAnchors = dragging && dragAnchor ? [...liveAnchors, dragAnchor] : liveAnchors;
  // Extremo de la línea goma: el ancla en curso (si se arrastra) o el cursor.
  const rubberEnd: SelectionPoint | null = dragging && dragAnchor ? { x: dragAnchor.x, y: dragAnchor.y } : cursor;
  const rubberStart: BezierAnchor | null = dragging && dragAnchor
    ? dragAnchor
    : (liveAnchors.length > 0 ? liveAnchors[liveAnchors.length - 1] : null);

  return (
    <div
      ref={containerRef}
      onMouseDown={isMaskWand ? onMaskWandMouseDown : isEditingMask ? onBrushDown : wandActive ? onWandMouseDown : drawingActive ? onContainerMouseDown : undefined}
      onMouseMove={isEditingMask && !isMaskWand ? onBrushMove : drawingActive ? onContainerMouseMove : undefined}
      onMouseUp={isEditingMask && !isMaskWand ? commitBrush : undefined}
      onMouseLeave={isEditingMask && !isMaskWand ? () => { onBrushLeave(); commitBrush(); } : drawingActive ? onContainerMouseLeave : undefined}
      className={`absolute inset-0 z-[20] overflow-hidden ${(isEditingMask || drawingActive || wandActive) ? 'pointer-events-auto' : 'pointer-events-none'} ${isEditingMask && !isMaskWand ? 'cursor-none' : (isMaskWand || drawingActive || wandActive) ? 'cursor-crosshair' : ''}`}
    >
      {/* Cursor del pincel de retoque (anillo del tamaño del pincel) */}
      {isEditingMask && !isMaskWand && brushPos && (
        <div
          className="absolute pointer-events-none rounded-full border-2"
          style={{
            left: `${(brushPos.x - maskBrushSizeNum / 2) / playerZoomFactor}px`,
            top: `${(brushPos.y - maskBrushSizeNum / 2) / playerZoomFactor}px`,
            width: `${maskBrushSizeNum / playerZoomFactor}px`,
            height: `${maskBrushSizeNum / playerZoomFactor}px`,
            borderColor: maskEditModeOn === 'erase' ? '#ef4444' : '#10b981',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          }}
        />
      )}
      {/* SVG con el contorno de la forma (rect / circle-elipse / trazados freehand Bézier) */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {hasMotion && motionPaths && !(isFreehand && (paths.length > 0 || drawingActive || (maskMergeMode && paths.some((p) => p.length >= 3)))) ? (
          // Silueta deformada por frame (lazo por puntos / morph de keyframes).
          // Se muestra SIEMPRE que no haya un lazo nuevo en curso: al mover el
          // playhead por el timeline (pausado o reproduciendo) se ve cómo cambia
          // la forma. Se oculta al dibujar (+ Figura / Redibujar) o cuando hay
          // paths recién dibujados sin fijar (se ve el lazo nuevo, no el morph).
          motionPaths.map((anchors, i) => (
            <path
              key={i}
              d={bezierD(anchors, true)}
              fill={accent}
              fillOpacity={0.12}
              stroke={accent}
              strokeWidth={1 / playerZoomFactor}
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))
        ) : hasMotion && motionMaskUrl && !(isFreehand && (drawingActive || (maskMergeMode && paths.some((p) => p.length >= 3)))) ? (
          // SAM2 (motionMasks): el contorno lo pinta el canvas de la máscara; el SVG no
          // dibuja el lazo estático para no superponer el contorno fijo sobre la máscara.
          // EXCEPCIÓN — segunda pasada SAM2 (maskMergeMode) o dibujo en curso: se
          // renderiza el lazo nuevo (en curso o ya cerrado) para que el usuario vea lo
          // que está dibujando sobre la máscara; sin esto, el dibujo quedaría invisible
          // y el botón del lazo "no funcionaría".
          null
        ) : shape.type === 'circle' ? (
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={width / 2}
            ry={height / 2}
            fill={accent}
            fillOpacity={0.12}
            stroke={accent}
            strokeWidth={0.6 / playerZoomFactor}
            strokeDasharray="2 1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : isFreehand ? (
          <>
            {/* Trazados ya cerrados */}
            {committedPaths.map((anchors, i) => (
              <path
                key={i}
                d={bezierD(anchors, true)}
                fill={accent}
                fillOpacity={0.12}
                stroke={accent}
                strokeWidth={1 / playerZoomFactor}
                strokeDasharray="2 1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* Trazado en curso: curva Bézier abierta (anclas fijadas + ancla en arrastre) */}
            {renderAnchors.length >= 1 && (
              <path
                d={bezierD(renderAnchors, false)}
                fill="none"
                stroke={accent}
                strokeWidth={1 / playerZoomFactor}
                strokeDasharray="2 1.5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Línea goma (recta) al cursor o al ancla en arrastre */}
            {rubberStart && rubberEnd && renderAnchors.length >= 1 && (
              <line
                x1={rubberStart.x}
                y1={rubberStart.y}
                x2={rubberEnd.x}
                y2={rubberEnd.y}
                stroke={accent}
                strokeWidth={0.8 / playerZoomFactor}
                strokeDasharray="1.5 1.5"
                opacity={0.7}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Mangos del ancla en arrastre (líneas + extremos) */}
            {dragging && dragAnchor && (
              <>
                <line x1={dragAnchor.x} y1={dragAnchor.y} x2={dragAnchor.hOutX} y2={dragAnchor.hOutY} stroke={accent} strokeWidth={0.4 / playerZoomFactor} opacity={0.9} vectorEffect="non-scaling-stroke" />
                <line x1={dragAnchor.x} y1={dragAnchor.y} x2={dragAnchor.hInX} y2={dragAnchor.hInY} stroke={accent} strokeWidth={0.4 / playerZoomFactor} opacity={0.9} vectorEffect="non-scaling-stroke" />
                {/* Los puntitos NO crecen con el zoom del reproductor: el radio se
                    divide por el factor de zoom (el contenedor escala el SVG). */}
                <circle cx={dragAnchor.hOutX} cy={dragAnchor.hOutY} r={0.8 / playerZoomFactor} fill={accent} />
                <circle cx={dragAnchor.hInX} cy={dragAnchor.hInY} r={0.8 / playerZoomFactor} fill={accent} />
                <circle cx={dragAnchor.x} cy={dragAnchor.y} r={1 / playerZoomFactor} fill="#fff" stroke={accent} strokeWidth={0.4 / playerZoomFactor} />
              </>
            )}
            {/* Sin marcadores de vértice: sólo la curva. Cerrar = clic cerca del
                1.er vértice (CLOSE_THRESHOLD), botón "Cerrar figura" o Enter/Esc. */}
          </>
        ) : shape.type === 'rect' ? (
          <polygon
            points={rectOutlinePoints(displayBox)}
            fill={accent}
            fillOpacity={0.12}
            stroke={accent}
            strokeWidth={1 / playerZoomFactor}
            strokeDasharray="2 1.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          // Varita mágica: la silueta es la máscara raster (canvas), no una forma
          // SVG. Sin máscara aún no se dibuja nada.
          null
        )}

        {/* VÉRTICES SIEMPRE SEÑALADOS — FUERA del ternario de la silueta: así se
            dibujan en cualquier estado (dibujando, figura cerrada o keyframe
            fijado con el morph en pantalla). Puntitos rojos pequeños (un poco
            más gruesos que el trazo); no crecen con el zoom. Mientras se dibuja:
            anclas del trazado en curso (solo visual). Con figura cerrada o
            keyframe fijado: editables — arrastrar = mover (mangos se desplazan),
            clic en el borde = añadir, doble clic/Supr = quitar (mínimo 3). */}
        {(drawingActive ? renderAnchors.length >= 3 : !!editTarget && editTarget.paths.some((p) => p.length >= 3)) && (
          <>
            {/* Borde invisible clicable para insertar vértices (solo figura cerrada o keyframe) */}
            {!drawingActive && editTarget && (
              editTarget.paths.map((anchors, pi) => (
                <path
                  key={`add-${pi}`}
                  d={bezierD(anchors, true)}
                  fill="none"
                  stroke="rgba(0,0,0,0.001)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  pointerEvents="stroke"
                  style={{ cursor: 'copy' }}
                  onClick={(e) => addVertexAt(e, pi, editTarget)}
                />
              ))
            )}
            {/* Puntitos rojos de los vértices */}
            {drawingActive
              ? renderAnchors.map((a, ai) => (
                  <circle
                    key={`draw-${ai}`}
                    cx={a.x}
                    cy={a.y}
                    r={0.25 / playerZoomFactor}
                    fill="#ef4444"
                    stroke="#ef4444"
                    strokeWidth={0.9 / playerZoomFactor}
                    vectorEffect="non-scaling-stroke"
                    />
                    ))
              : editTarget!.paths.map((anchors, pi) =>
                  anchors.map((a, ai) => {
                    const isSel = selectedVertex?.pi === pi && selectedVertex?.ai === ai;
                    return (
                      <g key={`${pi}-${ai}`}>
                        {/* Área de clic generosa (transparente) */}
                        <circle
                          cx={a.x}
                          cy={a.y}
                          r={1.1 / playerZoomFactor}
                          fill="transparent"
                          className="pointer-events-auto"
                          style={{ cursor: 'default' }}
                          onMouseDown={(e) => {
                            startVertexDrag(e, pi, ai, editTarget!);
                            setSelectedVertex({ pi, ai });
                          }}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeVertex(pi, ai, editTarget!);
                            setSelectedVertex(null);
                          }}
                        />
                        {/* Puntito visible: pequeño, rojo, más grueso que el trazo */}
                        <circle
                          cx={a.x}
                          cy={a.y}
                          r={(isSel ? 0.45 : 0.25) / playerZoomFactor}
                          fill="#ef4444"
                          stroke={isSel ? '#fff' : '#ef4444'}
                          strokeWidth={(isSel ? 0.6 : 0.9) / playerZoomFactor}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                )}
          </>
        )}
      </svg>

      {/* Máscara raster por frame (SAM2): canvas absoluto con el PNG tintado. */}
      {hasMotion && motionMaskUrl && (
        <canvas
          ref={maskCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Caja de edición (mover + redimensionar): rect/circle siempre; lazo sólo
          cuando hay un trazado cerrado y no se está dibujando. Con tracking, arrastrar
          crea/actualiza un keyframe en el tiempo actual; sin tracking, mueve/escala
          el lazo estáticamente (transforma los paths). Se oculta cuando la silueta
          está auto-driven (lazo por puntos / SAM2 / varita mágica): el contorno lo
          da el tracking o la máscara raster. */}
      {!isWand && !hasMotion && !drawingActive && (!isFreehand || paths.some((p) => p.length >= 3)) && (
        <div
          role="button"
          tabIndex={0}
          className="absolute cursor-move select-none pointer-events-auto border-2 border-dashed bg-transparent"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: `${width}%`,
            height: `${height}%`,
            borderColor: accent,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            touchAction: 'none',
            borderRadius: shape.type === 'circle' ? '50%' : 0,
          }}
          onMouseDown={(e) => startDrag(e, 'move')}
        >
          {/* esquinas */}
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span
              key={c}
              className="absolute h-2.5 w-2.5 border border-black/50 rounded-sm pointer-events-none"
              style={{
                background: accent,
                top: c.startsWith('n') ? -5 : undefined,
                bottom: c.startsWith('s') ? -5 : undefined,
                left: c.endsWith('w') ? -5 : undefined,
                right: c.endsWith('e') ? -5 : undefined,
              }}
            />
          ))}
          {/* handle de redimensión (inferior-derecha) */}
          <button
            type="button"
            title="{t('videoEditor.selection.resizeSelection')}"
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full border border-white shadow-lg cursor-se-resize pointer-events-auto"
            style={{ background: accent }}
            onMouseDown={(e) => startDrag(e, 'resize')}
          />
        </div>
      )}

      {/* Freehand: botones mientras se dibuja un trazado */}
      {isFreehand && drawingActive && pathOpen && (
        <div className="absolute top-2 right-2 flex gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={stopAnd(undoVertex)}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-black/70 text-white border border-white/20 hover:bg-black/90"
          >
            ↶ Deshacer
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Modificadores del clic de cierre: Ctrl añade, Shift extrae (varita).
              lazoModsRef.current = { ctrl: e.ctrlKey, shift: e.shiftKey };
              finishPath();
            }}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-600/80 text-white border border-emerald-400/40 hover:bg-emerald-500"
          >
            Cerrar figura
          </button>
        </div>
      )}

      {/* Freehand: botones cuando hay trazados cerrados y no se está dibujando.
          Con seguimiento activo también se muestran: redibujar sirve para crear el
          lazo NUEVO del siguiente keyframe (morph). Se ocultan con máscara raster
          SAM2 (motionMaskUrl) salvo en la segunda pasada (maskMergeMode), donde
          redibujar el lazo en el frame actual re-segmenta y añade a las máscaras.
          Con motionPaths (morph de lazo) sí se muestran. */}
      {isFreehand && (maskMergeMode || !motionMaskUrl) && !drawingActive && (paths.some((p) => p.length >= 3) || hasKf) && (
        <div className="absolute top-2 right-2 flex gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={addPolygon}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-600/80 text-white border border-emerald-400/40 hover:bg-emerald-500"
          >
            + Figura
          </button>
          <button
            type="button"
            onClick={redraw}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-black/70 text-white border border-white/20 hover:bg-black/90"
          >
            Redibujar
          </button>
        </div>
      )}

      {/* Freehand: hint de dibujo */}
      {drawingActive && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider px-3 py-1 rounded bg-black/70 text-white pointer-events-none whitespace-nowrap">
          {!pathOpen
            ? (paths.length === 0 ? t('videoEditor.selection.hintBezier') : t('videoEditor.selection.hintStartAnother'))
            : t('videoEditor.selection.hintLassoCloseEnter')}
        </div>
      )}

      {/* Varita mágica: hint de clic */}
      {wandActive && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider px-3 py-1 rounded bg-black/70 text-white pointer-events-none whitespace-nowrap">
          {hasMotion ? t('videoEditor.selection.hintLassoReselect') : t('videoEditor.selection.hintWandPick')}
        </div>
      )}

      {/* Varita en retoque de máscara: hint de clic */}
      {isMaskWand && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider px-3 py-1 rounded bg-black/70 text-violet-300 border border-violet-500/30 pointer-events-none whitespace-nowrap">
          {t('videoEditor.selection.hintWand')}
        </div>
      )}

      {/* Seguimiento: badge de tiempo actual + nº de keyframes (+ indicador de borrador) */}
      {tracking && !drawingActive && (
        <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-black/70 text-emerald-300 border border-emerald-500/30 pointer-events-none">
          Seguimiento · {fmtHMSLocal(currentTime)} · {(shape.keyframes?.length ?? 0)} kf
          {draftActive && <span className="text-amber-300"> · borrador (sin fijar)</span>}
        </div>
      )}
    </div>
  );
}

// h:m:s local (sin importar el del módulo padre para mantener el componente autónomo)
function fmtHMSLocal(total: number): string {
  if (!isFinite(total) || total < 0) total = 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}