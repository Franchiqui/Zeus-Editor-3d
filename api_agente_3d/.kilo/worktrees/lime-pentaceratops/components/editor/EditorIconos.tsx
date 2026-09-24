'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import useAppStore, { type Point, type Stroke, type Icon, type Layer } from '@/store/app-store';
import { drawStroke, getTextBounds } from '@/lib/draw-stroke';
import { useI18n } from '@/lib/i18n';
import { useLocalFonts } from '@/lib/useLocalFonts';
import { v4 as uuidv4 } from 'uuid';
import { TabsBar } from '@/components/layout/tabs-bar';
import { registerAddStroke } from '@/lib/editor-bridge';
import { IconReferencePreview } from '@/components/icon-library/icon-reference-preview';
import LayerPanel from '@/components/layer-panel';
import { useIconLibraryContext } from '@/context/icon-library-context';
import { Slider } from '@/components/ui/slider';
import {
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

function snapToGrid(point: Point, gridSize: number): Point {
  const state = useAppStore.getState().getActiveState();
  if (!state.snapEnabled) return point;
  const snappedX = Math.round(point.x / gridSize) * gridSize;
  const snappedY = Math.round(point.y / gridSize) * gridSize;
  const threshold = gridSize * 0.75; // umbral de atracción más fuerte
  const dx = Math.abs(point.x - snappedX);
  const dy = Math.abs(point.y - snappedY);
  return {
    x: dx <= threshold ? snappedX : point.x,
    y: dy <= threshold ? snappedY : point.y,
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, gridSize: number, panX: number, panY: number, zoom: number) {
  const startX = Math.floor(-panX / zoom / gridSize) * gridSize;
  const endX = startX + (width / zoom) + gridSize * 2;
  const startY = Math.floor(-panY / zoom / gridSize) * gridSize;
  const endY = startY + (height / zoom) + gridSize * 2;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;
  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }
  // Draw grid points
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  for (let x = startX; x < endX; x += gridSize) {
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function rotatePoint(p: Point, center: Point, angleDeg: number): Point {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
    y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
  };
}

function computeRoundCorner(prev: Point, vertex: Point, next: Point, radius: number, segments: number): { arc: Point[]; t1: Point; t2: Point } | null {
  const v1x = prev.x - vertex.x;
  const v1y = prev.y - vertex.y;
  const v2x = next.x - vertex.x;
  const v2y = next.y - vertex.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);

  if (len1 < 0.001 || len2 < 0.001) return null;

  const maxRadius = Math.min(len1, len2) * 0.5;
  const r = Math.min(radius, maxRadius);
  if (r < 0.5) return null;

  const u1x = v1x / len1;
  const u1y = v1y / len1;
  const u2x = v2x / len2;
  const u2y = v2y / len2;

  const t1 = { x: vertex.x + u1x * r, y: vertex.y + u1y * r };
  const t2 = { x: vertex.x + u2x * r, y: vertex.y + u2y * r };

  // Intersection of tangent lines at t1 and t2
  const cross = u1x * u2y - u1y * u2x;
  if (Math.abs(cross) < 0.001) return null; // collinear

  const dx = t2.x - t1.x;
  const dy = t2.y - t1.y;
  const s = (dx * u2y - dy * u2x) / cross;
  const cx = t1.x + u1x * s;
  const cy = t1.y + u1y * s;

  // Sample points along quadratic bezier from t1 to t2 with control (cx, cy)
  const arc: Point[] = [];
  const steps = Math.max(1, segments);
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const it = 1 - t;
    const x = it * it * t1.x + 2 * it * t * cx + t * t * t2.x;
    const y = it * it * t1.y + 2 * it * t * cy + t * t * t2.y;
    arc.push({ x, y });
  }
  return { arc, t1, t2 };
}

interface CornerParticipant {
  strokeId: string;
  pointIndex: number;
  neighbor: Point;
  isStart: boolean; // true if vertex is at index 0
  isEnd: boolean; // true if vertex is at last index
}

function findSharedCorner(
  strokes: Stroke[],
  point: Point,
  threshold: number
): { vertex: Point; participants: CornerParticipant[] } | null {
  const WELD = 0.5;
  // Collect all points within threshold
  const hits: { strokeId: string; pointIndex: number; p: Point }[] = [];
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      if (dist < threshold) {
        hits.push({ strokeId: stroke.id, pointIndex: i, p });
      }
    }
  }
  if (hits.length === 0) return null;

  // Group hits by proximity (welded vertices)
  const groups: { center: Point; items: { strokeId: string; pointIndex: number }[] }[] = [];
  for (const hit of hits) {
    let placed = false;
    for (const g of groups) {
      if (Math.abs(g.center.x - hit.p.x) < WELD && Math.abs(g.center.y - hit.p.y) < WELD) {
        g.items.push({ strokeId: hit.strokeId, pointIndex: hit.pointIndex });
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ center: { ...hit.p }, items: [{ strokeId: hit.strokeId, pointIndex: hit.pointIndex }] });
    }
  }

  // Pick the group closest to the click point
  let bestGroup = groups[0];
  let bestDist = Math.hypot(bestGroup.center.x - point.x, bestGroup.center.y - point.y);
  for (let i = 1; i < groups.length; i++) {
    const d = Math.hypot(groups[i].center.x - point.x, groups[i].center.y - point.y);
    if (d < bestDist) {
      bestDist = d;
      bestGroup = groups[i];
    }
  }

  const vertex = bestGroup.center;
  const participants: CornerParticipant[] = [];

  for (const item of bestGroup.items) {
    const stroke = strokes.find(s => s.id === item.strokeId);
    if (!stroke) continue;
    const idx = item.pointIndex;
    const isClosed = stroke.points.length >= 3
      && Math.abs(stroke.points[0].x - stroke.points[stroke.points.length - 1].x) < 0.5
      && Math.abs(stroke.points[0].y - stroke.points[stroke.points.length - 1].y) < 0.5;

    let neighbor: Point | null = null;
    if (stroke.points.length === 2) {
      // Only other point is the neighbor
      neighbor = stroke.points[(idx + 1) % 2];
    } else {
      if (isClosed) {
        if (idx === 0 || idx === stroke.points.length - 1) {
          // Closure point: neighbors are index 1 and index length-2
          // But we need to pick the one that contributes to the angle.
          // For a closed shape, if this is the closure point, we take the "next" point (index 1)
          // and the "prev" point will come from another item if this stroke appears twice.
          // However, for simplicity, we just consider the point before and after in the cycle.
          const prevIdx = idx === 0 ? stroke.points.length - 2 : idx - 1;
          const nextIdx = idx === stroke.points.length - 1 ? 1 : idx + 1;
          // We will add TWO participants for the same stroke if it's a closed shape and the vertex
          // is at both ends. But our hit only found one index. Let's just pick the non-closure neighbor.
          neighbor = stroke.points[1]; // next along the contour
        } else {
          // Interior point
          const prevIdx = idx - 1;
          const nextIdx = idx + 1;
          // We can only use one neighbor per hit. For a single-stroke interior vertex,
          // we need both prev and next. We'll handle this by adding two participants
          // for the same stroke with different neighbors.
          participants.push({
            strokeId: stroke.id,
            pointIndex: idx,
            neighbor: stroke.points[prevIdx],
            isStart: false,
            isEnd: false,
          });
          participants.push({
            strokeId: stroke.id,
            pointIndex: idx,
            neighbor: stroke.points[nextIdx],
            isStart: false,
            isEnd: false,
          });
          continue; // skip the default push below
        }
      } else {
        // Open polyline
        if (idx > 0) {
          participants.push({
            strokeId: stroke.id,
            pointIndex: idx,
            neighbor: stroke.points[idx - 1],
            isStart: false,
            isEnd: idx === stroke.points.length - 1,
          });
        }
        if (idx < stroke.points.length - 1) {
          participants.push({
            strokeId: stroke.id,
            pointIndex: idx,
            neighbor: stroke.points[idx + 1],
            isStart: idx === 0,
            isEnd: false,
          });
        }
        continue; // skip the default push below
      }
    }

    if (neighbor) {
      participants.push({
        strokeId: stroke.id,
        pointIndex: idx,
        neighbor,
        isStart: idx === 0,
        isEnd: idx === stroke.points.length - 1,
      });
    }
  }

  if (participants.length < 2) return null; // Need at least two arms to form a corner
  return { vertex, participants };
}

function hexToRgba(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function getGroupBounds(selectedIds: string[], strokes: Stroke[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasAny = false;
  for (const id of selectedIds) {
    const stroke = strokes.find(st => st.id === id);
    if (!stroke) continue;
    hasAny = true;
    const b = getStrokeBounds(stroke);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!hasAny) return null;
  return { minX, minY, maxX, maxY };
}

function getStrokeBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const p of stroke.points) consider(p);
  if (stroke.holes) for (const hole of stroke.holes) for (const p of hole) consider(p);
  if (stroke.shapeType === 'circle') {
    const [c, rPt] = stroke.points;
    const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
    minX = c.x - r; minY = c.y - r; maxX = c.x + r; maxY = c.y + r;
  }
  if (stroke.shapeType === 'text') {
    const b = getTextBounds(stroke);
    minX = b.minX; minY = b.minY; maxX = b.maxX; maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isStrokeInsidePolygon(stroke: Stroke, polygon: Point[]): boolean {
  return stroke.points.some(p => isPointInPolygon(p, polygon));
}

function toleranceMatch(r1: number, g1: number, b1: number, a1: number,
  r2: number, g2: number, b2: number, a2: number, tol: number) {
  return Math.abs(r1 - r2) <= tol && Math.abs(g1 - g2) <= tol
    && Math.abs(b1 - b2) <= tol && Math.abs(a1 - a2) <= tol;
}

function floodFillTolerant(imageData: ImageData, sx: number, sy: number,
  fr: number, fg: number, fb: number, fa: number, tol: number) {
  const w = imageData.width;
  const h = imageData.height;
  const d = imageData.data;
  const idx = (sy * w + sx) * 4;
  const sr = d[idx], sg = d[idx + 1], sb = d[idx + 2], sa = d[idx + 3];

  const filled = new Uint8Array(w * h);
  
  if (sr === fr && sg === fg && sb === fb && sa === fa) return filled;
  const stack: [number, number][] = [[sx, sy]];

  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    const i = y * w + x;
    if (filled[i]) continue;
    const p = i * 4;
    if (!toleranceMatch(d[p], d[p + 1], d[p + 2], d[p + 3], sr, sg, sb, sa, tol)) continue;

    filled[i] = 1;
    d[p] = fr; d[p + 1] = fg; d[p + 2] = fb; d[p + 3] = fa;

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return filled;
}

function extractContour(filled: Uint8Array, w: number, h: number): Point[] {
  const contour: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!filled[i]) continue;
      const isEdge = (
        x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
        !filled[i + 1] || !filled[i - 1] || !filled[i + w] || !filled[i - w]
      );
      if (isEdge) contour.push({ x, y });
    }
  }
  return contour;
}

function simplifyContour(pts: Point[], step: number): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [];
  // Tomar un punto cada `step` píxeles
  for (let i = 0; i < pts.length; i += step) {
    result.push(pts[i]);
  }
  // Asegurar que el último punto esté cerca del primero para cerrar
  if (result.length > 2 &&
    (Math.abs(result[result.length - 1].x - result[0].x) > step ||
     Math.abs(result[result.length - 1].y - result[0].y) > step)) {
    result.push(result[0]);
  }
  return result;
}

function traceContourBoundary(filled: Uint8Array, w: number, h: number): Point[] {
  // Encontrar primer píxel del contorno
  let startX = -1, startY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y * w + x]) {
        startX = x; startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }
  if (startX === -1) return [];

  const isFilled = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return filled[y * w + x] === 1;
  };

  // 8 vecinos en sentido horario empezando por N
  const dirs = [
    { dx: 0, dy: -1 },  // 0 N
    { dx: 1, dy: -1 },  // 1 NE
    { dx: 1, dy: 0 },   // 2 E
    { dx: 1, dy: 1 },   // 3 SE
    { dx: 0, dy: 1 },   // 4 S
    { dx: -1, dy: 1 },  // 5 SW
    { dx: -1, dy: 0 },  // 6 W
    { dx: -1, dy: -1 }, // 7 NW
  ];

  const contour: Point[] = [];
  let x = startX, y = startY;
  let backtrack = 6; // empezamos como si vinéramos del Oeste (W)

  do {
    contour.push({ x, y });
    let found = false;
    // Explorar vecinos en sentido horario desde backtrack+1
    for (let i = 1; i <= 8; i++) {
      const d = (backtrack + i) % 8;
      const nx = x + dirs[d].dx;
      const ny = y + dirs[d].dy;
      if (isFilled(nx, ny)) {
        backtrack = (d + 4) % 8; // dirección opuesta para la siguiente iteración
        x = nx; y = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
  } while (x !== startX || y !== startY);

  return contour;
}

function simplifyContourOrdered(pts: Point[], step: number): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [];
  for (let i = 0; i < pts.length; i += step) {
    result.push(pts[i]);
  }
  // Asegurar cierre
  if (result.length > 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(last.x - first.x) > 1 || Math.abs(last.y - first.y) > 1) {
      result.push(first);
    }
  }
  return result;
}

function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  const sqEps = epsilon * epsilon;

  function findFarthest(start: number, end: number): { index: number; maxSq: number } {
    let maxSq = 0;
    let index = start;
    const x1 = pts[start].x, y1 = pts[start].y;
    const x2 = pts[end].x, y2 = pts[end].y;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let distSq: number;
      if (lenSq === 0) {
        const a = pts[i].x - x1;
        const b = pts[i].y - y1;
        distSq = a * a + b * b;
      } else {
        const t = ((pts[i].x - x1) * dx + (pts[i].y - y1) * dy) / lenSq;
        const clamped = Math.max(0, Math.min(1, t));
        const projX = x1 + clamped * dx;
        const projY = y1 + clamped * dy;
        const a = pts[i].x - projX;
        const b = pts[i].y - projY;
        distSq = a * a + b * b;
      }
      if (distSq > maxSq) {
        maxSq = distSq;
        index = i;
      }
    }
    return { index, maxSq };
  }

  const stack: [number, number][] = [[0, pts.length - 1]];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const { index, maxSq } = findFarthest(start, end);
    if (maxSq > sqEps) {
      keep[index] = 1;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) result.push(pts[i]);
  }
  return result.length >= 2 ? result : pts.slice(0, 2);
}

function findAllContours(filled: Uint8Array, w: number, h: number): { points: Point[]; type: 'outer' | 'inner' }[] {
  const contours: { points: Point[]; type: 'outer' | 'inner' }[] = [];

  // 1) Contornos exteriores de cada región opaca separada
  const visited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (filled[idx] && !visited[idx]) {
        const region = new Uint8Array(w * h);
        const queue: [number, number][] = [[x, y]];
        visited[idx] = 1;
        region[idx] = 1;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (filled[nidx] && !visited[nidx]) {
                visited[nidx] = 1;
                region[nidx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
        const contour = traceContourBoundary(region, w, h);
        if (contour.length > 2) contours.push({ points: contour, type: 'outer' });
      }
    }
  }

  // 2) Contornos interiores (huecos) – regiones transparentes que no tocan el borde
  const tVisited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!filled[idx] && !tVisited[idx]) {
        const queue: [number, number][] = [[x, y]];
        tVisited[idx] = 1;
        const pixels: [number, number][] = [[x, y]];
        let touchesBorder = false;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) touchesBorder = true;
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (!filled[nidx] && !tVisited[nidx]) {
                tVisited[nidx] = 1;
                queue.push([nx, ny]);
                pixels.push([nx, ny]);
              }
            }
          }
        }
        if (!touchesBorder) {
          const region = new Uint8Array(w * h);
          for (const [px, py] of pixels) region[py * w + px] = 1;
          const contour = traceContourBoundary(region, w, h);
          if (contour.length > 2) contours.push({ points: contour, type: 'inner' });
        }
      }
    }
  }

  return contours;
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { dist: number; t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  }
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const distX = px - projX;
  const distY = py - projY;
  return { dist: Math.sqrt(distX * distX + distY * distY), t };
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += polygon[j].x * polygon[i].y - polygon[i].x * polygon[j].y;
  }
  return Math.abs(area) / 2;
}

function isPointInStroke(point: Point, stroke: Stroke): boolean {
  if (stroke.shapeType === 'text' && stroke.points.length >= 1) {
    const b = getTextBounds(stroke);
    return point.x >= b.minX && point.x <= b.maxX && point.y >= b.minY && point.y <= b.maxY;
  }
  if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
    const [c, rPt] = stroke.points;
    const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
    return Math.hypot(point.x - c.x, point.y - c.y) <= r;
  }
  if (stroke.points.length < 3) return false;
  const insideOuter = pointInPolygon(point, stroke.points);
  if (!insideOuter) return false;
  // If point is inside any hole, it's NOT inside the stroke
  if (stroke.holes) {
    for (const hole of stroke.holes) {
      if (hole.length >= 3 && pointInPolygon(point, hole)) return false;
    }
  }
  return true;
}

function getStrokeCentroid(stroke: Stroke): Point {
  if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
    return stroke.points[0];
  }
  return getCentroid(stroke.points);
}

function getCentroid(pts: Point[]): Point {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function getCircleContour(stroke: Stroke): Point[] {
  if (stroke.shapeType !== 'circle' || stroke.points.length < 2) return [];
  const [c, rPt] = stroke.points;
  const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
  const pts: Point[] = [];
  const SEGMENTS = 32;
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r });
  }
  pts.push({ x: pts[0].x, y: pts[0].y });
  return pts;
}

function getRectangleContour(stroke: Stroke): Point[] {
  if (stroke.shapeType !== 'rectangle') return [];
  if (stroke.points.length >= 4) return stroke.points;
  const [p1, p2] = stroke.points;
  const x1 = Math.min(p1.x, p2.x);
  const y1 = Math.min(p1.y, p2.y);
  const x2 = Math.max(p1.x, p2.x);
  const y2 = Math.max(p1.y, p2.y);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
    { x: x1, y: y1 },
  ];
}

function getStrokeContour(stroke: Stroke): Point[] {
  if (stroke.shapeType === 'circle') return getCircleContour(stroke);
  if (stroke.shapeType === 'rectangle') return getRectangleContour(stroke);
  if (stroke.shapeType === 'text') {
    const b = getTextBounds(stroke);
    return [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
      { x: b.minX, y: b.minY },
    ];
  }
  return stroke.points;
}

// Convierte un trazo de texto en contornos vectoriales editables (un stroke por
// glifo/letra, con sus huecos). Rasteriza el texto a un canvas offscreen, traza
// los contornos con findAllContours y los simplifica con douglas-peucker.
function convertTextStrokeToOutlines(stroke: Stroke): Stroke[] {
  if (stroke.shapeType !== 'text' || !stroke.text || !stroke.points[0]) return [];
  const anchor = stroke.points[0];
  const fontSize = stroke.fontSize ?? 24;
  const fontFamily = stroke.fontFamily ?? 'sans-serif';
  const rotation = stroke.rotation ?? 0;
  const hasInterior = stroke.fillColor && stroke.fillColor !== 'transparent';
  const interiorColor = hasInterior ? stroke.fillColor : stroke.strokeColor;
  const borderColor = stroke.strokeColor;
  const borderWidth = stroke.strokeWidth ?? 0;

  const SUPERSAMPLE = 4;
  const lineHeight = fontSize * 1.2;
  const lines = stroke.text.split('\n');
  const totalHeight = lines.length * lineHeight;

  // Medir ancho real del texto
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) return [];
  mctx.font = `${fontSize}px ${fontFamily}`;
  let actualWidth = 1;
  for (const line of lines) {
    const w = mctx.measureText(line || ' ').width;
    if (w > actualWidth) actualWidth = w;
  }

  const pad = Math.ceil(fontSize * 0.5);
  const W = Math.ceil((actualWidth + pad * 2) * SUPERSAMPLE);
  const H = Math.ceil((totalHeight + pad * 2) * SUPERSAMPLE);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d');
  if (!octx) return [];
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, W, H);
  octx.fillStyle = '#000000';
  octx.font = `${fontSize * SUPERSAMPLE}px ${fontFamily}`;
  octx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    octx.fillText(lines[i] || ' ', pad * SUPERSAMPLE, (pad + i * lineHeight) * SUPERSAMPLE);
  }

  const img = octx.getImageData(0, 0, W, H);
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < filled.length; i++) {
    // píxel "tinta" = oscuro (la letra se dibujó en negro sobre blanco)
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    filled[i] = r + g + b < 384 ? 1 : 0;
  }

  const allContours = findAllContours(filled, W, H);

  // Centro del texto (para rotación sobre sí mismo), en coords mundo.
  // Usamos getTextBounds para coincidir exactamente con el centro del render en vivo.
  const tb = getTextBounds(stroke);
  const centerX = (tb.minX + tb.maxX) / 2;
  const centerY = (tb.minY + tb.maxY) / 2;

  const toWorld = (px: number, py: number): Point => {
    const wx = anchor.x + (px / SUPERSAMPLE) - pad;
    const wy = anchor.y + (py / SUPERSAMPLE) - pad;
    if (rotation === 0) return { x: wx, y: wy };
    return rotatePoint({ x: wx, y: wy }, { x: centerX, y: centerY }, rotation);
  };

  const outers = allContours.filter(c => c.type === 'outer' && c.points.length >= 3);
  const inners = allContours.filter(c => c.type === 'inner' && c.points.length >= 3);
  const EPS = 0.6; // world units

  const result: Stroke[] = [];
  for (const outer of outers) {
    const simplifiedOuter = douglasPeucker(outer.points, EPS * SUPERSAMPLE);
    if (simplifiedOuter.length < 3) continue;
    const outerWorld = simplifiedOuter.map(p => toWorld(p.x, p.y));
    // Cerrar el contorno
    const first = outerWorld[0];
    const last = outerWorld[outerWorld.length - 1];
    if (Math.abs(last.x - first.x) > 0.5 || Math.abs(last.y - first.y) > 0.5) {
      outerWorld.push({ x: first.x, y: first.y });
    }

    const holes: Point[][] = [];
    for (const inner of inners) {
      const testPx = inner.points[Math.floor(inner.points.length / 2)];
      if (!pointInPolygon(testPx, outer.points)) continue;
      const simplifiedHole = douglasPeucker(inner.points, EPS * SUPERSAMPLE);
      if (simplifiedHole.length < 3) continue;
      const holeWorld = simplifiedHole.map(p => toWorld(p.x, p.y));
      const hf = holeWorld[0];
      const hl = holeWorld[holeWorld.length - 1];
      if (Math.abs(hl.x - hf.x) > 0.5 || Math.abs(hl.y - hf.y) > 0.5) {
        holeWorld.push({ x: hf.x, y: hf.y });
      }
      holes.push(holeWorld);
    }

    result.push({
      id: uuidv4(),
      points: outerWorld,
      fillColor: interiorColor,
      strokeColor: borderWidth > 0 ? borderColor : 'transparent',
      strokeWidth: borderWidth,
      type: 'line',
      holes: holes.length > 0 ? holes : undefined,
    });
  }
  return result;
}

function isStrokeFullyInside(inner: Stroke, outer: Stroke): boolean {
  const contour = getStrokeContour(inner);
  if (contour.length === 0) return false;
  return contour.every(p => isPointInStroke(p, outer));
}

function drawGates(ctx: CanvasRenderingContext2D, points: Point[], strokeColor: string) {
  if (points.length < 1) return;

  const first = points[0];
  const last = points[points.length - 1];

  const GATE_R = 2.5;

  // Primer vértice — puerta blanca con borde del color del trazo
  ctx.beginPath();
  ctx.arc(first.x, first.y, GATE_R, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (points.length > 1) {
    // Último vértice — puerta del color del trazo con borde blanco
    ctx.beginPath();
    ctx.arc(last.x, last.y, GATE_R, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export default function Home() {
  const store = useAppStore();
  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const { t } = useI18n();
  const { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace } = useLocalFonts();
  const activeTab = store.tabs.find(t => t.id === store.activeTabId);
  const currentIcon = activeTab?.icon ?? null;
  const iconLibraryContext = useIconLibraryContext();
  const customLibraries = iconLibraryContext?.customLibraries ?? [];
  const saveIconToLibrary = iconLibraryContext?.saveIconToLibrary ?? (() => {});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerHRef = useRef<HTMLCanvasElement>(null);
  const rulerVRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [mouseRulerPos, setMouseRulerPos] = useState({ x: -100, y: -100 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectionRect, setSelectionRect] = useState<{ start: Point; end: Point } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [isLassoing, setIsLassoing] = useState(false);
  interface SelectedVertex {
    strokeId: string;
    pointIndex: number;
  }
  const [selectedVertices, setSelectedVertices] = useState<SelectedVertex[]>([]);
  const selectedVerticesRef = useRef<SelectedVertex[]>([]);
  useEffect(() => {
    selectedVerticesRef.current = selectedVertices;
  }, [selectedVertices]);

  // Registrar callback para que el modal de iconos pueda insertar strokes
  useEffect(() => {
    registerAddStroke((strokeOrStrokes: unknown) => {
      const s = useAppStore.getState();
      const arr = Array.isArray(strokeOrStrokes) ? strokeOrStrokes : [strokeOrStrokes];
      arr.forEach((stroke) => s.addStroke(stroke as Stroke));
    });
    return () => {
      registerAddStroke(() => {});
    };
  }, []);

  const selectedStrokes = activeTab?.selectedStrokes ?? [];
  const allStrokes = currentIcon?.layers.flatMap(l => l.strokes) ?? [];
  const selectedTextStroke =
    selectedStrokes.length === 1
      ? allStrokes.find(s => s.id === selectedStrokes[0] && s.shapeType === 'text')
      : undefined;

  function isStrokeLocked(strokeId: string): boolean {
    const icon = store.getActiveIcon();
    if (!icon) return false;
    const layer = icon.layers.find(l => l.strokes.some(s => s.id === strokeId));
    return layer?.locked ?? false;
  }

  const zoom = activeTab?.zoom ?? 1;
  const panX = activeTab?.panX ?? 0;
  const panY = activeTab?.panY ?? 0;
  const currentStroke = activeTab?.currentStroke ?? [];
  const historyPast = activeTab?.historyPast ?? [];
  const historyFuture = activeTab?.historyFuture ?? [];
  const isDrawing = activeTab?.isDrawing ?? false;
  const templateImage = activeTab?.templateImage ?? null;
  const templateOpacity = activeTab?.templateOpacity ?? 0.5;
  const templateScale = activeTab?.templateScale ?? 1;
  const templateOffsetX = activeTab?.templateOffsetX ?? 0;
  const templateOffsetY = activeTab?.templateOffsetY ?? 0;
  const tool = store.tool;
  const cornerRadius = store.cornerRadius;
  const cornerSegments = store.cornerSegments;
  const gridSize = store.gridSize;
  const strokeColor = store.strokeColor;
  const strokeWidth = store.strokeWidth;
  const fillColor = store.fillColor;
  const fillHistory = store.fillHistory;
  const strokeHistory = store.strokeHistory;
  const snapEnabled = store.snapEnabled;
  const clipboard = store.clipboard;
  const icons = store.icons;
  const [iconTitle, setIconTitle] = useState('');
  const [iconDescription, setIconDescription] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [textDialog, setTextDialog] = useState<{
    open: boolean;
    point: Point;
    value: string;
    size: number;
    family: string;
    strokeId?: string;
  } | null>(null);
  const [showSaveToLibraryDialog, setShowSaveToLibraryDialog] = useState(false);
  const [saveToLibraryName, setSaveToLibraryName] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [templateReady, setTemplateReady] = useState(0);
  const [importDetailLevel, setImportDetailLevel] = useState(50);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const templateImageRef = useRef<HTMLImageElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAddPosRef = useRef({ clientX: 0, clientY: 0 });
  const curveStateRef = useRef<
    | { phase: 'idle' }
    | { phase: 'p1'; p1: Point }
    | { phase: 'p2'; p1: Point; p2: Point }
  >({ phase: 'idle' });
  const vertexDragRef = useRef<{
    active: boolean;
    originalPoint: Point;
    affectedStrokeIds: string[];
    selectedVertices?: SelectedVertex[];
    originalPositions?: Map<string, Point>; // clave "strokeId-pointIndex"
    pointKeys?: Set<string>; // strokeId-index de todos los puntos a mover
    mode?: 'single' | 'multi';
  } | null>(null);
  const smoothStateRef = useRef<{
    active: boolean;
    strokeId: string;
    segmentIdx: number; // índice del punto de inicio del segmento
    start: Point;
    end: Point;
    control: Point;
  } | null>(null);
  const bezierDragRef = useRef<{
    active: boolean;
    strokeId: string;
    controlIndex: number; // index of control point in stroke.points
  } | null>(null);
  const handDragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    originalStrokes: Map<string, { points: Point[]; holes?: Point[][] }>;
  } | null>(null);
  const shapeDragRef = useRef<{
    active: boolean;
    origin: Point;
    tool: 'circle' | 'rectangle';
  } | null>(null);
  const roundCornerHoverRef = useRef<{
    strokeId: string;
    pointIndex: number;
    previewPoints: Point[];
    vertex: Point;
  } | null>(null);
  const resizeHandleRef = useRef<{
    active: boolean;
    strokeIds: string[];
    mode: 'resize' | 'rotate';
    corner?: 'tl' | 'tr' | 'bl' | 'br';
    startBounds: { minX: number; minY: number; maxX: number; maxY: number };
    lastMouse: Point;
    center: Point;
    startAngle: number;
  } | null>(null);

  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const s = useAppStore.getState().getActiveState();
    return {
      x: (clientX - rect.left - s.panX) / s.zoom,
      y: (clientY - rect.top - s.panY) / s.zoom,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const point = getCanvasPoint(e.clientX, e.clientY);
    const s = useAppStore.getState().getActiveState();

    if (s.tool === 'hand') {
      if (s.selectedStrokes.length > 0) {
        s.pushHistory();
        const originals = new Map<string, { points: Point[]; holes?: Point[][] }>();
        for (const id of s.selectedStrokes) {
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
          if (!stroke) continue;
          originals.set(id, {
            points: stroke.points.map(p => ({ ...p })),
            holes: stroke.holes ? stroke.holes.map(h => h.map(p => ({ ...p }))) : undefined,
          });
        }
        handDragRef.current = {
          active: true,
          startClientX: e.clientX,
          startClientY: e.clientY,
          originalStrokes: originals,
        };
      } else {
        setIsPanning(true);
        setPanStart({ x: e.clientX - s.panX, y: e.clientY - s.panY });
      }
      return;
    }

    if (s.tool === 'select') {
      // Comprobar si se hace click en un handle de resize/rotate de la selección completa
      if (s.selectedStrokes.length > 0) {
        const groupBounds = s.selectedStrokes.reduce((acc, id) => {
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
          if (!stroke) return acc;
          const b = getStrokeBounds(stroke);
          return {
            minX: Math.min(acc.minX, b.minX),
            minY: Math.min(acc.minY, b.minY),
            maxX: Math.max(acc.maxX, b.maxX),
            maxY: Math.max(acc.maxY, b.maxY),
          };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const HANDLE_SIZE = 10 / s.zoom;
        const center = { x: (groupBounds.minX + groupBounds.maxX) / 2, y: (groupBounds.minY + groupBounds.maxY) / 2 };
        // Handle de rotación (arriba del centro) — área de detección más grande
        const rotHandle = { x: center.x, y: groupBounds.minY - 24 };
        const ROT_HIT = 16 / s.zoom;
        if (Math.abs(point.x - rotHandle.x) <= ROT_HIT && Math.abs(point.y - rotHandle.y) <= ROT_HIT) {
          s.pushHistory();
          resizeHandleRef.current = {
            active: true,
            strokeIds: [...s.selectedStrokes],
            mode: 'rotate',
            startBounds: { ...groupBounds },
            lastMouse: point,
            center,
            startAngle: Math.atan2(point.y - center.y, point.x - center.x),
          };
          return;
        }
        const corners: { x: number; y: number; corner: 'tl' | 'tr' | 'bl' | 'br' }[] = [
          { x: groupBounds.minX, y: groupBounds.minY, corner: 'tl' },
          { x: groupBounds.maxX, y: groupBounds.minY, corner: 'tr' },
          { x: groupBounds.minX, y: groupBounds.maxY, corner: 'bl' },
          { x: groupBounds.maxX, y: groupBounds.maxY, corner: 'br' },
        ];
        for (const c of corners) {
          if (Math.abs(point.x - c.x) <= HANDLE_SIZE && Math.abs(point.y - c.y) <= HANDLE_SIZE) {
            // Ctrl+click en esquina del bounding box => resize individual de SOLO el stroke cuyo vertice esta en esa esquina
            if (e.ctrlKey || e.metaKey) {
              const VERTEX_SNAP = 40 / s.zoom;
              let bestStrokeId: string | null = null;
              let bestDist = Infinity;
              for (const strokeId of s.selectedStrokes) {
                const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === strokeId);
                if (!stroke || isStrokeLocked(stroke.id)) continue;
                const b = getStrokeBounds(stroke);
                let dist = Infinity;
                if (c.corner === 'tl') dist = Math.hypot(b.minX - c.x, b.minY - c.y);
                else if (c.corner === 'tr') dist = Math.hypot(b.maxX - c.x, b.minY - c.y);
                else if (c.corner === 'bl') dist = Math.hypot(b.minX - c.x, b.maxY - c.y);
                else if (c.corner === 'br') dist = Math.hypot(b.maxX - c.x, b.maxY - c.y);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestStrokeId = stroke.id;
                }
              }
              if (bestStrokeId !== null && bestDist <= VERTEX_SNAP) {
                const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === bestStrokeId);
                if (stroke) {
                  s.pushHistory();
                  const b = getStrokeBounds(stroke);
                  const sCenter = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
                  resizeHandleRef.current = {
                    active: true,
                    strokeIds: [bestStrokeId],
                    mode: 'resize',
                    corner: c.corner,
                    startBounds: { ...b },
                    lastMouse: point,
                    center: sCenter,
                    startAngle: 0,
                  };
                  return;
                }
              }
            }
            s.pushHistory();
            resizeHandleRef.current = {
              active: true,
              strokeIds: [...s.selectedStrokes],
              mode: 'resize',
              corner: c.corner,
              startBounds: { ...groupBounds },
              lastMouse: point,
              center,
              startAngle: 0,
            };
            return;
          }
        }
      }

      // Shift/Ctrl+click para seleccionar/desseleccionar un stroke directamente
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const THRESHOLD = 8 / s.zoom;
        const candidates = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).filter(stroke => {
          if (isStrokeLocked(stroke.id)) return false;
          if (isPointInStroke(point, stroke)) return true;
          if (stroke.points.length >= 2) {
            for (let i = 0; i < stroke.points.length - 1; i++) {
              const { dist } = pointToSegmentDistance(
                point.x, point.y,
                stroke.points[i].x, stroke.points[i].y,
                stroke.points[i + 1].x, stroke.points[i + 1].y
              );
              if (dist <= THRESHOLD) return true;
            }
          }
          return false;
        });

        if (candidates.length > 0) {
          const clickedStroke = candidates.sort((a, b) => {
            const areaA = polygonArea(getStrokeContour(a));
            const areaB = polygonArea(getStrokeContour(b));
            return areaA - areaB;
          })[0];

          const alreadySelected = s.selectedStrokes.includes(clickedStroke.id);
          if (alreadySelected) {
            s.setSelectedStrokes(s.selectedStrokes.filter(id => id !== clickedStroke.id));
          } else {
            s.setSelectedStrokes([...s.selectedStrokes, clickedStroke.id]);
          }
        } else {
          s.setSelectedStrokes([]);
        }
        return;
      }

      setIsSelecting(true);
      setSelectionRect({ start: point, end: point });
      return;
    }

    if (s.tool === 'lasso') {
      s.pushHistory();
      setIsLassoing(true);
      setLassoPath([point]);
      return;
    }

    if (s.tool === 'eraser') {
      // Find stroke under cursor and delete it
      const strokeToDelete = s.currentIcon?.layers.flatMap(l => l.strokes).find(s2 => {
        if (isStrokeLocked(s2.id)) return false;
        return s2.points.some(p =>
          Math.abs(p.x - point.x) < 10 && Math.abs(p.y - point.y) < 10
        );
      });
      if (strokeToDelete) {
        s.removeStroke(strokeToDelete.id);
      }
      return;
    }

    if (s.tool === 'extract') {
      const enclosingStroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(stroke => {
        return !isStrokeLocked(stroke.id) && isPointInStroke(point, stroke);
      });
      if (enclosingStroke) {
        s.extractStrokes(enclosingStroke.id);
      }
      return;
    }

    if (s.tool === 'fill' || s.tool === 'fill-solid') {
      // 1) Si el click está dentro de un stroke cerrado existente, rellenar ese stroke directamente
      // Elegir el stroke MÁS PEQUEÑO que contenga el punto (para que un círculo interior
      // tenga prioridad sobre uno exterior cuando se hace clic en el centro).
      const enclosingCandidates = s.currentIcon?.layers.flatMap(l => l.strokes).filter(stroke =>
        !isStrokeLocked(stroke.id) && isPointInStroke(point, stroke)
      ) || [];
      if (enclosingCandidates.length > 0) {
        // Ordenar por área ascendente: el más pequeño primero
        const enclosingStroke = enclosingCandidates.sort((a, b) => {
          const areaA = polygonArea(getStrokeContour(a));
          const areaB = polygonArea(getStrokeContour(b));
          return areaA - areaB;
        })[0];

        const contained = s.currentIcon?.layers.flatMap(l => l.strokes).filter(other => {
          if (other.id === enclosingStroke.id) return false;
          if (isStrokeLocked(other.id)) return false;
          return isStrokeFullyInside(other, enclosingStroke);
        }) || [];
        const newHoles = contained.map(st => getStrokeContour(st)).filter(h => h.length >= 3);
        // Preservar los huecos originales del stroke (importante para iconos importados)
        const existingHoles = enclosingStroke.holes || [];
        const mergedHoles = [...existingHoles, ...newHoles];
        s.updateStroke(enclosingStroke.id, {
          fillColor: s.fillColor,
          holes: mergedHoles.length > 0 ? mergedHoles : undefined,
        });
        s.addFillHistory(s.fillColor);
        return;
      }

      // 2) Si no, proceder con flood fill por píxeles (áreas abiertas o entre strokes)
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext('2d')!;

      octx.save();
      octx.translate(s.panX, s.panY);
      octx.scale(s.zoom, s.zoom);

      s.currentIcon?.layers.flatMap(l => l.strokes).forEach(stroke => {
        if (stroke.points.length < 2) return;

        // Helper: trazar un sub-path (sin beginPath, para poder combinar varios en un mismo path)
        const traceSubPath = (pts: Point[], close: boolean) => {
          if (pts.length < 2) return;
          octx.moveTo(pts[0].x, pts[0].y);
          if (stroke.type === 'curve' && pts.length === 3) {
            octx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
          } else {
            for (let i = 1; i < pts.length; i++) {
              octx.lineTo(pts[i].x, pts[i].y);
            }
          }
          if (close) octx.closePath();
        };

        // Círculos: rellenar el área completa para bloquear el flood fill en el borde exterior
        if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
          const [c, rPt] = stroke.points;
          const radius = Math.hypot(rPt.x - c.x, rPt.y - c.y);
          octx.beginPath();
          octx.arc(c.x, c.y, radius, 0, Math.PI * 2);
          octx.fillStyle = '#ffffff';
          octx.fill();
          // Dibujar también un borde grueso para compensar antialiasing
          octx.strokeStyle = '#ffffff';
          octx.lineWidth = 3;
          octx.stroke();
          return;
        }

        // Rectángulos: rellenar el área completa
        if (stroke.shapeType === 'rectangle') {
          const pts = stroke.points.length >= 4 ? stroke.points : (() => {
            const [p1, p2] = stroke.points;
            const x1 = Math.min(p1.x, p2.x);
            const y1 = Math.min(p1.y, p2.y);
            const x2 = Math.max(p1.x, p2.x);
            const y2 = Math.max(p1.y, p2.y);
            return [
              { x: x1, y: y1 }, { x: x2, y: y1 },
              { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 },
            ];
          })();
          octx.beginPath();
          octx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
          octx.closePath();
          octx.fillStyle = '#ffffff';
          octx.fill();
          octx.strokeStyle = '#ffffff';
          octx.lineWidth = 3;
          octx.stroke();
          return;
        }

        // Paths con fill: cualquier stroke rellenado es una barrera sólida
        // para el flood fill, aunque sus puntos no coincidan exactamente.
        const hasFill = stroke.fillColor !== 'transparent';
        const canBeFilled = stroke.points.length >= 3;

        if (hasFill && canBeFilled) {
          octx.beginPath();
          traceSubPath(stroke.points, true);
          if (stroke.holes && stroke.holes.length > 0) {
            for (const hole of stroke.holes) {
              if (hole.length >= 2) {
                traceSubPath(hole, true);
              }
            }
            octx.fillStyle = '#ffffff';
            octx.fill('evenodd');
          } else {
            octx.fillStyle = '#ffffff';
            octx.fill();
          }
          // Borde muy grueso para compensar antialiasing y asegurar barrera completa
          octx.strokeStyle = '#ffffff';
          octx.lineWidth = 6;
          octx.lineCap = 'round';
          octx.lineJoin = 'round';
          octx.stroke();
        } else {
          // Paths sin fill: dibujar borde grueso como barrera
          const isClosed = stroke.points.length >= 3 &&
            Math.abs(stroke.points[0].x - stroke.points[stroke.points.length - 1].x) < 0.5 &&
            Math.abs(stroke.points[0].y - stroke.points[stroke.points.length - 1].y) < 0.5;
          octx.beginPath();
          traceSubPath(stroke.points, isClosed);
          octx.strokeStyle = '#ffffff';
          octx.lineWidth = Math.max(stroke.strokeWidth, 6);
          octx.lineCap = 'round';
          octx.lineJoin = 'round';
          octx.stroke();
          if (stroke.holes) {
            for (const hole of stroke.holes) {
              if (hole.length < 2) continue;
              const holeClosed = hole.length >= 3 &&
                Math.abs(hole[0].x - hole[hole.length - 1].x) < 0.5 &&
                Math.abs(hole[0].y - hole[hole.length - 1].y) < 0.5;
              octx.beginPath();
              traceSubPath(hole, holeClosed);
              octx.strokeStyle = '#ffffff';
              octx.lineWidth = Math.max(stroke.strokeWidth, 6);
              octx.lineCap = 'round';
              octx.lineJoin = 'round';
              octx.stroke();
            }
          }
        }
      });
      octx.restore();

      const rect = canvas.getBoundingClientRect();
      const canvasX = Math.round(e.clientX - rect.left);
      const canvasY = Math.round(e.clientY - rect.top);
      if (canvasX < 0 || canvasX >= off.width || canvasY < 0 || canvasY >= off.height) return;

      const imageData = octx.getImageData(0, 0, off.width, off.height);
      const { r, g, b } = hexToRgba(s.fillColor);
      const filled = floodFillTolerant(imageData, canvasX, canvasY, r, g, b, 255, 30);

      if (filled.length > 0) {
        // Use findAllContours to get both outer boundary and inner holes from the filled pixels
        const allContours = findAllContours(filled, off.width, off.height);
        const w = off.width;
        const h = off.height;

        // Convert screen pixel coords back to world coords
        const toWorld = (p: Point) => ({ x: (p.x - s.panX) / s.zoom, y: (p.y - s.panY) / s.zoom });
        const screenPoint = { x: canvasX, y: canvasY };

        // Find the outer contour that contains the click point (smallest area that contains it)
        let bestOuter: { points: Point[]; type: 'outer' | 'inner' } | null = null;
        let bestArea = Infinity;
        for (const c of allContours) {
          if (c.type !== 'outer') continue;
          if (!pointInPolygon(screenPoint, c.points)) continue;
          let area = 0;
          for (let i = 0; i < c.points.length; i++) {
            const j = (i + 1) % c.points.length;
            area += c.points[i].x * c.points[j].y - c.points[j].x * c.points[i].y;
          }
          area = Math.abs(area);
          if (area < bestArea) {
            bestArea = area;
            bestOuter = c;
          }
        }

        if (bestOuter && bestOuter.points.length >= 3) {
          const step = s.tool === 'fill-solid' ? 4 : 2;
          const simplifiedOuter = simplifyContourOrdered(bestOuter.points, step);
          const drawingContour = simplifiedOuter.map(toWorld);

          // Find inner contours that are inside this outer contour
          const holes: Point[][] = [];
          for (const c of allContours) {
            if (c.type !== 'inner') continue;
            if (c.points.length < 3) continue;
            // Check if this inner contour is inside the outer contour
            const testPt = c.points[Math.floor(c.points.length / 2)];
            if (pointInPolygon(testPt, bestOuter.points)) {
              const simplifiedHole = simplifyContourOrdered(c.points, step);
              holes.push(simplifiedHole.map(toWorld));
            }
          }

          const newStroke: Stroke = {
            id: uuidv4(),
            points: drawingContour,
            fillColor: s.fillColor,
            strokeColor: 'transparent',
            strokeWidth: 0,
            type: 'line',
            holes: holes.length > 0 ? holes : undefined,
          };
          s.addStroke(newStroke);
          s.addFillHistory(s.fillColor);
        }
      }
      return;
    }

    if (s.tool === 'vertex') {
      // Si se hace clic sobre un texto, convertirlo a contornos editables
      // (vértices de las letras) y salir para que el siguiente clic edite vértices.
      const hitText = (s.currentIcon?.layers.flatMap(l => l.strokes) || [])
        .filter(st => st.shapeType === 'text' && !isStrokeLocked(st.id) && isPointInStroke(point, st))
        .sort((a, b) => polygonArea(getStrokeContour(a)) - polygonArea(getStrokeContour(b)))[0];
      if (hitText) {
        const outlines = convertTextStrokeToOutlines(hitText);
        if (outlines.length > 0) {
          s.replaceStrokeWith(hitText.id, outlines);
        }
        return;
      }

      const THRESHOLD = 10 / s.zoom;
      let foundVertex: Point | null = null;
      let foundStrokeId: string | null = null;
      let foundPointIndex = -1;
      const affectedIds: string[] = [];

      // 1. Buscar vértice existente cercano
      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (isStrokeLocked(stroke.id)) continue;
        for (let i = 0; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          const dx = p.x - point.x;
          const dy = p.y - point.y;
          if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) {
            if (!foundVertex) {
              foundVertex = p;
              foundStrokeId = stroke.id;
              foundPointIndex = i;
            }
            affectedIds.push(stroke.id);
          }
        }
      }

      // Tecla modificadora => toggle selección de vértice (sin drag)
      if (e.shiftKey || e.ctrlKey || e.altKey) {
        if (foundVertex && foundStrokeId) {
          const exists = selectedVerticesRef.current.some(
            sv => sv.strokeId === foundStrokeId && sv.pointIndex === foundPointIndex
          );
          if (exists) {
            setSelectedVertices(prev =>
              prev.filter(sv => !(sv.strokeId === foundStrokeId && sv.pointIndex === foundPointIndex))
            );
          } else {
            setSelectedVertices(prev => [...prev, { strokeId: foundStrokeId, pointIndex: foundPointIndex }]);
          }
        }
        return;
      }

      if (foundVertex) {
        const isSelected = selectedVerticesRef.current.some(
          sv => sv.strokeId === foundStrokeId && sv.pointIndex === foundPointIndex
        );
        s.pushHistory();
        if (isSelected) {
          // Arrastrar todo el grupo de vértices seleccionados
          const selectedOrigins: Point[] = [];
          for (const sv of selectedVerticesRef.current) {
            const st = s.currentIcon?.layers.flatMap(l => l.strokes).find(stroke => stroke.id === sv.strokeId);
            if (st && sv.pointIndex < st.points.length) {
              selectedOrigins.push({ ...st.points[sv.pointIndex] });
            }
          }
          const originalPositions = new Map<string, Point>();
          const pointKeys = new Set<string>();
          // Encontrar TODOS los puntos (incluidos compartidos) que coincidan con posiciones seleccionadas
          for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
            for (let i = 0; i < stroke.points.length; i++) {
              for (const orig of selectedOrigins) {
                if (Math.abs(stroke.points[i].x - orig.x) < 0.5 && Math.abs(stroke.points[i].y - orig.y) < 0.5) {
                  const key = `${stroke.id}:${i}`;
                  pointKeys.add(key);
                  originalPositions.set(key, { ...stroke.points[i] });
                  break;
                }
              }
            }
          }
          vertexDragRef.current = {
            active: true,
            originalPoint: { ...foundVertex },
            affectedStrokeIds: affectedIds,
            selectedVertices: [...selectedVerticesRef.current],
            originalPositions,
            pointKeys,
          };
        } else {
          // Arrastre individual: limpiar selección de vértices
          setSelectedVertices([]);
          vertexDragRef.current = {
            active: true,
            originalPoint: { ...foundVertex },
            affectedStrokeIds: affectedIds,
          };
        }
        return;
      }

      // 2. Buscar segmento de línea cercano para insertar vértice
      let closestStrokeId: string | null = null;
      let closestInsertIdx = -1;
      let closestPoint: Point | null = null;
      let minDist = Infinity;

      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (stroke.points.length < 2) continue;
        for (let i = 0; i < stroke.points.length - 1; i++) {
          const p1 = stroke.points[i];
          const p2 = stroke.points[i + 1];
          const { dist, t } = pointToSegmentDistance(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
          if (dist < THRESHOLD && dist < minDist) {
            minDist = dist;
            closestStrokeId = stroke.id;
            closestInsertIdx = i + 1;
            closestPoint = {
              x: p1.x + t * (p2.x - p1.x),
              y: p1.y + t * (p2.y - p1.y),
            };
          }
        }
      }

      if (closestStrokeId && closestPoint) {
        const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === closestStrokeId);
        if (stroke) {
          const newPoints = [...stroke.points];
          newPoints.splice(closestInsertIdx, 0, closestPoint);
          s.updateStroke(closestStrokeId, { points: newPoints });
          vertexDragRef.current = {
            active: true,
            originalPoint: { ...closestPoint },
            affectedStrokeIds: [closestStrokeId],
          };
        }
        return;
      }

      // 3. Ningún vértice ni segmento cercano: crear vértice suelto
      const snapped = snapToGrid(point, s.gridSize);
      const newStroke: Stroke = {
        id: uuidv4(),
        points: [snapped],
        fillColor: 'transparent',
        strokeColor: s.strokeColor,
        strokeWidth: s.strokeWidth,
        type: 'line',
      };
      s.addStroke(newStroke);
      return;
    }

    if (s.tool === 'delete-vertex') {
      const THRESHOLD = 10 / s.zoom;
      let foundVertex: Point | null = null;
      const affectedStrokes: { stroke: Stroke; pointIndex: number }[] = [];

      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (isStrokeLocked(stroke.id)) continue;
        for (let i = 0; i < stroke.points.length; i++) {
          const p = stroke.points[i];
          const dx = p.x - point.x;
          const dy = p.y - point.y;
          if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) {
            foundVertex = p;
            affectedStrokes.push({ stroke, pointIndex: i });
          }
        }
      }

      if (foundVertex) {
        // Separar strokes con 2 puntos de los con >2 puntos
        const longStrokes = affectedStrokes.filter(a => a.stroke.points.length > 2);
        const edgeStrokes = affectedStrokes.filter(a => a.stroke.points.length === 2);

        // Para strokes largos: solo quitar el punto
        for (const { stroke, pointIndex } of longStrokes) {
          const newPoints = stroke.points.filter((_, i) => i !== pointIndex);
          if (newPoints.length === 0) {
            s.removeStroke(stroke.id);
          } else {
            s.updateStroke(stroke.id, { points: newPoints });
          }
        }

        // Para strokes de borde (2 puntos): fusionar pares que comparten el vértice
        const removedIds = new Set<string>();
        for (let i = 0; i < edgeStrokes.length; i++) {
          if (removedIds.has(edgeStrokes[i].stroke.id)) continue;
          const s1 = edgeStrokes[i];
          const other1 = s1.stroke.points[(s1.pointIndex + 1) % 2];

          // Buscar otro stroke de borde que comparta el vértice
          for (let j = i + 1; j < edgeStrokes.length; j++) {
            if (removedIds.has(edgeStrokes[j].stroke.id)) continue;
            const s2 = edgeStrokes[j];
            const other2 = s2.stroke.points[(s2.pointIndex + 1) % 2];

            // Fusionar: other1 -> other2
            const newStroke: Stroke = {
              id: uuidv4(),
              points: [other1, other2],
              fillColor: 'transparent',
              strokeColor: s1.stroke.strokeColor,
              strokeWidth: s1.stroke.strokeWidth,
              type: 'line',
            };
            s.addStroke(newStroke);
            s.removeStroke(s1.stroke.id);
            s.removeStroke(s2.stroke.id);
            removedIds.add(s1.stroke.id);
            removedIds.add(s2.stroke.id);
            break;
          }

          // Si no encontró pareja, simplemente eliminar el stroke
          if (!removedIds.has(s1.stroke.id)) {
            s.removeStroke(s1.stroke.id);
            removedIds.add(s1.stroke.id);
          }
        }
      }
      return;
    }

    if (s.tool === 'delete-segment') {
      const THRESHOLD = 10 / s.zoom;
      let closestStrokeId: string | null = null;
      let closestSegmentIdx = -1;
      let minDist = Infinity;

      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (stroke.points.length < 2) continue;
        if (isStrokeLocked(stroke.id)) continue;
        for (let i = 0; i < stroke.points.length - 1; i++) {
          const p1 = stroke.points[i];
          const p2 = stroke.points[i + 1];
          const { dist } = pointToSegmentDistance(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
          if (dist < THRESHOLD && dist < minDist) {
            minDist = dist;
            closestStrokeId = stroke.id;
            closestSegmentIdx = i;
          }
        }
      }

      if (closestStrokeId && closestSegmentIdx >= 0) {
        const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === closestStrokeId);
        if (stroke) {
          const pts = stroke.points;
          const i = closestSegmentIdx;
          let newStrokes: Stroke[] = [];

          if (pts.length <= 2) {
            // Eliminar stroke completo
            newStrokes = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).filter(st => st.id !== stroke.id);
          } else if (i === 0) {
            // Acortar por el principio
            newStrokes = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).map(st =>
              st.id === stroke.id ? { ...st, points: pts.slice(1), shapeType: undefined } : st
            );
          } else if (i === pts.length - 2) {
            // Acortar por el final
            newStrokes = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).map(st =>
              st.id === stroke.id ? { ...st, points: pts.slice(0, -1), shapeType: undefined } : st
            );
          } else {
            // Partir en dos
            const beforePoints = pts.slice(0, i + 1);
            const afterPoints = pts.slice(i + 1);
            const otherStrokes = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).filter(st => st.id !== stroke.id);
            newStrokes = [...otherStrokes];
            if (beforePoints.length >= 2) {
              newStrokes.push({
                id: uuidv4(),
                points: beforePoints,
                fillColor: stroke.fillColor,
                strokeColor: stroke.strokeColor,
                strokeWidth: stroke.strokeWidth,
                type: stroke.type,
              });
            }
            if (afterPoints.length >= 2) {
              newStrokes.push({
                id: uuidv4(),
                points: afterPoints,
                fillColor: stroke.fillColor,
                strokeColor: stroke.strokeColor,
                strokeWidth: stroke.strokeWidth,
                type: stroke.type,
              });
            }
          }

          s.replaceStrokes(newStrokes);
        }
      }
      return;
    }

    if (s.tool === 'smooth') {
      const THRESHOLD = 10 / s.zoom;
      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (stroke.points.length < 2) continue;
        if (isStrokeLocked(stroke.id)) continue;
        for (let i = 0; i < stroke.points.length - 1; i++) {
          const p = stroke.points[i];
          const dx = p.x - point.x;
          const dy = p.y - point.y;
          if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) {
            s.pushHistory();
            const start = stroke.points[i];
            const end = stroke.points[i + 1];
            const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
            smoothStateRef.current = {
              active: true,
              strokeId: stroke.id,
              segmentIdx: i,
              start,
              end,
              control: mid,
            };
            s.setCurrentStroke([start, mid, end]);
            return;
          }
        }
      }
      return;
    }

    if (s.tool === 'bezier') {
      const THRESHOLD = 10 / s.zoom;
      // 1. Try to grab an existing curve control point
      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (isStrokeLocked(stroke.id)) continue;
        if (stroke.type !== 'curve' || stroke.points.length < 3) continue;
        const cp = stroke.points[1];
        const dx = cp.x - point.x;
        const dy = cp.y - point.y;
        if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) {
          bezierDragRef.current = {
            active: true,
            strokeId: stroke.id,
            controlIndex: 1,
          };
          return;
        }
      }
      // 2. If clicked near a segment of a 2-point line stroke, convert it to curve
      for (const stroke of s.currentIcon?.layers.flatMap(l => l.strokes) || []) {
        if (isStrokeLocked(stroke.id)) continue;
        if (stroke.type !== 'line' || stroke.points.length !== 2) continue;
        const p0 = stroke.points[0];
        const p1 = stroke.points[1];
        const { dist } = pointToSegmentDistance(point.x, point.y, p0.x, p0.y, p1.x, p1.y);
        if (dist < THRESHOLD) {
          s.pushHistory();
          const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          s.updateStroke(stroke.id, {
            type: 'curve',
            points: [p0, mid, p1],
          });
          bezierDragRef.current = {
            active: true,
            strokeId: stroke.id,
            controlIndex: 1,
          };
          return;
        }
      }
      return;
    }

    if (s.tool === 'round-corner') {
      const THRESHOLD = 10 / s.zoom;
      const allStrokes = s.currentIcon?.layers.flatMap(l => l.strokes).filter(s => !isStrokeLocked(s.id)) || [];
      const corner = findSharedCorner(allStrokes, point, THRESHOLD);
      if (!corner) return;

      const { vertex, participants } = corner;
      const uniqueStrokeIds = [...new Set(participants.map(p => p.strokeId))];

      // Determine prev and next from the two neighbors
      let prev: Point;
      let next: Point;
      if (participants.length === 2) {
        prev = participants[0].neighbor;
        next = participants[1].neighbor;
      } else {
        // For single interior vertex with 2+ participants, pick the two most divergent neighbors
        prev = participants[0].neighbor;
        next = participants[1].neighbor;
      }

      const rounded = computeRoundCorner(prev, vertex, next, s.cornerRadius, s.cornerSegments);
      if (!rounded) return;
      const { arc, t1, t2 } = rounded;

      s.pushHistory();

      if (uniqueStrokeIds.length === 1) {
        // Single stroke: replace vertex with t1 + arc + t2
        const sid = uniqueStrokeIds[0];
        const stroke = allStrokes.find(st => st.id === sid);
        if (!stroke) return;
        const idx = participants[0].pointIndex;
        const isClosed = stroke.points.length >= 3
          && Math.abs(stroke.points[0].x - stroke.points[stroke.points.length - 1].x) < 0.5
          && Math.abs(stroke.points[0].y - stroke.points[stroke.points.length - 1].y) < 0.5;
        const newPoints = [...stroke.points];
        newPoints.splice(idx, 1, t1, ...arc, t2);
        if (isClosed && (idx === 0 || idx === stroke.points.length - 1)) {
          newPoints[newPoints.length - 1] = { ...newPoints[0] };
        }
        s.updateStroke(sid, { points: newPoints });
      } else {
        // Multiple strokes sharing the vertex: shorten each to its tangent point and add arc stroke
        for (const sid of uniqueStrokeIds) {
          const stroke = allStrokes.find(st => st.id === sid);
          if (!stroke) continue;
          const parts = participants.filter(p => p.strokeId === sid);
          const idx = parts[0].pointIndex;
          const neighbor = parts[0].neighbor;

          // Decide which tangent point this stroke gets by comparing neighbor to prev/next
          const distToPrev = Math.hypot(neighbor.x - prev.x, neighbor.y - prev.y);
          const distToNext = Math.hypot(neighbor.x - next.x, neighbor.y - next.y);
          const tangent = distToPrev < distToNext ? t1 : t2;

          const newPoints = [...stroke.points];
          newPoints.splice(idx, 1, tangent);
          s.updateStroke(sid, { points: newPoints });
        }
        // Create arc stroke connecting the two tangent points
        const firstStroke = allStrokes.find(st => st.id === uniqueStrokeIds[0]);
        const arcStroke: Stroke = {
          id: uuidv4(),
          points: [t1, ...arc, t2],
          fillColor: 'transparent',
          strokeColor: firstStroke?.strokeColor || s.strokeColor,
          strokeWidth: firstStroke?.strokeWidth || s.strokeWidth,
          type: 'line',
        };
        s.addStroke(arcStroke);
      }

      roundCornerHoverRef.current = null;
      return;
    }

    if (s.tool === 'line') {
      const snappedPoint = snapToGrid(point, s.gridSize);
      s.setIsDrawing(true);
      s.setCurrentStroke([snappedPoint]);
      lastAddPosRef.current = { clientX: e.clientX, clientY: e.clientY };
    }

    if (s.tool === 'curve') {
      const cs = curveStateRef.current;
      if (cs.phase === 'idle') {
        const snapped = snapToGrid(point, s.gridSize);
        curveStateRef.current = { phase: 'p1', p1: snapped };
        s.setCurrentStroke([snapped]);
      } else if (cs.phase === 'p1') {
        const snapped = snapToGrid(point, s.gridSize);
        curveStateRef.current = { phase: 'p2', p1: cs.p1, p2: snapped };
        s.setCurrentStroke([cs.p1, snapped]);
      } else if (cs.phase === 'p2') {
        // Guardar curva: p1, cp=ratón_actual, p2
        const newStroke: Stroke = {
          id: uuidv4(),
          points: [cs.p1, point, cs.p2],
          fillColor: 'transparent',
          strokeColor: s.strokeColor,
          strokeWidth: s.strokeWidth,
          type: 'curve',
          closed: s.curveClosed,
        };
        s.addStroke(newStroke);
        s.setCurrentStroke([]);
        curveStateRef.current = { phase: 'idle' };
      }
    }

    if (s.tool === 'circle' || s.tool === 'rectangle') {
      const snapped = snapToGrid(point, s.gridSize);
      shapeDragRef.current = { active: true, origin: snapped, tool: s.tool };
      s.setIsDrawing(true);
      s.setCurrentStroke([snapped, snapped]);
    }

    if (s.tool === 'text') {
      const snapped = snapToGrid(point, s.gridSize);
      setTextDialog({
        open: true,
        point: snapped,
        value: '',
        size: textDialog?.size ?? 24,
        family: textDialog?.family ?? 'sans-serif',
      });
    }
  }, [getCanvasPoint]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const s = useAppStore.getState().getActiveState();
    const point = getCanvasPoint(e.clientX, e.clientY);
    const strokes = s.currentIcon?.layers.flatMap(l => l.strokes) || [];
    // Buscar el texto bajo el cursor (el más pequeño/adelante primero)
    const hit = strokes
      .filter(st => st.shapeType === 'text' && !isStrokeLocked(st.id) && isPointInStroke(point, st))
      .sort((a, b) => polygonArea(getStrokeContour(a)) - polygonArea(getStrokeContour(b)))[0];
    if (!hit) return;
    s.setSelectedStrokes([hit.id]);
    setTextDialog({
      open: true,
      point: hit.points[0],
      value: hit.text ?? '',
      size: hit.fontSize ?? 24,
      family: hit.fontFamily ?? 'sans-serif',
      strokeId: hit.id,
    });
  }, [getCanvasPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const s = useAppStore.getState().getActiveState();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      if (s.snapEnabled) {
        const cp = {
          x: (rawX - s.panX) / s.zoom,
          y: (rawY - s.panY) / s.zoom,
        };
        const snapped = snapToGrid(cp, s.gridSize);
        setMouseRulerPos({
          x: snapped.x * s.zoom + s.panX,
          y: snapped.y * s.zoom + s.panY,
        });
      } else {
        setMouseRulerPos({ x: rawX, y: rawY });
      }
    }
    const s = useAppStore.getState().getActiveState();
    const hd = handDragRef.current;
    if (s.tool === 'hand' && hd?.active) {
      const dx = (e.clientX - hd.startClientX) / s.zoom;
      const dy = (e.clientY - hd.startClientY) / s.zoom;
      for (const id of s.selectedStrokes) {
        if (isStrokeLocked(id)) continue;
        const orig = hd.originalStrokes.get(id);
        if (!orig) continue;
        s.updateStrokeNoHistory(id, {
          points: orig.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
          holes: orig.holes ? orig.holes.map(h => h.map(p => ({ x: p.x + dx, y: p.y + dy }))) : undefined,
        });
      }
      return;
    }

    if (isPanning && s.tool === 'hand') {
      s.setPanX(e.clientX - panStart.x);
      s.setPanY(e.clientY - panStart.y);
      return;
    }

    if (isSelecting && selectionRect) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      setSelectionRect({ ...selectionRect, end: point });
      return;
    }

    if (isLassoing) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      setLassoPath(prev => [...prev, point]);
      return;
    }

    if (s.isDrawing && s.tool === 'line') {
      // Línea recta: inicio pegado + final pegado a la malla
      const point = getCanvasPoint(e.clientX, e.clientY);
      if (s.currentStroke.length >= 1) {
        const snappedEnd = snapToGrid(point, s.gridSize);
        s.setCurrentStroke([s.currentStroke[0], snappedEnd]);
      }
    }

    const cs = curveStateRef.current;
    if (s.tool === 'curve' && cs.phase === 'p1') {
      const point = getCanvasPoint(e.clientX, e.clientY);
      s.setCurrentStroke([cs.p1, point]);
    }

    if (s.tool === 'curve' && cs.phase === 'p2') {
      const point = getCanvasPoint(e.clientX, e.clientY);
      s.setCurrentStroke([cs.p1, point, cs.p2]);
    }

    const vd = vertexDragRef.current;
    if ((s.tool === 'vertex' || s.tool === 'select') && vd?.active) {
      const newPoint = getCanvasPoint(e.clientX, e.clientY);
      const snapped = snapToGrid(newPoint, s.gridSize);
      if (vd.selectedVertices && vd.selectedVertices.length > 0 && vd.pointKeys && vd.originalPositions) {
        // Multi-drag: mover todos los puntos pre-calculados por delta total desde el inicio
        const delta = { x: snapped.x - vd.originalPoint.x, y: snapped.y - vd.originalPoint.y };
        const byStroke = new Map<string, { index: number; orig: Point }[]>();
        for (const key of vd.pointKeys) {
          const [strokeId, idxStr] = key.split(':');
          const idx = parseInt(idxStr, 10);
          const orig = vd.originalPositions.get(key);
          if (orig === undefined) continue;
          const arr = byStroke.get(strokeId) || [];
          arr.push({ index: idx, orig });
          byStroke.set(strokeId, arr);
        }
        for (const [strokeId, items] of byStroke) {
          if (isStrokeLocked(strokeId)) continue;
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === strokeId);
          if (!stroke) continue;
          const newPoints = [...stroke.points];
          for (const { index, orig } of items) {
            if (index >= newPoints.length) continue;
            newPoints[index] = { x: orig.x + delta.x, y: orig.y + delta.y };
          }
          // Mantener cierre si el stroke era cerrado y se movio el primer o ultimo punto (solo en modo multi)
          const isClosed = stroke.points.length >= 3 &&
            Math.abs(stroke.points[0].x - stroke.points[stroke.points.length - 1].x) < 0.5 &&
            Math.abs(stroke.points[0].y - stroke.points[stroke.points.length - 1].y) < 0.5;
          if (isClosed && vd.mode !== 'single') {
            const firstMoved = items.some(item => item.index === 0);
            const lastMoved = items.some(item => item.index === stroke.points.length - 1);
            if (firstMoved && !lastMoved) {
              newPoints[newPoints.length - 1] = { ...newPoints[0] };
            } else if (lastMoved && !firstMoved) {
              newPoints[0] = { ...newPoints[newPoints.length - 1] };
            }
          }
          let newHoles: Point[][] | undefined;
          if (stroke.holes && vd.mode !== 'single') {
            newHoles = stroke.holes.map(hole => hole.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })));
            // Mantener cierre de holes tambien
            newHoles = newHoles.map(hole => {
              if (hole.length >= 3 &&
                Math.abs(hole[0].x - hole[hole.length - 1].x) < 0.5 &&
                Math.abs(hole[0].y - hole[hole.length - 1].y) < 0.5) {
                const h = [...hole];
                h[hole.length - 1] = { ...h[0] };
                return h;
              }
              return hole;
            });
          }
          s.updateStrokeNoHistory(strokeId, { points: newPoints, holes: newHoles });
        }
      } else {
        // Drag individual: mueve SÓLO el vértice pulsado. Los huecos NO se
        // mueven (antes se "imantaban" al vértice y arrastraban consigo todo
        // el borde interior de la letra, p.ej. el círculo interno de la O).
        for (const id of vd.affectedStrokeIds) {
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
          if (!stroke) continue;
          const newPoints = stroke.points.map(p =>
            Math.abs(p.x - vd.originalPoint.x) < 0.5 && Math.abs(p.y - vd.originalPoint.y) < 0.5
              ? snapped
              : p
          );
          // Mantener cierre si el stroke era cerrado y se movio el primer o ultimo punto
          const isClosed = stroke.points.length >= 3 &&
            Math.abs(stroke.points[0].x - stroke.points[stroke.points.length - 1].x) < 0.5 &&
            Math.abs(stroke.points[0].y - stroke.points[stroke.points.length - 1].y) < 0.5;
          if (isClosed) {
            const firstMatches = Math.abs(stroke.points[0].x - vd.originalPoint.x) < 0.5 &&
              Math.abs(stroke.points[0].y - vd.originalPoint.y) < 0.5;
            const lastMatches = Math.abs(stroke.points[stroke.points.length - 1].x - vd.originalPoint.x) < 0.5 &&
              Math.abs(stroke.points[stroke.points.length - 1].y - vd.originalPoint.y) < 0.5;
            if (firstMatches && !lastMatches) {
              newPoints[newPoints.length - 1] = snapped;
            } else if (lastMatches && !firstMatches) {
              newPoints[0] = snapped;
            }
          }
          s.updateStrokeNoHistory(id, { points: newPoints });
        }
        vd.originalPoint = snapped;
      }
    }

    const ss = smoothStateRef.current;
    if (s.tool === 'smooth' && ss?.active) {
      const cp = getCanvasPoint(e.clientX, e.clientY);
      s.setCurrentStroke([ss.start, cp, ss.end]);
    }

    const bd = bezierDragRef.current;
    if (s.tool === 'bezier' && bd?.active) {
      const cp = getCanvasPoint(e.clientX, e.clientY);
      if (!isStrokeLocked(bd.strokeId)) {
        const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === bd.strokeId);
        if (stroke) {
          const newPoints = [...stroke.points];
          newPoints[bd.controlIndex] = cp;
          s.updateStrokeNoHistory(bd.strokeId, { points: newPoints });
        }
      }
    }

    // Round-corner hover preview
    if (s.tool === 'round-corner') {
      const point = getCanvasPoint(e.clientX, e.clientY);
      const THRESHOLD = 10 / s.zoom;
      const allStrokes = s.currentIcon?.layers.flatMap(l => l.strokes).filter(s => !isStrokeLocked(s.id)) || [];
      const corner = findSharedCorner(allStrokes, point, THRESHOLD);
      let found: { strokeId: string; pointIndex: number; previewPoints: Point[]; vertex: Point } | null = null;
      if (corner) {
        const { vertex, participants } = corner;
        let prev: Point;
        let next: Point;
        if (participants.length >= 2) {
          prev = participants[0].neighbor;
          next = participants[1].neighbor;
        } else {
          prev = participants[0].neighbor;
          next = participants[0].neighbor;
        }
        const rounded = computeRoundCorner(prev, vertex, next, s.cornerRadius, s.cornerSegments);
        if (rounded) {
          found = {
            strokeId: participants[0].strokeId,
            pointIndex: participants[0].pointIndex,
            previewPoints: [rounded.t1, ...rounded.arc, rounded.t2],
            vertex,
          };
        }
      }
      roundCornerHoverRef.current = found;
    }

    const sd = shapeDragRef.current;
    if (sd?.active && (sd.tool === 'circle' || sd.tool === 'rectangle')) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      const snapped = snapToGrid(point, s.gridSize);
      s.setCurrentStroke([sd.origin, snapped]);
    }

    const rh = resizeHandleRef.current;
    if (rh?.active) {
      const point = getCanvasPoint(e.clientX, e.clientY);
      if (rh.mode === 'rotate') {
        const angle = Math.atan2(point.y - rh.center.y, point.x - rh.center.x);
        const delta = angle - rh.startAngle;
        const cos = Math.cos(delta);
        const sin = Math.sin(delta);
        const deltaDeg = (delta * 180) / Math.PI;
        for (const id of rh.strokeIds) {
          if (isStrokeLocked(id)) continue;
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
          if (!stroke) continue;
          if (stroke.shapeType === 'text') {
            if (rh.strokeIds.length === 1) {
              // Girar el texto sobre sí mismo: el centro queda fijo, sólo cambia la rotación
              s.updateStrokeNoHistory(id, { rotation: (stroke.rotation ?? 0) + deltaDeg });
            } else {
              // Rotación de grupo: el ancla orbita el centro del grupo y se suma la rotación
              const rotatePoint = (p: Point) => ({
                x: rh.center.x + (p.x - rh.center.x) * cos - (p.y - rh.center.y) * sin,
                y: rh.center.y + (p.x - rh.center.x) * sin + (p.y - rh.center.y) * cos,
              });
              const newAnchor = rotatePoint(stroke.points[0]);
              s.updateStrokeNoHistory(id, {
                points: [newAnchor],
                rotation: (stroke.rotation ?? 0) + deltaDeg,
              });
            }
            continue;
          }
          const rotatePoint = (p: Point) => ({
            x: rh.center.x + (p.x - rh.center.x) * cos - (p.y - rh.center.y) * sin,
            y: rh.center.y + (p.x - rh.center.x) * sin + (p.y - rh.center.y) * cos,
          });
          const newPoints = stroke.points.map(rotatePoint);
          let newHoles: Point[][] | undefined;
          if (stroke.holes) {
            newHoles = stroke.holes.map(hole => hole.map(rotatePoint));
          }
          s.updateStrokeNoHistory(id, { points: newPoints, holes: newHoles });
        }
        rh.startAngle = angle;
      } else {
        const dx = point.x - rh.lastMouse.x;
        const dy = point.y - rh.lastMouse.y;
        rh.lastMouse = point;
        const b = rh.startBounds;
        let newMinX = b.minX, newMinY = b.minY, newMaxX = b.maxX, newMaxY = b.maxY;
        if (rh.corner === 'tl' || rh.corner === 'bl') newMinX += dx;
        if (rh.corner === 'tr' || rh.corner === 'br') newMaxX += dx;
        if (rh.corner === 'tl' || rh.corner === 'tr') newMinY += dy;
        if (rh.corner === 'bl' || rh.corner === 'br') newMaxY += dy;
        if (newMaxX <= newMinX || newMaxY <= newMinY) return;
        const scaleX = (newMaxX - newMinX) / (b.maxX - b.minX);
        const scaleY = (newMaxY - newMinY) / (b.maxY - b.minY);
        const anchorX = rh.corner === 'tl' || rh.corner === 'tr' ? b.maxX : b.minX;
        const anchorY = rh.corner === 'tl' || rh.corner === 'bl' ? b.maxY : b.minY;
        for (const id of rh.strokeIds) {
          if (isStrokeLocked(id)) continue;
          const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
          if (!stroke) continue;
          const newPoints = stroke.points.map(p => ({
            x: anchorX + (p.x - anchorX) * scaleX,
            y: anchorY + (p.y - anchorY) * scaleY,
          }));
          let newHoles: Point[][] | undefined;
          if (stroke.holes) {
            newHoles = stroke.holes.map(hole => hole.map(p => ({
              x: anchorX + (p.x - anchorX) * scaleX,
              y: anchorY + (p.y - anchorY) * scaleY,
            })));
          }
          s.updateStrokeNoHistory(id, { points: newPoints, holes: newHoles });
        }
      }
    }
  }, [isPanning, isSelecting, selectionRect, isLassoing, getCanvasPoint, panStart]);

  const handleMouseUp = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const s = useAppStore.getState().getActiveState();
    if (handDragRef.current?.active) {
      handDragRef.current = null;
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isSelecting && selectionRect) {
      setIsSelecting(false);
      // Find strokes within selection rectangle
      const minX = Math.min(selectionRect.start.x, selectionRect.end.x);
      const maxX = Math.max(selectionRect.start.x, selectionRect.end.x);
      const minY = Math.min(selectionRect.start.y, selectionRect.end.y);
      const maxY = Math.max(selectionRect.start.y, selectionRect.end.y);

      const selectedIds = s.currentIcon?.layers.flatMap(l => l.strokes)
        .filter(s2 => !isStrokeLocked(s2.id) && s2.points.some(p =>
          p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
        ))
        .map(s2 => s2.id) || [];

      s.setSelectedStrokes(selectedIds);
      setSelectionRect(null);
      return;
    }

    if (isLassoing) {
      setIsLassoing(false);
      if (lassoPath.length >= 3) {
        const polygon = lassoPath;
        const selectedIds = s.currentIcon?.layers.flatMap(l => l.strokes)
          .filter(stroke => !isStrokeLocked(stroke.id) && isStrokeInsidePolygon(stroke, polygon))
          .map(stroke => stroke.id) || [];
        s.setSelectedStrokes(selectedIds);
      }
      setLassoPath([]);
      return;
    }

    if (vertexDragRef.current?.active) {
      const vd = vertexDragRef.current;
      if (vd && vd.mode !== 'single') {
        const WELD_THRESHOLD = 8 / s.zoom;
        const allStrokes = s.currentIcon?.layers.flatMap(l => l.strokes) || [];
        // Recolectar posiciones finales de todos los vértices afectados
        const targets: Point[] = [];
        if (vd.pointKeys && vd.pointKeys.size > 0) {
          for (const key of vd.pointKeys) {
            const [strokeId, idxStr] = key.split(':');
            const idx = parseInt(idxStr, 10);
            const stroke = allStrokes.find(st => st.id === strokeId);
            if (stroke && idx < stroke.points.length) {
              targets.push(stroke.points[idx]);
            }
          }
        } else {
          targets.push(vd.originalPoint);
        }
        for (const stroke of allStrokes) {
          let changed = false;
          const newPoints = stroke.points.map((p) => {
            for (const target of targets) {
              const dx = p.x - target.x;
              const dy = p.y - target.y;
              if (Math.sqrt(dx * dx + dy * dy) < WELD_THRESHOLD) {
                changed = true;
                return { x: target.x, y: target.y };
              }
            }
            return p;
          });
          if (changed) {
            s.updateStrokeNoHistory(stroke.id, { points: newPoints });
          }
        }
      }
      setSelectedVertices([]);
      vertexDragRef.current = null;
      return;
    }

    const ss = smoothStateRef.current;
    if (ss?.active) {
      ss.active = false;
      const stroke = s.currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === ss.strokeId);
      if (stroke) {
        const cp = s.currentStroke[1];
        const before = stroke.points.slice(0, ss.segmentIdx + 1);
        const after = stroke.points.slice(ss.segmentIdx + 1);

        const newStrokes = (s.currentIcon?.layers.flatMap(l => l.strokes) || []).filter(st => st.id !== ss.strokeId);
        if (before.length > 1) {
          newStrokes.push({
            id: uuidv4(),
            points: before,
            fillColor: stroke.fillColor,
            strokeColor: stroke.strokeColor,
            strokeWidth: stroke.strokeWidth,
            type: 'line',
          });
        }
        newStrokes.push({
          id: uuidv4(),
          points: [ss.start, cp, ss.end],
          fillColor: stroke.fillColor,
          strokeColor: stroke.strokeColor,
          strokeWidth: stroke.strokeWidth,
          type: 'curve',
        });
        if (after.length > 1) {
          newStrokes.push({
            id: uuidv4(),
            points: after,
            fillColor: stroke.fillColor,
            strokeColor: stroke.strokeColor,
            strokeWidth: stroke.strokeWidth,
            type: 'line',
          });
        }
        s.replaceStrokesNoHistory(newStrokes);
      }
      s.setCurrentStroke([]);
      smoothStateRef.current = null;
      return;
    }

    const bd = bezierDragRef.current;
    if (bd?.active) {
      bd.active = false;
      bezierDragRef.current = null;
      return;
    }

    if (s.isDrawing && s.tool === 'line') {
      s.setIsDrawing(false);
      if (s.currentStroke.length >= 2) {
        const snappedEnd = snapToGrid(s.currentStroke[s.currentStroke.length - 1], s.gridSize);
        const newStroke: Stroke = {
          id: uuidv4(),
          points: [s.currentStroke[0], snappedEnd],
          fillColor: s.fillColor,
          strokeColor: s.strokeColor,
          strokeWidth: s.strokeWidth,
          type: 'line',
        };
        s.addStroke(newStroke);
      }
      s.setCurrentStroke([]);
    }

    const sd = shapeDragRef.current;
    if (sd?.active) {
      sd.active = false;
      if (s.currentStroke.length >= 2) {
        const p1 = s.currentStroke[0];
        const p2 = s.currentStroke[s.currentStroke.length - 1];
        let newStroke: Stroke;
        if (sd.tool === 'rectangle') {
          const x1 = Math.min(p1.x, p2.x);
          const y1 = Math.min(p1.y, p2.y);
          const x2 = Math.max(p1.x, p2.x);
          const y2 = Math.max(p1.y, p2.y);
          newStroke = {
            id: uuidv4(),
            points: [
              { x: x1, y: y1 },
              { x: x2, y: y1 },
              { x: x2, y: y2 },
              { x: x1, y: y2 },
              { x: x1, y: y1 },
            ],
            fillColor: s.fillColor,
            strokeColor: s.strokeColor,
            strokeWidth: s.strokeWidth,
            type: 'line',
          };
        } else {
          // Generar círculo como polígono regular con 32 puntos para permitir vértices
          const cx = p1.x;
          const cy = p1.y;
          const radius = Math.hypot(p2.x - cx, p2.y - cy);
          const SEGMENTS = 32;
          const circlePoints: Point[] = [];
          for (let i = 0; i < SEGMENTS; i++) {
            const angle = (i / SEGMENTS) * Math.PI * 2;
            circlePoints.push({
              x: cx + Math.cos(angle) * radius,
              y: cy + Math.sin(angle) * radius,
            });
          }
          circlePoints.push({ x: circlePoints[0].x, y: circlePoints[0].y });
          newStroke = {
            id: uuidv4(),
            points: circlePoints,
            fillColor: s.fillColor,
            strokeColor: s.strokeColor,
            strokeWidth: s.strokeWidth,
            type: 'line',
          };
        }
        s.addStroke(newStroke);
      }
      s.setCurrentStroke([]);
      shapeDragRef.current = null;
    }

    const rh = resizeHandleRef.current;
    if (rh?.active) {
      rh.active = false;
      resizeHandleRef.current = null;
      return;
    }

    // Curve se maneja en mousedown (3-clics), no en mouseup
  }, [isPanning, isSelecting, selectionRect, isLassoing, lassoPath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background in screen coordinates so it always covers the whole canvas
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw template image (behind grid and strokes)
    const templateImg = templateImageRef.current;
    if (templateImg) {
      ctx.save();
      ctx.globalAlpha = templateOpacity;
      ctx.drawImage(
        templateImg,
        templateOffsetX,
        templateOffsetY,
        templateImg.naturalWidth * templateScale,
        templateImg.naturalHeight * templateScale
      );
      ctx.restore();
    }

    // Draw grid
    drawGrid(ctx, canvas.width, canvas.height, gridSize, panX, panY, zoom);
    
    // Draw strokes (layer-aware, respects visibility)
    currentIcon?.layers.forEach(layer => {
      if (!layer.visible) return;
      layer.strokes.forEach(stroke => drawStroke(ctx, stroke));
    });

    // Draw gates for saved strokes
    currentIcon?.layers.forEach(layer => {
      if (!layer.visible) return;
      layer.strokes.forEach(stroke => drawGates(ctx, stroke.points, stroke.strokeColor));
    });

    // Highlight selected vertices (magenta ring)
    for (const sv of selectedVertices) {
      const stroke = currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === sv.strokeId);
      if (!stroke || sv.pointIndex >= stroke.points.length) continue;
      const p = stroke.points[sv.pointIndex];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ff00ff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // Draw selection bounding box and resize handles (single box for the whole group)
    if (selectedStrokes.length > 0) {
      const groupBounds = selectedStrokes.reduce((acc, id) => {
        const stroke = currentIcon?.layers.flatMap(l => l.strokes).find(st => st.id === id);
        if (!stroke) return acc;
        const b = getStrokeBounds(stroke);
        return {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        };
      }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(groupBounds.minX, groupBounds.minY, groupBounds.maxX - groupBounds.minX, groupBounds.maxY - groupBounds.minY);
      ctx.setLineDash([]);
      ctx.fillStyle = '#00e5ff';
      const handleSize = 6 / zoom;
      const corners = [
        { x: groupBounds.minX, y: groupBounds.minY },
        { x: groupBounds.maxX, y: groupBounds.minY },
        { x: groupBounds.minX, y: groupBounds.maxY },
        { x: groupBounds.maxX, y: groupBounds.maxY },
      ];
      for (const c of corners) {
        ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      }
      // Handle de rotación (arriba del centro) — círculo naranja
      const centerX = (groupBounds.minX + groupBounds.maxX) / 2;
      const rotY = groupBounds.minY - 24;
      ctx.beginPath();
      ctx.moveTo(centerX, groupBounds.minY);
      ctx.lineTo(centerX, rotY);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, rotY, 8 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ffaa00';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Draw current stroke
    if (currentStroke.length > 0) {
      if (tool === 'circle' && currentStroke.length >= 2) {
        const [c, rPt] = currentStroke;
        const radius = Math.hypot(rPt.x - c.x, rPt.y - c.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      } else if (tool === 'rectangle' && currentStroke.length >= 2) {
        const [p1, p2] = currentStroke;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(currentStroke[0].x, currentStroke[0].y);

        if ((tool === 'curve' || tool === 'smooth') && currentStroke.length === 3) {
          const cp = currentStroke[1];
          const p2 = currentStroke[2];
          ctx.quadraticCurveTo(cp.x, cp.y, p2.x, p2.y);
        } else {
          for (let i = 1; i < currentStroke.length; i++) {
            ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
          }
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();

        // Gates: solo en p1 (primero) y p2 (último) para curva / smooth
        if ((tool === 'curve' || tool === 'smooth') && currentStroke.length >= 2) {
          const p1 = currentStroke[0];
          const p2 = currentStroke[currentStroke.length - 1];
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p2.x, p2.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = strokeColor;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          drawGates(ctx, currentStroke, strokeColor);
        }
      }
    }
    
    // Draw vertices of selected strokes when select tool is active (guides for Ctrl+click vertex editing)
    if (tool === 'select' && selectedStrokes.length > 0) {
      const selStrokeIds = new Set(selectedStrokes);
      currentIcon?.layers.flatMap(l => l.strokes).forEach(stroke => {
        if (!selStrokeIds.has(stroke.id)) return;
        stroke.points.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#a0a0a0';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.8 / zoom;
          ctx.stroke();
        });
      });
    }

    // Draw all vertices when vertex, delete-vertex, delete-segment, smooth or bezier tool is active
    if (tool === 'vertex' || tool === 'delete-vertex' || tool === 'delete-segment' || tool === 'smooth' || tool === 'bezier') {
      const WELD_TOL = 0.5;
      const pointCounts = new Map<string, number>();
      const pointMap = new Map<string, Point>();
      currentIcon?.layers.flatMap(l => l.strokes).forEach(stroke => {
        stroke.points.forEach(p => {
          // Find an existing nearby point or create new key
          let key: string | null = null;
          for (const [k, existing] of pointMap) {
            if (Math.abs(existing.x - p.x) < WELD_TOL && Math.abs(existing.y - p.y) < WELD_TOL) {
              key = k;
              break;
            }
          }
          if (!key) {
            key = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
            pointMap.set(key, p);
          }
          pointCounts.set(key, (pointCounts.get(key) || 0) + 1);
        });
      });

      const normalR = 2 / zoom;
      const weldedR = 3 / zoom;

      // Normal vertices (not welded)
      pointMap.forEach((p, key) => {
        if ((pointCounts.get(key) || 0) > 1) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, normalR, 0, Math.PI * 2);
        ctx.fillStyle = '#a0a0a0';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.8 / zoom;
        ctx.stroke();
      });

      // Welded vertices (shared by multiple strokes) — yellow highlight
      pointMap.forEach((p, key) => {
        if ((pointCounts.get(key) || 0) <= 1) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, weldedR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc00';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      });
    }

    // Draw bezier handles and control points when bezier tool is active
    if (tool === 'bezier') {
      currentIcon?.layers.flatMap(l => l.strokes).forEach(stroke => {
        if (stroke.type !== 'curve' || stroke.points.length < 3) return;
        const p0 = stroke.points[0];
        const cp = stroke.points[1];
        const p2 = stroke.points[2];

        // Lines from control point to anchors
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(cp.x, cp.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cp.x, cp.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Control point square
        const size = 5 / zoom;
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(cp.x - size / 2, cp.y - size / 2, size, size);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / zoom;
        ctx.strokeRect(cp.x - size / 2, cp.y - size / 2, size, size);
        ctx.restore();
      });
    }

    // Draw round-corner hover preview
    const rcHover = roundCornerHoverRef.current;
    if (tool === 'round-corner' && rcHover) {
      ctx.save();
      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([3 / zoom, 3 / zoom]);
      ctx.beginPath();
      ctx.moveTo(rcHover.previewPoints[0].x, rcHover.previewPoints[0].y);
      for (let i = 1; i < rcHover.previewPoints.length; i++) {
        ctx.lineTo(rcHover.previewPoints[i].x, rcHover.previewPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw tangent points
      ctx.fillStyle = '#00ffaa';
      for (const p of rcHover.previewPoints) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      // Highlight original vertex
      ctx.beginPath();
      ctx.arc(rcHover.vertex.x, rcHover.vertex.y, 5 / zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
      ctx.restore();
    }

    // Draw selection rectangle
    if (selectionRect) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        selectionRect.start.x,
        selectionRect.start.y,
        selectionRect.end.x - selectionRect.start.x,
        selectionRect.end.y - selectionRect.start.y
      );
      ctx.setLineDash([]);
    }

    // Draw lasso path
    if (lassoPath.length > 1) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
      for (let i = 1; i < lassoPath.length; i++) {
        ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Highlight selected strokes
    selectedStrokes.forEach(id => {
      const stroke = currentIcon?.layers.flatMap(l => l.strokes).find(s => s.id === id);
      if (stroke) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.min(...stroke.points.map(p => p.x)) - 5,
          Math.min(...stroke.points.map(p => p.y)) - 5,
          Math.max(...stroke.points.map(p => p.x)) - Math.min(...stroke.points.map(p => p.x)) + 10,
          Math.max(...stroke.points.map(p => p.y)) - Math.min(...stroke.points.map(p => p.y)) + 10
        );
      }
    });
    
    ctx.restore();

    // Draw rulers
    const rulerH = rulerHRef.current;
    const rulerV = rulerVRef.current;
    if (rulerH && rulerV) {
      const rhCtx = rulerH.getContext('2d');
      const rvCtx = rulerV.getContext('2d');
      if (rhCtx && rvCtx) {
        const step = gridSize;

        // Horizontal ruler
        rhCtx.clearRect(0, 0, rulerH.width, rulerH.height);
        rhCtx.fillStyle = '#0f0f1a';
        rhCtx.fillRect(0, 0, rulerH.width, rulerH.height);
        rhCtx.strokeStyle = 'rgba(255,255,255,0.25)';
        rhCtx.fillStyle = 'rgba(255,255,255,0.6)';
        rhCtx.font = '9px sans-serif';
        rhCtx.textAlign = 'center';
        rhCtx.textBaseline = 'top';

        const startX = Math.floor(-panX / zoom / step) * step;
        const endX = startX + (rulerH.width / zoom) + step * 2;

        for (let x = startX; x < endX; x += step) {
          const screenX = x * zoom + panX;
          if (screenX < -10 || screenX > rulerH.width + 10) continue;
          const isMajor = Math.abs(x % (step * 5)) < 0.1;
          rhCtx.beginPath();
          rhCtx.moveTo(screenX, isMajor ? 0 : 12);
          rhCtx.lineTo(screenX, 24);
          rhCtx.stroke();
          if (isMajor && screenX > 15 && screenX < rulerH.width - 15) {
            rhCtx.fillText(String(Math.round(x)), screenX, 2);
          }
        }

        // Red cursor line on horizontal ruler
        if (mouseRulerPos.x >= 0 && mouseRulerPos.x <= rulerH.width) {
          rhCtx.strokeStyle = '#ff0000';
          rhCtx.lineWidth = 1;
          rhCtx.beginPath();
          rhCtx.moveTo(mouseRulerPos.x, 0);
          rhCtx.lineTo(mouseRulerPos.x, 24);
          rhCtx.stroke();
        }

        // Vertical ruler
        rvCtx.clearRect(0, 0, rulerV.width, rulerV.height);
        rvCtx.fillStyle = '#0f0f1a';
        rvCtx.fillRect(0, 0, rulerV.width, rulerV.height);
        rvCtx.strokeStyle = 'rgba(255,255,255,0.25)';
        rvCtx.fillStyle = 'rgba(255,255,255,0.6)';
        rvCtx.font = '9px sans-serif';
        rvCtx.textAlign = 'left';
        rvCtx.textBaseline = 'middle';

        const startY = Math.floor(-panY / zoom / step) * step;
        const endY = startY + (rulerV.height / zoom) + step * 2;

        for (let y = startY; y < endY; y += step) {
          const screenY = y * zoom + panY;
          if (screenY < -10 || screenY > rulerV.height + 10) continue;
          const isMajor = Math.abs(y % (step * 5)) < 0.1;
          rvCtx.beginPath();
          rvCtx.moveTo(isMajor ? 0 : 12, screenY);
          rvCtx.lineTo(24, screenY);
          rvCtx.stroke();
          if (isMajor && screenY > 10 && screenY < rulerV.height - 10) {
            rvCtx.fillText(String(Math.round(y)), 2, screenY);
          }
        }

        // Red cursor line on vertical ruler
        if (mouseRulerPos.y >= 0 && mouseRulerPos.y <= rulerV.height) {
          rvCtx.strokeStyle = '#ff0000';
          rvCtx.lineWidth = 1;
          rvCtx.beginPath();
          rvCtx.moveTo(0, mouseRulerPos.y);
          rvCtx.lineTo(24, mouseRulerPos.y);
          rvCtx.stroke();
        }
      }
    }
  }, [currentIcon, currentStroke, panX, panY, zoom, selectedStrokes, selectionRect, lassoPath.length, selectedVertices.length, tool, mouseRulerPos, templateOpacity, templateScale, templateOffsetX, templateOffsetY, templateReady, cornerRadius, cornerSegments, roundCornerHoverRef.current]);

  useEffect(() => {
    const handleResize = () => {
      setCanvasSize({
        width: window.innerWidth - 64,
        height: window.innerHeight - 64,
      });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSave = () => {
    if (currentIcon) {
      const updatedIcon = {
        ...currentIcon,
        title: iconTitle || currentIcon.title,
        description: iconDescription || currentIcon.description,
        updatedAt: new Date(),
      };
      store.setCurrentIcon(updatedIcon);
      store.saveIcon();
      setShowSaveDialog(false);
    }
  };

  const handleLoad = (id: string) => {
    store.loadIcon(id);
    setShowLoadDialog(false);
  };

  const handleExport = () => {
    store.exportAsPNG();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      store.importPNG(file, canvasSize, importDetailLevel);
    }
    // Resetear el input para permitir reimportar en la misma u otra pestana
    e.target.value = '';
  };

  const handleZoomIn = () => store.setZoom(zoom + 0.1);
  const handleZoomOut = () => store.setZoom(zoom - 0.1);
  const handleZoomReset = () => store.setZoom(1);

  // Reset curve, smooth and bezier state when tool changes
  useEffect(() => {
    if (tool !== 'curve') {
      curveStateRef.current = { phase: 'idle' };
      store.setCurrentStroke([]);
    }
    if (tool !== 'smooth') {
      smoothStateRef.current = null;
      store.setCurrentStroke([]);
    }
    if (tool !== 'bezier') {
      bezierDragRef.current = null;
    }
    if (tool !== 'round-corner') {
      roundCornerHoverRef.current = null;
    }
  }, [tool]);

  // Load template image when it changes
  useEffect(() => {
    if (templateImage) {
      const img = new Image();
      img.onload = () => {
        templateImageRef.current = img;
        const s = useAppStore.getState().getActiveState();
        const centerX = canvasSize.width / 2;
        const centerY = canvasSize.height / 2;
        const worldCenterX = (centerX - s.panX) / s.zoom;
        const worldCenterY = (centerY - s.panY) / s.zoom;
        const offsetX = worldCenterX - (img.naturalWidth * s.templateScale) / 2;
        const offsetY = worldCenterY - (img.naturalHeight * s.templateScale) / 2;
        s.setTemplateOffsetX(offsetX);
        s.setTemplateOffsetY(offsetY);
        setTemplateReady(v => v + 1);
      };
      img.src = templateImage;
    } else {
      templateImageRef.current = null;
      useAppStore.getState().getActiveState().setTemplateOffsetX(0);
      useAppStore.getState().getActiveState().setTemplateOffsetY(0);
      setTemplateReady(v => v + 1);
    }
  }, [templateImage]);

  return (
    <div className="h-full flex flex-col bg-gray-950 border-2 border-blue-500 text-white overflow-hidden">
      <TabsBar
        tabs={store.tabs}
        activeTabId={store.activeTabId}
        onSwitchTab={(id) => store.switchTab(id)}
        onCloseTab={(id) => store.closeTab(id)}
        onNewTab={() => store.createTab()}
      />
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Toolbar */}
        <div className="w-16 bg-gray-950 border-r border-blue-500 flex flex-col items-center py-4 space-y-4 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => store.setTool('select')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'select' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.select')}
          >
            <img src="/uploads/MousePointerSquareDashed.png" alt={t('editorIconos.tools.select')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('lasso')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'lasso' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.lasso')}
          >
            <img src="/uploads/LassoSelect.png" alt={t('editorIconos.tools.lasso')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.undo()}
            className="p-2 rounded bg-gray-900 border-2 border-blue-500 hover:bg-gray-800 disabled:opacity-30"
            title={t('editorIconos.tools.undo')}
            disabled={historyPast.length === 0}
          >
            <img src="/uploads/Undo2.png" alt={t('editorIconos.tools.undo')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.redo()}
            className="p-2 rounded bg-gray-900 border-2 border-blue-500 hover:bg-gray-800 disabled:opacity-30"
            title={t('editorIconos.tools.redo')}
            disabled={historyFuture.length === 0}
          >
            <img src="/uploads/Redo2.png" alt={t('editorIconos.tools.redo')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('line')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'line' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.line')}
          >
            <img src="/uploads/PencilLine.png" alt={t('editorIconos.tools.line')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('curve')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'curve' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.curve')}
          >
            <img src="/uploads/DraftingCompass.png" alt={t('editorIconos.tools.curve')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('smooth')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'smooth' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.smooth')}
          >
            <img src="/uploads/Tangent.png" alt={t('editorIconos.tools.smooth')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('bezier')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'bezier' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.bezier')}
          >
            <img src="/uploads/Tangent (2).png" alt={t('editorIconos.tools.bezier')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('round-corner')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'round-corner' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.roundCorner')}
          >
            <img src="/uploads/PieChart.png" alt={t('editorIconos.tools.roundCorner')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('circle')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'circle' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.circle')}
          >
            <img src="/uploads/circle.png" alt={t('editorIconos.tools.circle')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('rectangle')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'rectangle' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.rectangle')}
          >
            <img src="/uploads/Square.png" alt={t('editorIconos.tools.rectangle')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('text')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'text' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.text')}
          >
            <span className="inline-flex items-center justify-center w-6 h-6 text-2xl font-bold leading-none text-white">T</span>
          </button>
          <button
            onClick={() => store.setTool('eraser')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'eraser' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.eraser')}
          >
            <img src="/uploads/Eraser.png" alt={t('editorIconos.tools.eraser')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('vertex')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'vertex' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.vertexPen')}
          >
            <img src="/uploads/PencilVertex.png" alt={t('editorIconos.tools.vertexPen')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('delete-vertex')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'delete-vertex' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.deleteVertex')}
          >
            <img src="/uploads/CircleOff.png" alt={t('editorIconos.tools.deleteVertex')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('delete-segment')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'delete-segment' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.deleteSegment')}
          >
            <img src="/uploads/ShareIcon.png" alt={t('editorIconos.tools.deleteSegment')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('hand')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'hand' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.hand')}
          >
            <img src="/uploads/Hand.png" alt={t('editorIconos.tools.hand')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('fill')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'fill' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.fillOutline')}
          >
            <img src="/uploads/Paintbrush.png" alt={t('editorIconos.tools.fillOutline')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('fill-solid')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'fill-solid' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.fillSolid')}
          >
            <img src="/uploads/PaintBucket.png" alt={t('editorIconos.tools.fillSolid')} width={24} height={24} className="inline-block" />
          </button>
          <button
            onClick={() => store.setTool('extract')}
            className={`p-2 rounded bg-gray-900 border-2 border-blue-500 ${tool === 'extract' ? 'bg-gray-900 border-2 border-blue-500 !border-[#00ff00] shadow-[0_0_6px_#00ff00]' : 'hover:bg-gray-800'}`}
            title={t('editorIconos.tools.extract')}
          >
            <img src="/uploads/Scissors.png" alt={t('editorIconos.tools.extract')} width={24} height={24} className="inline-block" />
          </button>
          <div className="border-t border-gray-700 pt-4 flex flex-col items-center gap-2">
            <button
              onClick={handleZoomIn}
              className="p-2 rounded bg-gray-900 border-2 border-blue-500 hover:bg-gray-800"
              title={t('editorIconos.tools.zoomIn')}
            >
              <img src="/uploads/ZoomIn.png" alt={t('editorIconos.tools.zoomIn')} width={24} height={24} className="inline-block" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 rounded bg-gray-900 border-2 border-blue-500 hover:bg-gray-800"
              title={t('editorIconos.tools.zoomOut')}
            >
              <img src="/uploads/ZoomOut.png" alt={t('editorIconos.tools.zoomOut')} width={24} height={24} className="inline-block" />
            </button>
            <button
              onClick={handleZoomReset}
              className="p-2 rounded bg-gray-900 border-2 border-blue-500 hover:bg-gray-800"
              title={t('editorIconos.tools.resetZoom')}
            >
              <img src="/uploads/RefreshCw.png" alt={t('editorIconos.tools.resetZoom')} width={24} height={24} className="inline-block" />
            </button>
          </div>
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          {/* Horizontal ruler */}
          <canvas
            ref={rulerHRef}
            width={canvasSize.width}
            height={24}
            className="absolute top-0 left-0 z-20"
          />
          {/* Vertical ruler */}
          <canvas
            ref={rulerVRef}
            width={24}
            height={canvasSize.height}
            className="absolute top-0 right-0 z-20"
          />
          <canvas
            id="icon-canvas"
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className={tool === 'fill' || tool === 'fill-solid' || tool === 'extract' || tool === 'vertex' || tool === 'delete-vertex' || tool === 'delete-segment' || tool === 'smooth' || tool === 'bezier' || tool === 'round-corner' ? 'cursor-pointer' : tool === 'hand' ? 'cursor-grab' : 'cursor-crosshair'}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            onWheel={(e) => e.preventDefault()}
          />

          {/* Referencia del icono seleccionado (plantilla flotante) */}
          <IconReferencePreview />

          {/* Zoom indicator */}
          <div className="absolute bottom-4 left-4 bg-gray-900 border-2 border-blue-500 px-3 py-1 rounded text-sm z-30">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-64 bg-gray-900 border-l border-blue-500 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="p-4 space-y-2">
            <LayerPanel />
          </div>

          <div className="border-t border-gray-700 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase">{t('editorIconos.props.properties')}</h3>
          
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.fillColor')}</label>
            <input
              type="color"
              value={fillColor === 'transparent' ? '#000000' : fillColor}
              onChange={(e) => {
                store.setFillColor(e.target.value);
              }}
              onBlur={(e) => {
                store.addFillHistory(e.target.value);
              }}
              className="w-full h-8 rounded cursor-pointer"
            />
            <button
              onClick={() => store.setFillColor('transparent')}
              className={`mt-1 w-full px-2 py-1 rounded text-xs border ${fillColor === 'transparent' ? 'bg-gray-900 border-2 border-blue-500 border-[#00ff00] text-[#00ff00]' : 'bg-gray-900 border-2 border-blue-500 border-gray-600 text-gray-400 hover:bg-gray-800'}`}
            >
              {t('editorIconos.props.transparent')}
            </button>
            {fillHistory.length > 0 && (
              <div className="flex gap-1 mt-1">
                {fillHistory.map((c) => (
                  <button
                    key={c}
                    onClick={() => store.setFillColor(c)}
                    className="w-5 h-5 rounded border border-gray-600 shrink-0"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.strokeColor')}</label>
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => {
                const color = e.target.value;
                const unlocked = selectedStrokes.filter(id => !isStrokeLocked(id));
                unlocked.forEach(id => {
                  store.updateStrokeNoHistory(id, { strokeColor: color });
                });
                store.setStrokeColor(color);
              }}
              onBlur={(e) => {
                const color = e.target.value;
                const unlocked = selectedStrokes.filter(id => !isStrokeLocked(id));
                if (unlocked.length > 0) {
                  store.pushHistory();
                }
                store.addStrokeHistory(color);
              }}
              className="w-full h-8 rounded cursor-pointer"
            />
            {strokeHistory.length > 0 && (
              <div className="flex gap-1 mt-1">
                {strokeHistory.map((c) => (
                  <button
                    key={c}
                    onClick={() => store.setStrokeColor(c)}
                    className="w-5 h-5 rounded border border-gray-600 shrink-0"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.strokeWidth')}</label>
            <Slider
              min={1}
              max={20}
              step={1}
              value={[strokeWidth]}
              onValueChange={([v]) => {
                const width = v;
                const unlocked = selectedStrokes.filter(id => !isStrokeLocked(id));
                if (unlocked.length > 0) {
                  store.pushHistory();
                  unlocked.forEach(id => {
                    store.updateStrokeNoHistory(id, { strokeWidth: width });
                  });
                }
                store.setStrokeWidth(width);
              }}
              className="w-full"
            />
            <span className="text-xs text-gray-500">{strokeWidth}px</span>
          </div>

          {selectedTextStroke && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">{t('editorIconos.props.text')}</h4>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.content')}</label>
                <textarea
                  value={selectedTextStroke.text ?? ''}
                  onChange={(e) => store.updateStrokeNoHistory(selectedTextStroke.id, { text: e.target.value })}
                  onBlur={() => store.pushHistory()}
                  className="w-full px-2 py-1 bg-gray-900 border-2 border-blue-500 rounded text-white text-xs"
                  rows={2}
                  placeholder="Texto…"
                />
                <div className="text-[10px] text-gray-500 mt-1">
                  Tip: doble-clic en el texto para editar en diálogo.
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">Interior</label>
                  <input
                    type="color"
                    value={(selectedTextStroke.fillColor && selectedTextStroke.fillColor !== 'transparent') ? selectedTextStroke.fillColor : '#000000'}
                    onChange={(e) => {
                      store.pushHistory();
                      store.updateStrokeNoHistory(selectedTextStroke.id, { fillColor: e.target.value });
                    }}
                    className="w-full h-8 rounded cursor-pointer"
                  />
                  <button
                    onClick={() => {
                      store.pushHistory();
                      store.updateStrokeNoHistory(selectedTextStroke.id, { fillColor: 'transparent' });
                    }}
                    className={`mt-1 w-full px-2 py-1 rounded text-[10px] border ${selectedTextStroke.fillColor === 'transparent' ? 'bg-gray-900 border-2 border-blue-500 border-[#00ff00] text-[#00ff00]' : 'bg-gray-900 border-2 border-blue-500 border-gray-600 text-gray-400 hover:bg-gray-800'}`}
                  >
                    Auto
                  </button>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">Borde</label>
                  <input
                    type="color"
                    value={selectedTextStroke.strokeColor}
                    onChange={(e) => {
                      store.pushHistory();
                      store.updateStrokeNoHistory(selectedTextStroke.id, { strokeColor: e.target.value });
                    }}
                    className="w-full h-8 rounded cursor-pointer"
                  />
                  <div className="mt-1">
                    <label className="block text-[10px] text-gray-400 mb-1">Grosor del borde</label>
                    <Slider
                      min={0}
                      max={20}
                      step={1}
                      value={[selectedTextStroke.strokeWidth]}
                      onValueChange={([v]) => {
                        store.pushHistory();
                        store.updateStrokeNoHistory(selectedTextStroke.id, { strokeWidth: v });
                      }}
                      className="w-full"
                    />
                    <span className="text-[10px] text-gray-500">{selectedTextStroke.strokeWidth}px</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.fontSize')}</label>
                <Slider
                  min={4}
                  max={256}
                  step={1}
                  value={[selectedTextStroke.fontSize ?? 24]}
                  onValueChange={([v]) => {
                    store.pushHistory();
                    store.updateStrokeNoHistory(selectedTextStroke.id, { fontSize: v });
                  }}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">{selectedTextStroke.fontSize ?? 24}px</span>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.rotation')}</label>
                <Slider
                  min={-180}
                  max={180}
                  step={1}
                  value={[selectedTextStroke.rotation ?? 0]}
                  onValueChange={([v]) => {
                    store.pushHistory();
                    store.updateStrokeNoHistory(selectedTextStroke.id, { rotation: v });
                  }}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">{Math.round(selectedTextStroke.rotation ?? 0)}°</span>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.fontFamily')}</label>
                  <button
                    type="button"
                    onClick={loadLocalFonts}
                    title={t('editorHTML.text.refreshLocalFonts')}
                    className="mb-1 text-gray-500 hover:text-blue-400 transition-colors"
                  >
                    <ArrowPathIcon className={`w-3.5 h-3.5 ${localFontsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <select
                  value={selectedTextStroke.fontFamily ?? 'sans-serif'}
                  onChange={async (e) => {
                    const value = e.target.value;
                    const lf = localFonts.find((f) => f.family === value);
                    if (lf) await ensureLocalFontFace(lf);
                    store.pushHistory();
                    store.updateStrokeNoHistory(selectedTextStroke.id, { fontFamily: value });
                  }}
                  className="w-full px-2 py-1 bg-gray-900 border-2 border-blue-500 rounded text-white text-xs"
                >
                  <option value="sans-serif\">{t('editorIconos.fonts.sansSerif')}</option>
                  <option value="serif\">{t('editorIconos.fonts.serif')}</option>
                  <option value="monospace\">{t('editorIconos.fonts.monospace')}</option>
                  <option value="Arial">Arial</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Courier New">Courier New</option>
                  {localFonts.length > 0 && (
                    <optgroup label={t('editorHTML.text.localFonts')}>
                      {localFonts.map((f) => (
                        <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <button
                onClick={() => setTextDialog({
                  open: true,
                  point: selectedTextStroke.points[0],
                  value: selectedTextStroke.text ?? '',
                  size: selectedTextStroke.fontSize ?? 24,
                  family: selectedTextStroke.fontFamily ?? 'sans-serif',
                  strokeId: selectedTextStroke.id,
                })}
                className="w-full px-2 py-1 rounded text-xs border bg-gray-900 border-2 border-blue-500 border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                {t('editorIconos.props.editInDialog')}
              </button>
              <button
                onClick={() => {
                  const outlines = convertTextStrokeToOutlines(selectedTextStroke);
                  if (outlines.length > 0) {
                    store.replaceStrokeWith(selectedTextStroke.id, outlines);
                  }
                }}
                className="w-full px-2 py-1 rounded text-xs border bg-gray-900 border-2 border-blue-500 border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                {t('editorIconos.props.convertToOutlines')}
              </button>
              <div className="text-[10px] text-gray-500">
                Convierte las letras en contornos para editar sus vértices con Vertex Pen.
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.gridSize')}</label>
            <Slider
              min={4}
              max={32}
              step={2}
              value={[gridSize]}
              onValueChange={([v]) => store.setGridSize(v)}
              className="w-full"
            />
            <span className="text-xs text-gray-500">{gridSize}px</span>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">{t('editorIconos.props.magnetismo')}</label>
            <button
              onClick={() => store.setSnapEnabled(!snapEnabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${snapEnabled ? 'bg-gray-900 border-2 border-blue-500' : 'bg-gray-900 border-2 border-blue-500'}`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${snapEnabled ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {tool === 'curve' && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Curva</h4>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Cerrar curva (línea inicio→fin)</label>
                <button
                  onClick={() => store.setCurveClosed(!store.curveClosed)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${store.curveClosed ? 'bg-gray-900 border-2 border-blue-500' : 'bg-gray-900 border-2 border-blue-500'}`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${store.curveClosed ? 'translate-x-5' : 'translate-x-1'}`}
                  />
                </button>
              </div>
              <p className="text-[10px] text-gray-500 leading-snug">
                Si está desactivado, la curva queda abierta y no se dibuja el trazo recto entre el primer y el último vértice.
              </p>
            </div>
          )}

          {tool === 'round-corner' && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">{t('editorIconos.props.roundCorner')}</h4>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.radius')}</label>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[cornerRadius]}
                  onValueChange={([v]) => store.setCornerRadius(v)}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">{cornerRadius}px</span>
              </div>
              <div className="flex gap-2">
                {[5, 10, 20, 40].map((r) => (
                  <button
                    key={r}
                    onClick={() => store.setCornerRadius(r)}
                    className={`flex-1 px-2 py-1 rounded text-xs border ${cornerRadius === r ? 'bg-gray-900 border-2 border-blue-500 border-blue-400 text-white' : 'border-gray-600 text-gray-300 hover:bg-gray-800'}`}
                  >
                    {r}px
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.curveQuality')}</label>
                <Slider
                  min={1}
                  max={8}
                  step={1}
                  value={[cornerSegments]}
                  onValueChange={([v]) => store.setCornerSegments(v)}
                  className="w-full"
                />
                <span className="text-xs text-gray-500">{cornerSegments} segment{cornerSegments > 1 ? 's' : ''}</span>
              </div>
              <div className="flex gap-2">
                {[
                  { label: t('editorIconos.props.curveSoft'), s: 1 },
                  { label: t('editorIconos.props.curveMedium'), s: 3 },
                  { label: t('editorIconos.props.curveHigh'), s: 6 },
                ].map((opt) => (
                  <button
                    key={opt.s}
                    onClick={() => store.setCornerSegments(opt.s)}
                    className={`flex-1 px-2 py-1 rounded text-xs border ${cornerSegments === opt.s ? 'bg-gray-900 border-2 border-blue-500 border-blue-400 text-white' : 'border-gray-600 text-gray-300 hover:bg-gray-800'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-700 pt-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-400 uppercase">{t('editorIconos.props.template')}</h4>
            <button
              onClick={() => templateInputRef.current?.click()}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {templateImage ? t('editorIconos.props.changeTemplate') : t('editorIconos.props.loadTemplate')}
            </button>
            <input
              ref={templateInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    store.setTemplateImage(ev.target?.result as string);
                  };
                  reader.readAsDataURL(file);
                }
              }}
              className="hidden"
            />
            {templateImage && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.opacity')}</label>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(templateOpacity * 100)]}
                    onValueChange={([v]) => store.setTemplateOpacity(v / 100)}
                    className="w-full"
                  />
                  <span className="text-xs text-gray-500">{Math.round(templateOpacity * 100)}%</span>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.props.scale')}</label>
                  <Slider
                    min={10}
                    max={500}
                    step={1}
                    value={[Math.round(templateScale * 100)]}
                    onValueChange={([v]) => store.setTemplateScale(v / 100)}
                    className="w-full"
                  />
                  <span className="text-xs text-gray-500">{Math.round(templateScale * 100)}%</span>
                </div>
                <button
                  onClick={() => store.setTemplateImage(null)}
                  className="w-full px-3 py-2 rounded border-2 border-red-400 text-red-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
                >
                  {t('editorIconos.props.removeTemplate')}
                </button>
              </>
            )}
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-2">
            <button
              onClick={store.copyStrokes}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedStrokes.length === 0}
            >
              {t('editorIconos.props.copy')}
            </button>
            <button
              onClick={store.cutStrokes}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedStrokes.length === 0}
            >
              {t('editorIconos.props.cut')}
            </button>
            <button
              onClick={store.pasteStrokes}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={clipboard.length === 0}
            >
              {t('editorIconos.props.paste')}
            </button>
            <button
              onClick={store.deleteSelectedStrokes}
              className="w-full px-3 py-2 rounded border-2 border-red-400 text-red-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedStrokes.length === 0}
            >
              {t('editorIconos.props.delete')}
            </button>
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-2">
            <button
              onClick={store.bringSelectedForward}
              className="w-full px-3 py-2 rounded border-2 border-amber-400 text-amber-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedStrokes.length === 0}
              title="Traer la capa seleccionada al frente (+1)"
            >
              {t('editorIconos.actions.bringForward')}
            </button>
            <button
              onClick={store.sendSelectedBackward}
              className="w-full px-3 py-2 rounded border-2 border-teal-400 text-teal-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={selectedStrokes.length === 0}
              title="Enviar la capa seleccionada atrás (-1)"
            >
              {t('editorIconos.actions.sendBackward')}
            </button>
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-2">
            <button
              onClick={() => setShowSaveDialog(true)}
              className="w-full px-3 py-2 rounded border-2 border-blue-400 text-blue-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.save')}
            </button>
            <button
              onClick={() => {
                if (customLibraries.length === 0) {
                  alert('Primero crea una biblioteca desde el botón de configuración (engranaje).');
                  return;
                }
                setSaveToLibraryName(currentIcon?.title || t('editorIconos.actions.untitled'));
                setSelectedLibraryId(customLibraries[0]?.id || '');
                setShowSaveToLibraryDialog(true);
              }}
              className="w-full px-3 py-2 rounded border-2 border-indigo-400 text-indigo-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.saveToLibrary')}
            </button>
            <button
              onClick={() => setShowLoadDialog(true)}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.load')}
            </button>
            <button
              onClick={handleExport}
              className="w-full px-3 py-2 rounded border-2 border-green-400 text-green-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.exportPng')}
            </button>
            <button
              onClick={() => store.exportAsICO()}
              className="w-full px-3 py-2 rounded border-2 border-cyan-400 text-cyan-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.exportIco')}
            </button>
            <button
              onClick={() => store.copyPNGCode()}
              className="w-full px-3 py-2 rounded border-2 border-green-300 text-green-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.copyPngCode')}
            </button>
            <button
              onClick={() => store.exportAsSVG()}
              className="w-full px-3 py-2 rounded border-2 border-purple-400 text-purple-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.exportSvg')}
            </button>
            <button
              onClick={() => store.copyAsJSON()}
              className="w-full px-3 py-2 rounded border-2 border-yellow-400 text-yellow-300 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.copyJson')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 text-gray-200 bg-gradient-to-b from-white/10 to-transparent hover:from-white/20 text-sm"
            >
              {t('editorIconos.actions.importPng')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png"
              onChange={handleImport}
              className="hidden"
            />
            {/* Control de nivel de detalle para importar PNG */}
            <div className="mt-2 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">{t('editorIconos.props.quality')}</span>
                <span className="text-xs text-blue-400 font-mono">{importDetailLevel}%</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[importDetailLevel]}
                onValueChange={([v]) => setImportDetailLevel(v)}
                className="w-full"
                aria-label="Nivel de detalle al importar PNG"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                {importDetailLevel < 30
                  ? t('editorIconos.props.qualityLow')
                  : importDetailLevel > 80
                    ? t('editorIconos.props.qualityHigh')
                    : t('editorIconos.props.qualityMedium')}
              </p>
            </div>
          </div>
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
          <div className="h-10 w-full opacity-0 pointer-events-none shrink-0" />
        </div>
        </div>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border-2 border-blue-500 p-6 rounded-lg w-96">
            <h2 className="text-lg font-semibold mb-4">{t('editorIconos.dialog.saveIcon')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('editorIconos.dialog.title')}</label>
                <input
                  type="text"
                  value={iconTitle}
                  onChange={(e) => setIconTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  placeholder={t('editorIconos.dialog.iconTitlePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('editorIconos.dialog.description')}</label>
                <textarea
                  value={iconDescription}
                  onChange={(e) => setIconDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  placeholder={t('editorIconos.dialog.iconDescriptionPlaceholder')}
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-gray-800"
                >
                  {t('editorIconos.dialog.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-blue-500"
                >
                  {t('editorIconos.actions.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Text Tool Dialog */}
      {textDialog?.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border-2 border-blue-500 p-6 rounded-lg w-96">
            <h2 className="text-lg font-semibold mb-4">{textDialog.strokeId ? t('editorIconos.dialog.editText') : t('editorIconos.dialog.addText')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">{t('editorIconos.props.text')}</label>
                <textarea
                  value={textDialog.value}
                  onChange={(e) => setTextDialog(d => d ? { ...d, value: e.target.value } : d)}
                  className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  placeholder="Escribe el texto…"
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.dialog.size')}</label>
                  <input
                    type="number"
                    min={1}
                    max={512}
                    value={textDialog.size}
                    onChange={(e) => setTextDialog(d => d ? { ...d, size: Number(e.target.value) || 1 } : d)}
                    className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">{t('editorIconos.dialog.font')}</label>
                  <select
                    value={textDialog.family}
                    onChange={(e) => setTextDialog(d => d ? { ...d, family: e.target.value } : d)}
                    className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  >
                    <option value="sans-serif\">{t('editorIconos.fonts.sansSerif')}</option>
                    <option value="serif\">{t('editorIconos.fonts.serif')}</option>
                    <option value="monospace\">{t('editorIconos.fonts.monospace')}</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                  </select>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Color usa el Stroke Color actual ({strokeColor}).
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setTextDialog(null)}
                  className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-gray-800"
                >
                  {t('editorIconos.dialog.cancel')}
                </button>
                <button
                  onClick={() => {
                    if (!textDialog || !textDialog.value.trim()) return;
                    const s = useAppStore.getState().getActiveState();
                    if (textDialog.strokeId) {
                      s.updateStroke(textDialog.strokeId, {
                        text: textDialog.value,
                        fontSize: textDialog.size,
                        fontFamily: textDialog.family,
                      });
                    } else {
                      const newStroke: Stroke = {
                        id: uuidv4(),
                        points: [textDialog.point],
                        fillColor: s.fillColor,
                        strokeColor: s.strokeColor,
                        strokeWidth: s.strokeWidth,
                        type: 'line',
                        shapeType: 'text',
                        text: textDialog.value,
                        fontSize: textDialog.size,
                        fontFamily: textDialog.family,
                      };
                      s.addStroke(newStroke);
                    }
                    setTextDialog(null);
                  }}
                  className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-blue-500"
                >
                  {textDialog.strokeId ? t('editorIconos.dialog.save') : t('editorIconos.dialog.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save to Library Dialog */}
      {showSaveToLibraryDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border-2 border-blue-500 p-6 rounded-lg w-96">
            <h2 className="text-lg font-semibold mb-4">Guardar en biblioteca</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Biblioteca</label>
                <select
                  value={selectedLibraryId}
                  onChange={(e) => setSelectedLibraryId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                >
                  {customLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nombre del icono</label>
                <input
                  type="text"
                  value={saveToLibraryName}
                  onChange={(e) => setSaveToLibraryName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded text-white"
                  placeholder="Nombre del icono"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setShowSaveToLibraryDialog(false)}
                  className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (!selectedLibraryId || !saveToLibraryName.trim() || !currentIcon) return;
                    saveIconToLibrary(selectedLibraryId, {
                      name: saveToLibraryName.trim(),
                      // Excluir vértices sueltos (1 punto sin shapeType): no son
                      // parte del dibujo y, si están lejos, inflan el bbox de la
                      // vista previa y hacen que el icono se vea diminuto.
                      strokes: currentIcon.layers
                        .flatMap(l => l.strokes)
                        .filter(s => s.points.length >= 2 || s.shapeType === 'text'),
                    });
                    setShowSaveToLibraryDialog(false);
                    setSaveToLibraryName('');
                  }}
                  className="px-4 py-2 bg-indigo-600 rounded hover:bg-indigo-500"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-gray-900 border-2 border-blue-500 p-6 rounded-lg w-96">
            <h2 className="text-lg font-semibold mb-4">{t('editorIconos.dialog.loadIcon')}</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-900 border-2 border-blue-500 [&::-webkit-scrollbar-track]:bg-transparent">
              {icons.length === 0 ? (
                <p className="text-gray-400 text-sm">{t('editorIconos.dialog.noSavedIcons')}</p>
              ) : (
                icons.map(icon => (
                  <div
                    key={icon.id}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-2 border-blue-500 rounded"
                  >
                    {confirmDeleteId === icon.id ? (
                      <>
                        <span className="text-sm text-red-300 flex-1">{t('editorIconos.dialog.confirmDelete')}</span>
                        <button
                          onClick={() => {
                            store.deleteIcon(icon.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2 py-1 text-sm bg-red-600 rounded hover:bg-red-500"
                        >
                          {t('editorIconos.dialog.yes')}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-sm bg-gray-900 border-2 border-blue-500 rounded hover:bg-gray-500"
                        >
                          {t('editorIconos.dialog.no')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleLoad(icon.id)}
                          className="flex-1 text-left hover:bg-gray-800 rounded px-2 py-1"
                        >
                          <div className="font-medium">{icon.title || t('editorIconos.actions.untitled')}</div>
                          <div className="text-xs text-gray-400">{icon.description}</div>
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(icon.id)}
                          className="px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
                          title={t('editorIconos.dialog.deleteIcon')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => {
                  setConfirmDeleteId(null);
                  setShowLoadDialog(false);
                }}
                className="px-4 py-2 bg-gray-900 border-2 border-blue-500 rounded hover:bg-gray-800"
              >
                {t('editorIconos.dialog.close')}
              </button>
            </div>
          </div>
        </div>
      )}

    
    </div>
  );
}