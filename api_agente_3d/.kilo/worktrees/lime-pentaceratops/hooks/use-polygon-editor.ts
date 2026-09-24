'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Polygon,
  Point2D,
  Handle2D,
  DEFAULT_HANDLE_LEN,
  closestEdgeHit,
} from '@/lib/geometry';
import {
  nearestPolylineHit,
  verticesInRect,
  newPolylineId,
} from '@/lib/polylines';
import type {
  Polyline,
  CanvasTool,
  VertexRef,
  MarqueeRect,
} from '@/lib/polylines';

/** Pulsación larga sobre un vértice para convertir la esquina en curva:
    se mantiene un buen rato para que NO se active sin querer al pinchar
    o arrastrar despacio. */
const HOLD_TO_CURVE_MS = 800;
/** Desplazamiento mínimo para considerar que es un arrastre (cancela la curva) */
const DRAG_THRESHOLD = 0.01;
/** Distancia al vértice por debajo de la cual un asa se elimina al soltar */
const HANDLE_EPS = 0.03;
/** Cerca de una arista, el clic inserta el vértice EN esa arista */
const EDGE_HIT_EPS = 0.025;
/** Segmentos del arco al redondear una esquina (herramienta Curva) */
const ROUND_SEGMENTS = 8;
/** Radio de hit por defecto (en unidades del lienzo) para polilíneas */
const DEFAULT_PICK_RADIUS = 0.03;

/**
 * Redondea en arco la esquina prev-vertex-next, igual que la
 * herramienta de esquina redondeada del editor de iconos: devuelve los
 * puntos que SUSTITUYEN al vértice (los dos puntos tangentes y el
 * arco entre ellos). null si la esquina no se puede redondear (sin
 * cerrar, casi en línea recta, radio demasiado pequeño…).
 */
function computeRoundCornerPoints(
  prev: Point2D,
  vertex: Point2D,
  next: Point2D,
  radius: number,
  segments: number
): Point2D[] | null {
  const v1x = prev.x - vertex.x;
  const v1y = prev.y - vertex.y;
  const v2x = next.x - vertex.x;
  const v2y = next.y - vertex.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 < 0.001 || len2 < 0.001) return null;
  // El radio nunca pasa de la mitad de la arista más corta
  const maxRadius = Math.min(len1, len2) * 0.5;
  const r = Math.min(radius, maxRadius);
  if (r < 0.005) return null;
  const u1x = v1x / len1;
  const u1y = v1y / len1;
  const u2x = v2x / len2;
  const u2y = v2y / len2;
  // Esquinas en línea recta: nada que redondear
  const cross = u1x * u2y - u1y * u2x;
  if (Math.abs(cross) < 0.001) return null;
  const t1 = { x: vertex.x + u1x * r, y: vertex.y + u1y * r };
  const t2 = { x: vertex.x + u2x * r, y: vertex.y + u2y * r };
  // Centro del arco: corte de las tangentes en t1 y t2
  const dx = t2.x - t1.x;
  const dy = t2.y - t1.y;
  const s = (dx * u2y - dy * u2x) / cross;
  const cx = t1.x + u1x * s;
  const cy = t1.y + u1y * s;
  // Puntos del arco (bézier cuadrática de t1 a t2 con control (cx, cy))
  const segs = Math.max(1, Math.round(segments));
  const arc: Point2D[] = [];
  for (let i = 1; i <= segs; i++) {
    const t = i / (segs + 1);
    const it = 1 - t;
    arc.push({
      x: it * it * t1.x + 2 * it * t * cx + t * t * t2.x,
      y: it * it * t1.y + 2 * it * t * cy + t * t * t2.y,
    });
  }
  return [t1, ...arc, t2];
}

/**
 * Radio del redondeo para TODAS las esquinas de la figura: fracción del
 * tamaño de la figura (la mitad de su lado más corto), igual que en el
 * editor de iconos el radio es fijo y no depende de la esquina. Así,
 * tras redondear una esquina, las demás no salen más pequeñas porque
 * una arista vecina se haya acortado.
 */
function polygonRoundRadius(polygon: Point2D[], curveAmount: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return curveAmount * Math.min(maxX - minX, maxY - minY) * 0.5;
}

type HandleSide = 'in' | 'out';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Entrada del historial del lienzo: polígono y polilíneas juntos, así
    deshacer restaura el estado COMPLETO (contorno + líneas libres) */
interface HistoryEntry {
  polygon: Polygon;
  polylines: Polyline[];
}

/** Posición de arranque de un vértice seleccionado durante el arrastre
    de grupo (con sus asas, si las tiene): el grupo se mueve rígido. */
interface GroupDragStart {
  ref: VertexRef;
  x: number;
  y: number;
  hIn?: Handle2D;
  hOut?: Handle2D;
}

interface GroupDrag {
  /** Puntero (sin imantar) donde empezó el arrastre */
  origin: Point2D;
  /** Vértice agarrado: su destino manda en la imantación del grupo */
  grabbed: VertexRef;
  /** Posiciones de partida de todos los vértices seleccionados */
  positions: GroupDragStart[];
}

const sameRef = (a: VertexRef, b: VertexRef) =>
  a.line === b.line && a.vertex === b.vertex;

interface UsePolygonEditorOptions {
  polygon: Polygon;
  onChange: (polygon: Polygon) => void;
  /** Resolución de la cuadrícula, para la imantación */
  resolution?: number;
  /** Imantación a la cuadrícula activada */
  snap?: boolean;
  /** Área visible del lienzo; permite perfiles del torno más altos que 0..1. */
  coordinateBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  /**
   * Grado de la curva al crearla (fracción de la arista vecina más
   * corta): lo ajusta el slider "Curva" del lienzo. A más grado, las
   * asas salen más largas y la esquina se redondea más.
   */
  curveAmount?: number;
  /**
   * Cantidad de vértices del arco al redondear una esquina (igual que
   * el slider de segmentos de la herramienta del editor de iconos):
   * lo ajusta el slider "Vértices" del lienzo. Más = arco más suave.
   */
  curveSegments?: number;
  /**
   * Modo "predibujar curva" (casilla del lienzo): al pasar por una
   * esquina recta se predibuja la curva y al pinchar el vértice se
   * crea directamente con el grado del slider (en vez de arrastrarlo).
   */
  curvePreview?: boolean;
  /** Polilíneas libres del lienzo (solo se editan con las herramientas) */
  polylines?: Polyline[];
  onPolylinesChange?: (lines: Polyline[]) => void;
  /** Herramienta activa del lienzo (Editar/Línea/Goma/Selección) */
  tool?: CanvasTool;
  /**
   * Radio de hit (en unidades del lienzo) para polilíneas y vértices
   * de las herramientas. El lienzo grande pasa uno constante en
   * pantalla (independiente del zoom).
   */
  pickRadius?: number;
}

/**
 * Lógica de edición de un polígono 2D compartida por el mini-lienzo y el
 * editor grande: añadir/arrastrar/eliminar vértices, deshacer/rehacer,
 * imantación, curvado de esquinas y, con las opciones de polilíneas,
 * dibujar/borrar líneas libres y seleccionar varios vértices con una
 * marquesina para moverlos todos a la vez.
 *
 * Curvado: manteniendo pulsado un vértice (~350 ms) la esquina se convierte
 * en curva y aparecen dos asas (segmentos) a los lados; moviendo el ratón
 * se gradúa en simétrico y, tras soltar, cada asa se arrastra por separado.
 */
export function usePolygonEditor({
  polygon,
  onChange,
  resolution = 16,
  snap = false,
  coordinateBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  curveAmount = DEFAULT_HANDLE_LEN,
  curveSegments = ROUND_SEGMENTS,
  curvePreview = false,
  polylines,
  onPolylinesChange,
  tool = 'edit',
  pickRadius = DEFAULT_PICK_RADIUS,
}: UsePolygonEditorOptions) {
  const polylinesOrDefault = polylines ?? [];
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [curveIndex, setCurveIndex] = useState<number | null>(null);
  // Vértice seleccionado con un clic (se dibuja en otro color hasta que
  // se pinche otro vértice o cualquier zona libre).
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const isDragging = useRef(false);
  const curveMode = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const downPoint = useRef<Point2D>({ x: 0, y: 0 });
  const moved = useRef(false);
  const handleDrag = useRef<{ vi: number; side: HandleSide } | null>(null);

  // --- Polilíneas libres -------------------------------------------------
  // Polilínea en curso de la herramienta Línea (null = no se dibuja)
  const [draft, setDraft] = useState<Point2D[] | null>(null);
  // Punto bajo el cursor para prever el segmento siguiente
  const [cursorPoint, setCursorPoint] = useState<Point2D | null>(null);
  // Momento del último punto añadido al draft: para quitar el punto
  // duplicado que añade el doble clic al confirmar la línea.
  const lastAddedAt = useRef(0);
  // Polilínea que quedaría borrada por la goma (resaltado en rojo)
  const [hoverPolyline, setHoverPolyline] = useState<string | null>(null);
  // --- Selección por marquesina ------------------------------------------
  // Cuadrado discontinuo que se arrastra con el ratón (unidades del lienzo)
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  // Vértices seleccionados (del contorno y de las polilíneas)
  const [selection, setSelection] = useState<VertexRef[]>([]);
  // Arrastre de grupo: posiciones de partida de todos los seleccionados
  const groupDrag = useRef<GroupDrag | null>(null);
  // Arrastre individual de un vértice de polilínea
  const polyVertexDrag = useRef<VertexRef | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, []);

  const pushHistory = useCallback(() => {
    const entry: HistoryEntry = {
      polygon,
      polylines: polylinesOrDefault,
    };
    setHistory((h) => [...h.slice(-30), entry]);
    setRedoStack([]);
  }, [polygon, polylinesOrDefault]);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const snapPoint = useCallback(
    (p: Point2D): Point2D => {
      if (!snap) return p;
      // Imán con umbral: solo atrae al cruce si el punto está cerca de él
      // (35% de celda). Así pinchar en mitad de una celda no desplaza el
      // punto a un cruce que no es el que quieres.
      // La cuadrícula visible usa coordenadas globales: cada cuadrado mide
      // 1/resolution, también cuando el lienzo se ha ampliado alrededor.
      const cell = 1 / resolution;
      const sx = Math.round(p.x / cell) * cell;
      const sy = Math.round(p.y / cell) * cell;
      return {
        x: Math.abs(p.x - sx) <= 0.35 * cell ? sx : p.x,
        y: Math.abs(p.y - sy) <= 0.35 * cell ? sy : p.y,
      };
    },
    [resolution, snap]
  );

  const clampPoint = useCallback(
    (p: Point2D): Point2D => ({
      x: Math.max(coordinateBounds.minX, Math.min(coordinateBounds.maxX, p.x)),
      y: Math.max(coordinateBounds.minY, Math.min(coordinateBounds.maxY, p.y)),
    }),
    [coordinateBounds]
  );

  /**
   * Posición del puntero en unidades del lienzo. Por defecto imanta y
   * acota como toLocal; las esquinas de la marquesina y los deltas de
   * arrastre piden la posición cruda (sin imantar ni acotar) porque
   * imantarlas deformaría el gesto en vez de seguir al ratón.
   */
  const toCanvasPoint = useCallback(
    (
      e: ReactPointerEvent,
      opts?: { snap?: boolean; clamp?: boolean }
    ): Point2D => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const doSnap = opts?.snap ?? true;
      const doClamp = opts?.clamp ?? true;
      const rect = svg.getBoundingClientRect();
      let x = coordinateBounds.minX +
        ((e.clientX - rect.left) / rect.width) *
          (coordinateBounds.maxX - coordinateBounds.minX);
      let y = coordinateBounds.minY +
        ((e.clientY - rect.top) / rect.height) *
          (coordinateBounds.maxY - coordinateBounds.minY);
      if (doSnap) ({ x, y } = snapPoint({ x, y }));
      if (doClamp) ({ x, y } = clampPoint({ x, y }));
      return { x, y };
    },
    [clampPoint, coordinateBounds, snapPoint]
  );

  // Alias del comportamiento clásico (imanta y acota)
  const toLocal = useCallback(
    (e: ReactPointerEvent): Point2D => toCanvasPoint(e),
    [toCanvasPoint]
  );

  /**
   * Gradúa la curva mientras se mantiene pulsado: el asa saliente sigue al
   * ratón y la entrante es su espejo respecto al vértice (curva suave).
   */
  const adjustCurve = useCallback(
    (i: number, pt: Point2D) => {
      const n = polygon.length;
      if (n < 3 || i < 0 || i >= n) return;
      const p = polygon[i];
      const hOut = clampPoint(pt);
      const hIn: Handle2D = {
        ...clampPoint({ x: 2 * p.x - pt.x, y: 2 * p.y - pt.y }),
      };
      onChange(
        polygon.map((q, idx) => (idx === i ? { x: q.x, y: q.y, hIn, hOut } : q))
      );
    },
    [clampPoint, polygon, onChange]
  );

  /** Arrastra un asa individual a la posición del ratón */
  const updateHandle = useCallback(
    (pt: Point2D) => {
      const hd = handleDrag.current;
      if (!hd) return;
      const { vi, side } = hd;
      const h = clampPoint(pt);
      onChange(
        polygon.map((q, idx) => {
          if (idx !== vi) return q;
          return side === 'in'
            ? { x: q.x, y: q.y, hIn: h }
            : { x: q.x, y: q.y, hOut: h };
        })
      );
    },
    [clampPoint, polygon, onChange]
  );

  /**
   * Elimina las asas que hayan quedado sobre el propio vértice
   * (curva reducida a cero → esquina recta otra vez).
   */
  const stripDegenerateHandles = useCallback(
    (vi: number) => {
      const v = polygon[vi];
      if (!v || (!v.hIn && !v.hOut)) return;
      const dIn = v.hIn ? Math.hypot(v.hIn.x - v.x, v.hIn.y - v.y) : 0;
      const dOut = v.hOut ? Math.hypot(v.hOut.x - v.x, v.hOut.y - v.y) : 0;
      const keepIn = dIn >= HANDLE_EPS;
      const keepOut = dOut >= HANDLE_EPS;
      if (keepIn && keepOut) return;
      onChange(
        polygon.map((q, i) => {
          if (i !== vi) return q;
          const out: Point2D = { x: q.x, y: q.y };
          if (keepIn) out.hIn = q.hIn;
          if (keepOut) out.hOut = q.hOut;
          return out;
        })
      );
    },
    [polygon, onChange]
  );

  /**
   * Confirma la polilínea en curso (Enter, doble clic o reclic en la
   * herramienta): solo se crea si tiene al menos 2 puntos. Acepta puntos
   * de reemplazo (el doble clic añade uno duplicado con su segundo clic:
   * el lienzo lo quita pasando draft.slice(0, -1)).
   */
  const commitDraft = useCallback(
    (override?: Point2D[]) => {
      const pts = override ?? draft;
      if (pts !== null && pts.length >= 2) {
        pushHistory();
        onPolylinesChange?.([
          ...polylinesOrDefault,
          { id: newPolylineId(), points: pts },
        ]);
      }
      setDraft(null);
      setCursorPoint(null);
    },
    [draft, pushHistory, onPolylinesChange, polylinesOrDefault]
  );

  /** Cancela la polilínea en curso (Esc): no se crea nada. */
  const cancelDraft = useCallback(() => {
    setDraft(null);
    setCursorPoint(null);
  }, []);

  /**
   * Borra todos los vértices del CONTORNO que están seleccionados con
   * la marquesina (herramienta Selección). Devuelve false si no había
   * nada que borrar.
   */
  const deleteSelectedVertices = useCallback(() => {
    const refs = selection.filter(
      (r) => r.line === -1 && r.vertex >= 0 && r.vertex < polygon.length
    );
    if (refs.length === 0) return false;

    pushHistory();

    const indicesToDelete = Array.from(new Set(refs.map((r) => r.vertex)));
    const newPoly = polygon.filter((_, i) => !indicesToDelete.includes(i));
    onChange(newPoly);
    setSelection([]);
    setSelectedVertex(null);

    return true;
  }, [selection, polygon, onChange, pushHistory]);

  // Enter confirma y Escape cancela la polilínea en curso. Solo actúan
  // mientras se dibuja una línea (draft activo) y el foco no está en un
  // campo de texto.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (draft === null) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelDraft();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitDraft();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, cancelDraft, commitDraft]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        return;
      }
      // Un clic mientras se gradúa la curva (pulsación larga o tecla
      // Mayúsculas) la confirma y sale del modo curva: no crea ni
      // deselecciona nada.
      if (tool === 'edit' && curveMode.current && curveIndex !== null) {
        curveMode.current = false;
        stripDegenerateHandles(curveIndex);
        setCurveIndex(null);
        return;
      }
      // Herramienta Línea: cada clic añade un punto al final de la
      // polilínea en curso (la primera activa el dibujo). La captura
      // del puntero permite seguir añadiendo aunque se salga un momento.
      if (tool === 'line') {
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const pt = toCanvasPoint(e);
        setDraft((d) => (d === null ? [pt] : [...d, pt]));
        lastAddedAt.current = Date.now();
        setCursorPoint(pt);
        return;
      }
      // Goma: si hay vértices del contorno seleccionados, los borra;
      // si no, borra la polilínea libre más cercana al puntero.
      if (tool === 'erase') {
        if (
          selection.some((r) => r.line === -1 && r.vertex >= 0 && r.vertex < polygon.length)
        ) {
          deleteSelectedVertices();
          return;
        }
        const pt = toCanvasPoint(e);
        const hit = nearestPolylineHit(polylinesOrDefault, pt, pickRadius);
        if (hit !== null) {
          pushHistory();
          onPolylinesChange?.(
            polylinesOrDefault.filter((l) => l.id !== hit)
          );
          setHoverPolyline(null);
        }
        return;
      }
      // Selección: arrastrar en zona libre abre la marquesina (el
      // cuadrado discontinuo). La esquina va SIN imantar para que el
      // cuadrado siga exactamente al ratón.
      if (tool === 'select') {
        const raw = toCanvasPoint(e, { snap: false, clamp: false });
        setMarquee({ x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y });
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      // --- Modo edición (comportamiento clásico) ---
      // Los vértices y asas capturan sus propios clics mediante un halo
      // invisible; aquí solo llegan clics en zona libre.
      // Pinchar fuera de un vértice deselecciona el que estuviera marcado.
      setSelectedVertex(null);
      // Si el clic cae sobre una arista (recta o curva), el nuevo vértice
      // se inserta EN esa arista, justo donde has pinchado.
      // Mientras la figura aún no está cerrada (menos de 3 puntos), un
      // clic en zona libre sigue añadiendo puntos del contorno. Pero una
      // vez la figura existe, pinchar fuera de ella ya no crea vértices
      // (antes salían líneas raras que cruzaban hasta el objeto).
      const pt = toCanvasPoint(e);
      const hit = closestEdgeHit(polygon, pt);
      if (hit && hit.dist < EDGE_HIT_EPS) {
        pushHistory();
        const newPoly = [...polygon];
        newPoly.splice(hit.edge + 1, 0, hit.point);
        onChange(newPoly);
        setDragIndex(hit.edge + 1);
        isDragging.current = true;
        moved.current = true;
      } else if (polygon.length < 3) {
        pushHistory();
        onChange([...polygon, pt]);
        setDragIndex(polygon.length);
        isDragging.current = true;
        moved.current = true;
      }
      // Clic fuera del objeto con la figura ya hecha: no hace nada. Para
      // añadir un vértice, pincha sobre una arista.
    },
    [
      tool,
      curveIndex,
      stripDegenerateHandles,
      toCanvasPoint,
      polylinesOrDefault,
      pickRadius,
      pushHistory,
      onPolylinesChange,
      polygon,
      onChange,
      selection,
      deleteSelectedVertices,
    ]
  );

  /**
   * Arrastre de grupo: mueve todos los vértices seleccionados con el
   * mismo desplazamiento rígido. La imantación se aplica sobre el
   * vértice agarrado (su destino se ajusta a la cuadrícula y el resto
   * del grupo lo sigue); solo ese vértice se acota a la vista, para
   * que el grupo no se deforme al llegar al borde.
   */
  const moveGroup = useCallback(
    (raw: Point2D) => {
      const gd = groupDrag.current;
      if (!gd) return;
      const grabbedStart = gd.positions.find((s) => sameRef(s.ref, gd.grabbed));
      if (!grabbedStart) return;
      const target = clampPoint(
        snapPoint({
          x: grabbedStart.x + (raw.x - gd.origin.x),
          y: grabbedStart.y + (raw.y - gd.origin.y),
        })
      );
      const dx = target.x - grabbedStart.x;
      const dy = target.y - grabbedStart.y;
      if (dx === 0 && dy === 0) return;
      // Vértices seleccionados del contorno: se llevan sus asas consigo
      const contourRefs = gd.positions.filter((s) => s.ref.line === -1);
      if (contourRefs.length > 0) {
        onChange(
          polygon.map((p, i) => {
            const s = contourRefs.find((q) => q.ref.vertex === i);
            if (!s) return p;
            return {
              x: s.x + dx,
              y: s.y + dy,
              ...(s.hIn
                ? { hIn: { x: s.hIn.x + dx, y: s.hIn.y + dy } as Handle2D }
                : {}),
              ...(s.hOut
                ? { hOut: { x: s.hOut.x + dx, y: s.hOut.y + dy } as Handle2D }
                : {}),
            };
          })
        );
      }
      // Vértices seleccionados de las polilíneas
      const lineRefs = gd.positions.filter((s) => s.ref.line >= 0);
      if (lineRefs.length > 0) {
        onPolylinesChange?.(
          polylinesOrDefault.map((line, li) => {
            const refs = lineRefs.filter((s) => s.ref.line === li);
            if (refs.length === 0) return line;
            return {
              ...line,
              points: line.points.map((pt, i) => {
                const s = refs.find((q) => q.ref.vertex === i);
                if (!s) return pt;
                return { x: s.x + dx, y: s.y + dy };
              }),
            };
          })
        );
      }
    },
    [clampPoint, snapPoint, polygon, onChange, onPolylinesChange, polylinesOrDefault]
  );

  /** Arrastra un único vértice de polilínea a la posición del ratón */
  const movePolylineVertex = useCallback(
    (pt: Point2D) => {
      const vd = polyVertexDrag.current;
      if (!vd) return;
      onPolylinesChange?.(
        polylinesOrDefault.map((line, li) => {
          if (li !== vd.line) return line;
          return {
            ...line,
            points: line.points.map((p, i) =>
              i === vd.vertex ? { x: pt.x, y: pt.y } : p
            ),
          };
        })
      );
    },
    [onPolylinesChange, polylinesOrDefault]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      // Arrastre de un asa individual
      if (handleDrag.current) {
        updateHandle(toLocal(e));
        return;
      }

      // Modo curva: el ratón gradúa la curvatura, no mueve el vértice.
      // Solo gradúa cuando el ratón se ha separado del vértice: al
      // mantener pulsado el ratón está sobre el vértice y un temblor
      // mínimo colapsaría las asas (curva a cero) recién creadas.
      if (curveMode.current && curveIndex !== null) {
        const p = polygon[curveIndex];
        const pt = toLocal(e);
        const d = p ? Math.hypot(pt.x - p.x, pt.y - p.y) : 0;
        if (d > DRAG_THRESHOLD) adjustCurve(curveIndex, pt);
        return;
      }

      // Herramienta Línea: prever el segmento siguiente bajo el cursor
      if (tool === 'line') {
        if (draft !== null) {
          // Sin imantar: la previsualización sigue fiel al ratón
          setCursorPoint(toCanvasPoint(e, { snap: false }));
        }
        return;
      }

      // Goma: resalta la polilínea que quedaría borrada
      if (tool === 'erase') {
        // Si hay vértices seleccionados, no resaltar polilíneas
        if (
          selection.some((r) => r.line === -1 && r.vertex >= 0 && r.vertex < polygon.length)
        ) {
          return;
        }
        const raw = toCanvasPoint(e, { snap: false, clamp: false });
        setHoverPolyline(
          nearestPolylineHit(polylinesOrDefault, raw, pickRadius)
        );
        return;
      }

      // Selección: arrastre de grupo o marquesina
      if (tool === 'select') {
        const raw = toCanvasPoint(e, { snap: false, clamp: false });
        if (groupDrag.current) {
          moveGroup(raw);
          return;
        }
        if (polyVertexDrag.current) {
          movePolylineVertex(toCanvasPoint(e));
          return;
        }
        if (marquee) {
          setMarquee((m) => (m ? { ...m, x1: raw.x, y1: raw.y } : m));
          return;
        }
      }

      const pt = toLocal(e);
      const hitIndex = polygon.findIndex(
        (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 0.04
      );
      setHoverIndex(hitIndex >= 0 ? hitIndex : null);

      if (isDragging.current && dragIndex !== null) {
        // Si se mueve antes de que salte la pulsación larga, es un arrastre
        if (!moved.current) {
          const d = Math.hypot(
            pt.x - downPoint.current.x,
            pt.y - downPoint.current.y
          );
          if (d < DRAG_THRESHOLD) return;
          moved.current = true;
          clearHold();
        }
        // El vértice se lleva sus asas consigo (la curva acompaña)
        onChange(
          polygon.map((p, i) => {
            if (i !== dragIndex) return p;
            const dx = pt.x - p.x;
            const dy = pt.y - p.y;
            return {
              x: pt.x,
              y: pt.y,
              ...(p.hIn
                ? { hIn: clampPoint({ x: p.hIn.x + dx, y: p.hIn.y + dy }) }
                : {}),
              ...(p.hOut
                ? { hOut: clampPoint({ x: p.hOut.x + dx, y: p.hOut.y + dy }) }
                : {}),
            };
          })
        );
      }
    },
    [
      tool,
      draft,
      marquee,
      polylinesOrDefault,
      pickRadius,
      moveGroup,
      movePolylineVertex,
      toLocal,
      toCanvasPoint,
      clampPoint,
      polygon,
      onChange,
      dragIndex,
      curveIndex,
      adjustCurve,
      updateHandle,
      clearHold,
    ]
  );

  const handlePointerUp = useCallback(() => {
    clearHold();
    if (handleDrag.current) {
      const vi = handleDrag.current.vi;
      handleDrag.current = null;
      stripDegenerateHandles(vi);
    }
    if (curveMode.current && curveIndex !== null) {
      stripDegenerateHandles(curveIndex);
    }
    curveMode.current = false;
    isDragging.current = false;
    setDragIndex(null);
    setCurveIndex(null);
    // Selección: la marquesina cierra y selecciona los vértices que
    // quedaron dentro del cuadrado. Un clic en zona libre (marquesina
    // casi nula) deselecciona todo.
    if (tool === 'select') {
      if (groupDrag.current) {
        groupDrag.current = null;
      } else if (marquee) {
        const w = Math.abs(marquee.x1 - marquee.x0);
        const h = Math.abs(marquee.y1 - marquee.y0);
        if (w < DRAG_THRESHOLD && h < DRAG_THRESHOLD) {
          setSelection([]);
          setSelectedVertex(null);
        } else {
          setSelection(verticesInRect(polygon, polylinesOrDefault, marquee));
        }
        setMarquee(null);
      }
      if (polyVertexDrag.current) {
        polyVertexDrag.current = null;
      }
    }
  }, [
    clearHold,
    stripDegenerateHandles,
    curveIndex,
    tool,
    marquee,
    polygon,
    polylinesOrDefault,
  ]);

  /**
   * Crea la curva de la esquina i: le saca las dos asas laterales con el
   * grado del slider (sobre las propias aristas, sin deformar la
   * figura). No empuja el historial: lo hace quien la llama. No hace
   * nada si la esquina ya era curva.
   */
  const createCurve = useCallback(
    (i: number) => {
      const n = polygon.length;
      if (n < 3 || i < 0 || i >= n) return;
      const v = polygon[i];
      if (!v || v.hIn || v.hOut) return;
      const prev = polygon[(i - 1 + n) % n];
      const next = polygon[(i + 1) % n];
      const dPrev = Math.hypot(prev.x - v.x, prev.y - v.y) || 1;
      const dNext = Math.hypot(next.x - v.x, next.y - v.y) || 1;
      const L = curveAmount * Math.min(dPrev, dNext);
      const hIn: Handle2D = {
        ...clampPoint({
          x: v.x + ((prev.x - v.x) / dPrev) * L,
          y: v.y + ((prev.y - v.y) / dPrev) * L,
        }),
      };
      const hOut: Handle2D = {
        ...clampPoint({
          x: v.x + ((next.x - v.x) / dNext) * L,
          y: v.y + ((next.y - v.y) / dNext) * L,
        }),
      };
      onChange(
        polygon.map((q, idx) =>
          idx === i ? { x: q.x, y: q.y, hIn, hOut } : q
        )
      );
    },
    [polygon, clampPoint, onChange, curveAmount]
  );

  /**
   * Puntos del arco que TENDRÍA la esquina i al redondearla con el
   * slider actual: para predibujarla en discontinuo al pasar por una
   * esquina recta. null si no se puede redondear (ya curvada, casi en
   * línea recta, figura sin cerrar…).
   */
  const getRoundPreview = useCallback(
    (i: number): Point2D[] | null => {
      const n = polygon.length;
      if (n < 3 || i < 0 || i >= n) return null;
      const v = polygon[i];
      if (!v || v.hIn || v.hOut) return null;
      const prev = polygon[(i - 1 + n) % n];
      const next = polygon[(i + 1) % n];
      const radius = polygonRoundRadius(polygon, curveAmount);
      return computeRoundCornerPoints(prev, v, next, radius, curveSegments);
    },
    [polygon, curveAmount, curveSegments]
  );

  /**
   * Redondea la esquina i al estilo del editor de iconos: el vértice
   * se SUSTITUYE por los puntos del arco (tangentes + arco), así la
   * curva es real y visible desde el primer momento. Devuelve false
   * si no se puede redondear.
   */
  const roundCorner = useCallback(
    (i: number): boolean => {
      const n = polygon.length;
      if (n < 3 || i < 0 || i >= n) return false;
      const v = polygon[i];
      if (!v || v.hIn || v.hOut) return false;
      const prev = polygon[(i - 1 + n) % n];
      const next = polygon[(i + 1) % n];
      const radius = polygonRoundRadius(polygon, curveAmount);
      const arc = computeRoundCornerPoints(prev, v, next, radius, curveSegments);
      if (!arc) return false;
      pushHistory();
      onChange([
        ...polygon.slice(0, i),
        ...arc.map((p) => clampPoint(p)),
        ...polygon.slice(i + 1),
      ]);
      return true;
    },
    [polygon, onChange, curveAmount, curveSegments, pushHistory, clampPoint]
  );

  /**
   * Modo curva interactivo (pulsación larga sobre el vértice): crea la
   * curva si la esquina era recta y, a partir de ahí, el movimiento del
   * ratón la gradúa.
   */
  const enterCurveMode = useCallback(
    (i: number) => {
      const n = polygon.length;
      if (n < 3 || i < 0 || i >= n) return;
      curveMode.current = true;
      setDragIndex(null);
      setCurveIndex(i);
      createCurve(i);
    },
    [createCurve]
  );

  // Tecla Mayúsculas con un vértice seleccionado: redondea la esquina
  // con el radio del slider, como la herramienta Curva del editor de
  // iconos (el vértice se sustituye por los puntos del arco).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || selectedVertex === null) return;
      if (roundCorner(selectedVertex)) setSelectedVertex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedVertex, roundCorner]);

  /**
   * Reglas comunes de la herramienta Selección al pulsar un vértice
   * (del contorno o de una polilínea). Devuelve 'toggle' (Ctrl: alternar
   * y no arrastrar), 'group' (ya seleccionado y selección múltiple:
   * arrastrarlos todos) o 'single' (comportamiento clásico).
   */
  const resolveSelectPress = useCallback(
    (e: ReactPointerEvent, ref: VertexRef): 'toggle' | 'group' | 'single' => {
      if (e.ctrlKey || e.metaKey) {
        setSelection((sel) =>
          sel.some((r) => sameRef(r, ref))
            ? sel.filter((r) => !sameRef(r, ref))
            : [...sel, ref]
        );
        return 'toggle';
      }
      const isSelected = selection.some((r) => sameRef(r, ref));
      if (isSelected && selection.length > 1) return 'group';
      // Pulsar un vértice no seleccionado lo deja como única selección
      // (pinchar o arrastrar hacen lo mismo, sin sorpresas).
      if (!isSelected) setSelection([ref]);
      return 'single';
    },
    [selection]
  );

  /** Prepara el arrastre de grupo con las posiciones de partida */
  const beginGroupDrag = useCallback(
    (e: ReactPointerEvent, grabbed: VertexRef) => {
      pushHistory();
      const contourPositions: GroupDragStart[] = selection
        .filter((r) => r.line === -1 && r.vertex < polygon.length)
        .map((r) => {
          const p = polygon[r.vertex];
          return {
            ref: r,
            x: p.x,
            y: p.y,
            ...(p.hIn ? { hIn: p.hIn } : {}),
            ...(p.hOut ? { hOut: p.hOut } : {}),
          };
        });
      const linePositions: GroupDragStart[] = selection
        .filter((r) => r.line >= 0 && r.line < polylinesOrDefault.length)
        .map((r) => {
          const p = polylinesOrDefault[r.line]?.points[r.vertex];
          return p ? { ref: r, x: p.x, y: p.y } : null;
        })
        .filter((s): s is GroupDragStart => s !== null);
      groupDrag.current = {
        origin: toCanvasPoint(e, { snap: false, clamp: false }),
        grabbed,
        positions: [...contourPositions, ...linePositions],
      };
    },
    [pushHistory, selection, polygon, polylinesOrDefault, toCanvasPoint]
  );

  const handleVertexPointerDown = useCallback(
    (i: number) => (e: ReactPointerEvent) => {
      e.stopPropagation();
      const v = polygon[i];
      // Casilla "Predibujar" activa (o Mayús mantenida al pinchar) en
      // una esquina recta: el clic redondea la esquina con el radio del
      // slider (el vértice se sustituye por los puntos del arco); no
      // se arrastra el vértice.
      if (
        tool === 'edit' &&
        (curvePreview || e.shiftKey) &&
        polygon.length >= 3 &&
        v &&
        !v.hIn &&
        !v.hOut
      ) {
        if (roundCorner(i)) {
          setSelectedVertex(null);
        } else {
          setSelectedVertex(i);
        }
        return;
      }
      // Herramienta Selección: Ctrl alterna, un vértice ya seleccionado
      // con selección múltiple arrastra el grupo entero.
      if (tool === 'select') {
        const press = resolveSelectPress(e, { line: -1, vertex: i });
        if (press === 'toggle') return;
        if (press === 'group') {
          beginGroupDrag(e, { line: -1, vertex: i });
          (e.target as Element).setPointerCapture?.(e.pointerId);
          return;
        }
      }
      pushHistory();
      // Al pinchar un vértice queda marcado (se dibuja en otro color)
      setSelectedVertex(i);
      downPoint.current = { x: polygon[i].x, y: polygon[i].y };
      moved.current = false;
      curveMode.current = false;
      setDragIndex(i);
      isDragging.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      clearHold();
      // Pulsación larga → la esquina pasa a modo curva y salen las dos
      // asas laterales (sobre las propias aristas, sin deformar nada).
      // La curva se crea al mover el ratón: la distancia del ratón al
      // vértice es la graduación (modo espejo), y tras soltar cada asa
      // se arrastra por separado. Si las asas nacieran fuera de las
      // aristas deformarían la figura entera, no solo la esquina.
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        enterCurveMode(i);
      }, HOLD_TO_CURVE_MS);
    },
    [
      tool,
      curvePreview,
      polygon,
      roundCorner,
      resolveSelectPress,
      beginGroupDrag,
      pushHistory,
      clearHold,
      enterCurveMode,
    ]
  );

  /**
   * Vértices de las polilíneas libres: solo interactúan con la
   * herramienta Selección (alternar con Ctrl y arrastrar en grupo o
   * solos).
   */
  const handlePolylineVertexPointerDown = useCallback(
    (li: number, i: number) => (e: ReactPointerEvent) => {
      if (tool !== 'select') return;
      e.stopPropagation();
      const ref: VertexRef = { line: li, vertex: i };
      const press = resolveSelectPress(e, ref);
      if (press === 'toggle') return;
      if (press === 'group') {
        beginGroupDrag(e, ref);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      pushHistory();
      polyVertexDrag.current = ref;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [tool, resolveSelectPress, beginGroupDrag, pushHistory]
  );

  /** Doble clic sobre un vértice de polilínea: lo quita (y si a la
      polilínea le quedan menos de 2 puntos, desaparece entera). */
  const handlePolylineVertexDoubleClick = useCallback(
    (li: number, i: number) => (e: ReactMouseEvent) => {
      if (tool !== 'select') return;
      e.stopPropagation();
      const line = polylinesOrDefault[li];
      if (!line) return;
      pushHistory();
      const points = line.points.filter((_, idx) => idx !== i);
      onPolylinesChange?.(
        points.length >= 2
          ? polylinesOrDefault.map((l, idx) =>
              idx === li ? { ...l, points } : l
            )
          : polylinesOrDefault.filter((_, idx) => idx !== li)
      );
      setSelection((sel) => sel.filter((r) => !sameRef(r, { line: li, vertex: i })));
    },
    [tool, polylinesOrDefault, pushHistory, onPolylinesChange]
  );

  const handleHandlePointerDown = useCallback(
    (vi: number, side: HandleSide) => (e: ReactPointerEvent) => {
      e.stopPropagation();
      pushHistory();
      handleDrag.current = { vi, side };
      isDragging.current = true;
      moved.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [pushHistory]
  );

  const deleteVertex = useCallback(
    (i: number) => {
      pushHistory();
      onChange(polygon.filter((_, idx) => idx !== i));
      setSelection((sel) =>
        sel
          .filter((r) => !(r.line === -1 && r.vertex === i))
          .map((r) =>
            r.line === -1 && r.vertex > i
              ? { ...r, vertex: r.vertex - 1 }
              : r
          )
      );
    },
    [polygon, onChange, pushHistory]
  );

  const handleVertexDoubleClick = useCallback(
    (i: number) => (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (polygon.length > 3) {
        deleteVertex(i);
        setSelectedVertex(null);
      }
    },
    [polygon, deleteVertex]
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [...r, { polygon, polylines: polylinesOrDefault }]);
    setHistory((h) => h.slice(0, -1));
    setSelectedVertex(null);
    setSelection([]);
    setDraft(null);
    setCursorPoint(null);
    onChange(prev.polygon);
    onPolylinesChange?.(prev.polylines);
  }, [history, polygon, polylinesOrDefault, onChange, onPolylinesChange]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((h) => [...h, { polygon, polylines: polylinesOrDefault }]);
    setRedoStack((r) => r.slice(0, -1));
    setSelectedVertex(null);
    setSelection([]);
    setDraft(null);
    setCursorPoint(null);
    onChange(next.polygon);
    onPolylinesChange?.(next.polylines);
  }, [redoStack, polygon, polylinesOrDefault, onChange, onPolylinesChange]);

  /**
   * Reemplaza el polígono por una forma hecha (botones de formas
   * geométricas). Apila el polígono anterior en el historial: se puede
   * deshacer como cualquier otra edición.
   */
  const applyShape = useCallback(
    (shape: Polygon) => {
      pushHistory();
      setSelectedVertex(null);
      onChange(shape);
    },
    [pushHistory, onChange]
  );

  /** Limpia el lienzo: contorno y polilíneas libres. */
  const clear = useCallback(() => {
    pushHistory();
    setSelectedVertex(null);
    setSelection([]);
    setDraft(null);
    setCursorPoint(null);
    onChange([]);
    onPolylinesChange?.([]);
  }, [pushHistory, onChange, onPolylinesChange]);

  /** ¿Está este vértice en la selección de la marquesina? */
  const isSelected = useCallback(
    (ref: VertexRef) => selection.some((r) => sameRef(r, ref)),
    [selection]
  );

  return {
    svgRef,
    dragIndex,
    hoverIndex,
    curveIndex,
    selectedVertex,
    getRoundPreview,
    // Polilíneas libres y herramientas
    draft,
    cursorPoint,
    hoverPolyline,
    marquee,
    selection,
    isSelected,
    setSelection,
    commitDraft,
    cancelDraft,
    lastAddedAt,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerUp,
    },
    vertexHandlers: (i: number) => ({
      onPointerDown: handleVertexPointerDown(i),
      onDoubleClick: handleVertexDoubleClick(i),
    }),
    polylineVertexHandlers: (li: number, i: number) => ({
      onPointerDown: handlePolylineVertexPointerDown(li, i),
      onDoubleClick: handlePolylineVertexDoubleClick(li, i),
    }),
    handleHandlers: (i: number, side: HandleSide) => ({
      onPointerDown: handleHandlePointerDown(i, side),
    }),
    undo,
    redo,
    clear,
    applyShape,
    deleteSelectedVertices,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
  };
}