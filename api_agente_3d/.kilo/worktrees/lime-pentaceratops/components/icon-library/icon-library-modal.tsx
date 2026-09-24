import React, { useState, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/modal';
import { useIconLibraryContext, SavedIcon, CustomLibrary } from '@/context/icon-library-context';
import { availableLibraries } from '@/lib/icon-libraries';
import { svgElementToStrokes, normalizeScaleAndCenterStrokes, centerStrokes } from '@/lib/svg-to-strokes';
import { addStrokeToEditor } from '@/lib/editor-bridge';
import useAppStore, { type Stroke } from '@/store/app-store';
import { Search, Loader2, Minus, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { getTextBounds } from '@/lib/draw-stroke';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bounds de un stroke de texto (o null si no aplica). Necesario porque un stroke
// de texto sólo guarda el ancla en `points`, no el contorno: sin esto la vista
// previa calcula bbox 0 y no dibuja nada.
function textStrokeBounds(stroke: Stroke) {
  if (stroke.shapeType !== 'text' || !stroke.points[0] || !stroke.text) return null;
  return getTextBounds(stroke);
}

interface IconLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LoadedIcon {
  name: string;
  component: React.ReactNode;
}

interface LibraryIconsProps {
  sourceLibraryId: string;
  search: string;
  detailLevel: number;
  onSelect: (iconName: string, libraryId: string, svgElement?: SVGElement) => void;
}

function LibraryIcons({ sourceLibraryId, search, detailLevel, onSelect }: LibraryIconsProps) {
  const [icons, setIcons] = useState<LoadedIcon[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const def = availableLibraries.find((lib) => lib.id === sourceLibraryId);
      if (!def) {
        setIcons([]);
        setLoading(false);
        return;
      }

      try {
        const names = await def.getIconNames();
        const loaded: LoadedIcon[] = [];

        for (const name of names) {
          if (cancelled) return;
          const Component = await def.getIconComponent(name);
          if (Component) {
            loaded.push({
              name,
              component: <Component className="h-10 w-10 text-white" />,
            });
          }
        }

        if (!cancelled) {
          setIcons(loaded);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setIcons([]);
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sourceLibraryId]);

  const filteredIcons = search.trim()
    ? icons.filter((icon) =>
        icon.name.toLowerCase().includes(search.toLowerCase())
      )
    : icons;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Cargando iconos…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3 max-h-[70vh] overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
      {filteredIcons.length === 0 ? (
        <div className="col-span-full flex items-center justify-center py-8 text-sm text-muted-foreground">
          {search.trim()
            ? 'No se encontraron iconos que coincidan con la búsqueda.'
            : 'No se pudieron cargar los iconos de esta librería.'}
        </div>
      ) : (
        filteredIcons.map((icon) => (
          <div
            key={icon.name}
            className="group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-6 hover:bg-gray-700 transition-colors cursor-pointer"
            title={icon.name}
            onClick={(e) => {
              const svg = (e.currentTarget as HTMLElement)?.querySelector('svg');
              onSelect(icon.name, sourceLibraryId, svg ?? undefined);
            }}
          >
            <span className="h-14 w-14 flex items-center justify-center">
              {icon.component}
            </span>
            <span className="text-xs leading-tight truncate w-full text-center text-gray-300">
              {icon.name}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function StrokePreview({ strokes }: { strokes: SavedIcon['strokes'] }) {
  if (!strokes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    // Ignorar vértices sueltos (1 punto sin shapeType): no son parte del dibujo
    // y, si están lejos, inflan el bbox y hacen que la vista previa se vea diminuta.
    if (s.points.length < 2 && s.shapeType !== 'text') continue;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (s.holes) {
      for (const hole of s.holes) {
        for (const p of hole) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
    const tb = textStrokeBounds(s);
    if (tb) {
      if (tb.minX < minX) minX = tb.minX;
      if (tb.minY < minY) minY = tb.minY;
      if (tb.maxX > maxX) maxX = tb.maxX;
      if (tb.maxY > maxY) maxY = tb.maxY;
    }
  }
  const pad = 2;
  const w = (maxX - minX) + pad * 2;
  const h = (maxY - minY) + pad * 2;
  const ox = -minX + pad;
  const oy = -minY + pad;

  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
    return (
      <svg width="100%" height="100%" viewBox="0 0 24 24">
        <rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="#9ca3af" strokeWidth="1" />
        <line x1="2" y1="2" x2="22" y2="22" stroke="#9ca3af" strokeWidth="1" />
      </svg>
    );
  }

  function pointsToD(pts: { x: number; y: number }[], close: boolean): string {
    if (!pts.length) return '';
    let d = `M ${pts[0].x + ox} ${pts[0].y + oy}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x + ox} ${pts[i].y + oy}`;
    }
    if (close) d += ' Z';
    return d;
  }

  const isClosed = (stroke: Stroke) => {
    if (stroke.points.length < 3) return false;
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    return Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5;
  };

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg">
      {strokes.map((stroke) => {
        if (!stroke.points.length) return null;

        // Texto nativo: un stroke de texto sólo guarda el ancla en `points`,
        // hay que emitir un <text> para que se vea en la vista previa.
        if (stroke.shapeType === 'text' && stroke.points[0] && stroke.text) {
          const anchor = stroke.points[0];
          const fontSize = stroke.fontSize ?? 24;
          const fontFamily = stroke.fontFamily ?? 'sans-serif';
          const rotation = stroke.rotation ?? 0;
          const lines = stroke.text.split('\n');
          const lineHeight = fontSize * 1.2;
          const tb = getTextBounds(stroke);
          const cx = (tb.minX + tb.maxX) / 2 + ox;
          const cy = (tb.minY + tb.maxY) / 2 + oy;
          const transform = rotation !== 0 ? `rotate(${rotation} ${cx} ${cy})` : undefined;
          const hasInterior = stroke.fillColor && stroke.fillColor !== 'transparent';
          const interiorColor = hasInterior ? stroke.fillColor : stroke.strokeColor;
          const borderWidth = stroke.strokeWidth ?? 0;
          return (
            <g key={stroke.id} transform={transform}>
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={anchor.x + ox}
                  y={anchor.y + oy + i * lineHeight + fontSize}
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  fill={interiorColor}
                  stroke={borderWidth > 0 ? stroke.strokeColor : undefined}
                  strokeWidth={borderWidth > 0 ? borderWidth : undefined}
                  paintOrder="stroke"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        }

        const strokeColor = stroke.strokeColor && stroke.strokeColor !== 'transparent' ? stroke.strokeColor : 'none';
        const sw = stroke.strokeWidth || 1;

        // Círculo nativo
        if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
          const [c, rPt] = stroke.points;
          const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
          const fill = stroke.fillColor && stroke.fillColor !== 'transparent' ? stroke.fillColor : 'none';
          const holes = stroke.holes || [];
          if (holes.length === 0) {
            return (
              <circle
                key={stroke.id}
                cx={c.x + ox}
                cy={c.y + oy}
                r={r}
                fill={fill}
                stroke={strokeColor !== 'none' ? strokeColor : '#e5e7eb'}
                strokeWidth={strokeColor !== 'none' ? sw : 1.5}
              />
            );
          }
          let d = pointsToD(stroke.points, true);
          for (const hole of holes) {
            if (hole.length >= 2) d += ' ' + pointsToD(hole, true);
          }
          return (
            <path
              key={stroke.id}
              d={d}
              fill={fill}
              stroke={strokeColor !== 'none' ? strokeColor : '#e5e7eb'}
              strokeWidth={strokeColor !== 'none' ? sw : 1.5}
              fillRule="evenodd"
            />
          );
        }

        const closed = isClosed(stroke);
        const hasFill = stroke.fillColor && stroke.fillColor !== 'transparent';
        const fill = closed && hasFill ? stroke.fillColor : 'none';

        let d = pointsToD(stroke.points, closed);

        // Añadir holes si el stroke es cerrado y tiene fill
        if (closed && hasFill && stroke.holes && stroke.holes.length > 0) {
          for (const hole of stroke.holes) {
            if (hole.length >= 2) {
              d += ' ' + pointsToD(hole, true);
            }
          }
          return (
            <path
              key={stroke.id}
              d={d}
              fill={fill}
              stroke={strokeColor !== 'none' ? strokeColor : '#e5e7eb'}
              strokeWidth={strokeColor !== 'none' ? sw : 1.5}
              fillRule="evenodd"
            />
          );
        }

        return (
          <path
            key={stroke.id}
            d={d}
            fill={fill}
            stroke={strokeColor !== 'none' ? strokeColor : '#e5e7eb'}
            strokeWidth={strokeColor !== 'none' ? sw : 1.5}
          />
        );
      })}
    </svg>
  );
}

function strokesToSvgString(strokes: SavedIcon['strokes'], targetW?: number, targetH?: number): string {
  if (!strokes.length) return '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    // Ignorar vértices sueltos (1 punto sin shapeType) para no inflar el bbox.
    if (s.points.length < 2 && s.shapeType !== 'text') continue;
    const pts = s.points;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (s.holes) {
      for (const hole of s.holes) {
        for (const p of hole) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
    const tb = textStrokeBounds(s);
    if (tb) {
      if (tb.minX < minX) minX = tb.minX;
      if (tb.minY < minY) minY = tb.minY;
      if (tb.maxX > maxX) maxX = tb.maxX;
      if (tb.maxY > maxY) maxY = tb.maxY;
    }
  }
  const pad = 4;
  const bboxW = (maxX - minX) + pad * 2;
  const bboxH = (maxY - minY) + pad * 2;
  const ox = -minX + pad;
  const oy = -minY + pad;

  const w = targetW && targetW > 0 ? targetW : bboxW;
  const h = targetH && targetH > 0 ? targetH : bboxH;

  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return '';

  function pointsToD(pts: { x: number; y: number }[], close: boolean): string {
    if (!pts.length) return '';
    let d = `M ${pts[0].x + ox} ${pts[0].y + oy}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x + ox} ${pts[i].y + oy}`;
    }
    if (close) d += ' Z';
    return d;
  }

  const isClosed = (stroke: Stroke) => {
    if (stroke.points.length < 3) return false;
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    return Math.abs(first.x - last.x) < 0.5 && Math.abs(first.y - last.y) < 0.5;
  };

  const paths = strokes.map((stroke) => {
    if (!stroke.points.length) return '';

    // Texto nativo: emitir <text> (un stroke de texto sólo guarda el ancla).
    if (stroke.shapeType === 'text' && stroke.points[0] && stroke.text) {
      const anchor = stroke.points[0];
      const fontSize = stroke.fontSize ?? 24;
      const fontFamily = stroke.fontFamily ?? 'sans-serif';
      const rotation = stroke.rotation ?? 0;
      const lines = stroke.text.split('\n');
      const lineHeight = fontSize * 1.2;
      const tb = getTextBounds(stroke);
      const cx = (tb.minX + tb.maxX) / 2 + ox;
      const cy = (tb.minY + tb.maxY) / 2 + oy;
      const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';
      const hasInterior = stroke.fillColor && stroke.fillColor !== 'transparent';
      const interiorColor = hasInterior ? stroke.fillColor : stroke.strokeColor;
      const borderWidth = stroke.strokeWidth ?? 0;
      const strokeAttrs = borderWidth > 0
        ? ` stroke="${stroke.strokeColor}" stroke-width="${borderWidth}" paint-order="stroke"`
        : '';
      let txt = '';
      for (let i = 0; i < lines.length; i++) {
        txt += `<text x="${anchor.x + ox}" y="${anchor.y + oy + i * lineHeight + fontSize}" font-family="${fontFamily}" font-size="${fontSize}" fill="${interiorColor}"${strokeAttrs}${transform}>${escapeXml(lines[i])}</text>`;
      }
      return txt;
    }

    const strokeColor = stroke.strokeColor && stroke.strokeColor !== 'transparent' ? stroke.strokeColor : '#e5e7eb';
    const sw = stroke.strokeWidth || 1.5;

    // Círculo nativo
    if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
      const [c, rPt] = stroke.points;
      const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
      const fill = stroke.fillColor && stroke.fillColor !== 'transparent' ? stroke.fillColor : 'none';
      const holes = stroke.holes || [];
      if (holes.length === 0) {
        return `<circle cx="${c.x + ox}" cy="${c.y + oy}" r="${r}" fill="${fill}" stroke="${strokeColor}" stroke-width="${sw}" />`;
      }
      // Con holes: usar path
      let d = pointsToD(stroke.points, true);
      for (const hole of holes) {
        d += ' ' + pointsToD(hole, true);
      }
      return `<path d="${d}" fill="${fill}" stroke="${strokeColor}" stroke-width="${sw}" fill-rule="evenodd" />`;
    }

    const closed = isClosed(stroke);
    const hasFill = stroke.fillColor && stroke.fillColor !== 'transparent';
    const fill = closed && hasFill ? stroke.fillColor : 'none';

    let d = pointsToD(stroke.points, closed);

    // Añadir holes si el stroke es cerrado y tiene fill
    if (closed && hasFill && stroke.holes && stroke.holes.length > 0) {
      for (const hole of stroke.holes) {
        if (hole.length >= 2) {
          d += ' ' + pointsToD(hole, true);
        }
      }
      return `<path d="${d}" fill="${fill}" stroke="${strokeColor}" stroke-width="${sw}" fill-rule="evenodd" />`;
    }

    return `<path d="${d}" fill="${fill}" stroke="${strokeColor}" stroke-width="${sw}" />`;
  }).join('');

  // viewBox = espacio de coordenadas del contenido (bbox); width/height =
  // tamaño de display. Así, al pedir un target (p.ej. 512), el contenido se
  // escala preservando aspecto (preserveAspectRatio por defecto) en vez de
  // quedar diminuto en una esquina.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${bboxW} ${bboxH}">${paths}</svg>`;
}

function strokesToSvgDataUrl(strokes: SavedIcon['strokes']): string {
  const svgStr = strokesToSvgString(strokes, 512, 512);
  if (!svgStr) return '';
  const base64 = typeof window !== 'undefined'
    ? window.btoa(unescape(encodeURIComponent(svgStr)))
    : '';
  return `data:image/svg+xml;base64,${base64}`;
}

function CustomLibraryIcons({
  library,
  onSelect,
  onDelete,
}: {
  library: CustomLibrary;
  onSelect: (icon: SavedIcon) => void;
  onDelete: (iconId: string) => void;
}) {
  if (library.icons.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500 italic">
        Esta biblioteca está vacía. Guarda iconos desde el editor para verlos aquí.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3 max-h-[70vh] overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
      {library.icons.map((icon) => (
        <div
          key={icon.id}
          className="group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-6 hover:bg-gray-700 transition-colors cursor-pointer"
          title={icon.name}
          onClick={() => onSelect(icon)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(icon.id);
            }}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-red-600/80 hover:bg-red-500 text-white transition-opacity z-10"
            title="Borrar icono"
          >
            <X className="h-3 w-3" />
          </button>
          <span className="h-14 w-14 flex items-center justify-center">
            <StrokePreview strokes={icon.strokes} />
          </span>
          <span className="text-xs leading-tight truncate w-full text-center text-gray-300">
            {icon.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * IconLibraryModal - Modal que muestra todas las bibliotecas de iconos importadas
 * y las personalizadas del usuario en pestañas separadas.
 */
export const IconLibraryModal: React.FC<IconLibraryModalProps> = ({ open, onOpenChange }) => {
  const iconLibraryContext = useIconLibraryContext();
  const systemLibraries = iconLibraryContext?.systemLibraries ?? [];
  const customLibraries = iconLibraryContext?.customLibraries ?? [];
  const removeIconFromLibrary = iconLibraryContext?.removeIconFromLibrary ?? (() => {});
  const [search, setSearch] = useState('');
  const [detailLevel, setDetailLevel] = useState(50);
  const [confirmDelete, setConfirmDelete] = useState<{ libraryId: string; iconId: string; iconName: string } | null>(null);

  const allLibraries = useMemo(() => {
    return [
      ...systemLibraries.map((lib) => ({ type: 'system' as const, ...lib })),
      ...customLibraries.map((lib) => ({ type: 'custom' as const, ...lib })),
    ];
  }, [systemLibraries, customLibraries]);

  const svgToPngDataUrl = (svg: SVGElement): Promise<string> => {
    return new Promise((resolve, reject) => {
      const serializer = new XMLSerializer();
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute('width', '512');
      clone.setAttribute('height', '512');
      clone.style.color = '#ffffff';
      const svgStr = serializer.serializeToString(clone);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('No se pudo obtener contexto 2D'));
          return;
        }
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 512, 512);
        ctx.drawImage(img, 0, 0, 512, 512);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Error cargando SVG'));
      };
      img.src = url;
    });
  };

  const handleSystemIconSelect = async (iconName: string, libraryId: string, svgElement?: SVGElement) => {
    if (!svgElement) {
      console.warn('No se encontró el SVG del icono:', iconName);
      onOpenChange(false);
      return;
    }

    try {
      const refDataUrl = await svgToPngDataUrl(svgElement);
      useAppStore.getState().setReferenceImage(refDataUrl, iconName);

      const strokes = await svgElementToStrokes(svgElement, {
        detailLevel,
      });
      if (strokes.length === 0) {
        console.warn('No se pudieron extraer trazos del icono:', iconName);
        onOpenChange(false);
        return;
      }

      const centered = normalizeScaleAndCenterStrokes(strokes, 600, 980, 600);
      addStrokeToEditor(centered);
      useAppStore.getState().renameActiveTab(iconName);
    } catch (err) {
      console.error('Error insertando icono en el editor:', err);
    }

    onOpenChange(false);
  };

  const handleCustomIconSelect = (icon: SavedIcon) => {
    try {
      // Preservar el tamaño original del icono (sólo centrar en el canvas).
      // Antes se usaba normalizeScaleAndCenterStrokes, que reescalaba a 600px
      // de ancho y hacía que al reutilizar el icono no fuera idéntico al
      // guardado ("movía una medida").
      const centered = centerStrokes(icon.strokes, 980, 600);
      addStrokeToEditor(centered);
      const dataUrl = strokesToSvgDataUrl(icon.strokes);
      useAppStore.getState().setReferenceImage(dataUrl, icon.name);
      useAppStore.getState().renameActiveTab(icon.name);
    } catch (err) {
      console.error('Error insertando icono personalizado:', err);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={open} onClose={() => onOpenChange(false)} size="2xl">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4 text-foreground">Biblioteca de Iconos</h2>

        {/* Barra de búsqueda global */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar iconos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Control de nivel de detalle (vértices) */}
        <div className="mb-5 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-200 flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-400" />
              Nivel de detalle
            </span>
            <span className="text-sm text-blue-400 font-mono">{detailLevel}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 text-gray-500 shrink-0" />
            <Slider
              value={[detailLevel]}
              onValueChange={(v) => setDetailLevel(v[0])}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
            <Plus className="h-4 w-4 text-gray-500 shrink-0" />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {detailLevel < 30
              ? 'Muy simplificado: pocos vértices, formas suaves.'
              : detailLevel > 80
                ? 'Máximo detalle: muchos vértices, alta resolución.'
                : 'Detalle medio: equilibrio entre suavidad y precisión.'}
          </p>
        </div>

        {allLibraries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
            <p>Aún no has importado ninguna biblioteca de iconos.</p>
            <p>Usa el botón de configuración para añadir una.</p>
          </div>
        ) : (
          <Tabs defaultValue={allLibraries[0]?.id}>
            <TabsList>
              {allLibraries.map((lib) => (
                <TabsTrigger key={lib.id} value={lib.id}>
                  {lib.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {allLibraries.map((lib) => (
              <TabsContent key={lib.id} value={lib.id}>
                {'type' in lib && lib.type === 'system' ? (
                  <LibraryIcons
                    sourceLibraryId={lib.sourceLibraryId}
                    search={search}
                    detailLevel={detailLevel}
                    onSelect={handleSystemIconSelect}
                  />
                ) : (
                  <CustomLibraryIcons
                    library={lib as CustomLibrary}
                    onSelect={handleCustomIconSelect}
                    onDelete={(iconId) => {
                      const icon = (lib as CustomLibrary).icons.find((i) => i.id === iconId);
                      if (icon) {
                        setConfirmDelete({ libraryId: lib.id, iconId, iconName: icon.name });
                      }
                    }}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
      {/* Diálogo de confirmación de borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-lg border border-gray-600 bg-gray-900 p-6 shadow-2xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">Borrar icono</h3>
            <p className="text-sm text-gray-300 mb-6">
              ¿Seguro que quieres borrar <strong className="text-white">{confirmDelete.iconName}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded text-sm text-gray-300 hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  removeIconFromLibrary(confirmDelete.libraryId, confirmDelete.iconId);
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-500 transition-colors"
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default IconLibraryModal;
