import type { Point, Stroke } from '@/store/app-store';

// Bounds aproximados de un trazo de texto (ancla en points[0], baseline 'top').
// Sin acceso a un contexto de canvas para medir, se estima el ancho con un
// factor promedio por glifo. Suficiente para hit-test, selección y export.
export function getTextBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number } {
  const anchor = stroke.points[0] ?? { x: 0, y: 0 };
  const fontSize = stroke.fontSize ?? 24;
  const lines = (stroke.text ?? '').split('\n');
  const lineHeight = fontSize * 1.2;
  let width = 0;
  for (const line of lines) {
    const w = line.length * fontSize * 0.55;
    if (w > width) width = w;
  }
  return {
    minX: anchor.x,
    minY: anchor.y,
    maxX: anchor.x + width,
    maxY: anchor.y + lines.length * lineHeight,
  };
}

export function traceBody(ctx: CanvasRenderingContext2D, pts: Point[], type: 'line' | 'curve') {
  if (type === 'curve') {
    if (pts.length === 3) {
      ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    } else if (pts.length === 2) {
      const p0 = pts[0];
      const p1 = pts[1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(midX - dy * 0.3, midY + dx * 0.3, p1.x, p1.y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
  } else {
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.shapeType === 'text') {
    const anchor = stroke.points[0];
    if (!anchor || !stroke.text) return;
    const fontSize = stroke.fontSize ?? 24;
    const fontFamily = stroke.fontFamily ?? 'sans-serif';
    const lineHeight = fontSize * 1.2;
    const rotation = stroke.rotation ?? 0;
    // Centro del texto: giramos sobre él para que rote "sobre sí mismo"
    const b = getTextBounds(stroke);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (rotation !== 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    // Interior: fillColor si está definido (no transparente); si no, usa strokeColor
    // para mantener compatibilidad con textos creados antes de esta función.
    const hasInterior = stroke.fillColor && stroke.fillColor !== 'transparent';
    const interiorColor = hasInterior ? stroke.fillColor : stroke.strokeColor;
    const borderColor = stroke.strokeColor;
    const borderWidth = stroke.strokeWidth ?? 0;
    const lines = stroke.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const y = anchor.y + i * lineHeight;
      // Borde primero (debajo) para que no cubra el interior
      if (borderWidth > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        ctx.lineJoin = 'round';
        ctx.strokeText(lines[i], anchor.x, y);
      }
      ctx.fillStyle = interiorColor;
      ctx.fillText(lines[i], anchor.x, y);
    }
    if (rotation !== 0) ctx.restore();
    return;
  }

  if (stroke.points.length < 2) return;

  const hasFill = stroke.fillColor !== 'transparent';
  const hasHoles = stroke.holes && stroke.holes.length > 0;

  if (stroke.shapeType === 'circle') {
    const [c, rPt] = stroke.points;
    const radius = Math.hypot(rPt.x - c.x, rPt.y - c.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    if (hasFill) {
      ctx.fillStyle = stroke.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = stroke.strokeColor;
    ctx.lineWidth = stroke.strokeWidth;
    ctx.stroke();
    return;
  }

  if (stroke.shapeType === 'rectangle') {
    const pts = stroke.points.length >= 4
      ? stroke.points
      : (() => {
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
        })();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
    if (hasFill) {
      ctx.fillStyle = stroke.fillColor;
      ctx.fill();
    }
    ctx.strokeStyle = stroke.strokeColor;
    ctx.lineWidth = stroke.strokeWidth;
    ctx.stroke();
    return;
  }

  if (hasFill) {
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    traceBody(ctx, stroke.points, stroke.type);
    // Las curvas abiertas no cierran el path con una línea recta entre
    // el primer y el último vértice (el cierre lo hace fill() de forma implícita).
    if (shouldClose(stroke)) ctx.closePath();
    if (hasHoles) {
      for (const hole of stroke.holes!) {
        if (hole.length < 2) continue;
        ctx.moveTo(hole[0].x, hole[0].y);
        traceBody(ctx, hole, stroke.type);
        if (shouldClose(stroke)) ctx.closePath();
      }
      ctx.fillStyle = stroke.fillColor;
      ctx.fill('evenodd');
    } else {
      ctx.fillStyle = stroke.fillColor;
      ctx.fill();
    }
  }

  // Borde: se traza el contorno exterior Y los huecos, para que el borde
  // interior de las letras (y de los iconos importados con huecos) no
  // desaparezca. Los huecos se incluyen en el mismo path del stroke.
  if (stroke.strokeWidth > 0 && stroke.strokeColor !== 'transparent') {
    ctx.strokeStyle = stroke.strokeColor;
    ctx.lineWidth = stroke.strokeWidth;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    traceBody(ctx, stroke.points, stroke.type);
    if (shouldClose(stroke)) ctx.closePath();
    if (hasHoles) {
      for (const hole of stroke.holes!) {
        if (hole.length < 2) continue;
        ctx.moveTo(hole[0].x, hole[0].y);
        traceBody(ctx, hole, stroke.type);
        if (shouldClose(stroke)) ctx.closePath();
      }
    }
    ctx.stroke();
  }
}

function shouldClose(stroke: Stroke): boolean {
  return stroke.type !== 'curve' || !!stroke.closed;
}
