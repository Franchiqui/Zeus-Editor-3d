import fs from 'fs';

const FILE = 'components/editor/EditorFuentes.tsx';
// Normaliza finales de línea (el archivo tiene mezcla de LF y CRLF) para que
// todos los anclas con \n coincidan.
let src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

const reps = [];

// R1: importar icono Brush
reps.push({
  name: 'R1-import-Brush',
  from: `  Type,
  ExternalLink,
} from 'lucide-react';`,
  to: `  Type,
  ExternalLink,
  Brush,
} from 'lucide-react';`,
});

// R2: tipo Tool
reps.push({
  name: 'R2-tool-type',
  from: `type Tool = 'select' | 'pen' | 'line' | 'rect' | 'circle' | 'curve' | 'erase' | 'hand' | 'scale' | 'connect' | 'paint' | 'fillzone';`,
  to: `type Tool = 'select' | 'pen' | 'line' | 'rect' | 'circle' | 'curve' | 'erase' | 'hand' | 'scale' | 'connect' | 'paint' | 'fillzone' | 'brush';`,
});

// R3: estado del store (tipo)
reps.push({
  name: 'R3-store-type',
  from: `  paintColor: string;
  gridEnabled: boolean;`,
  to: `  paintColor: string;
  // Pincel: forma de la punta (redonda = curvas al girar, cuadrada = esquinas) y grueso del trazo.
  brushShape: 'round' | 'square';
  brushWidth: number;
  setBrushShape: (shape: 'round' | 'square') => void;
  setBrushWidth: (width: number) => void;
  gridEnabled: boolean;`,
});

// R4: estado del store (defaults + setters)
reps.push({
  name: 'R4a-store-defaults',
  from: `  paintColor: '#f59e0b',
  gridEnabled: true,`,
  to: `  paintColor: '#f59e0b',
  brushShape: 'round',
  brushWidth: 40,
  gridEnabled: true,`,
});
reps.push({
  name: 'R4b-store-setters',
  from: `  setPaintColor: (paintColor) => set({ paintColor }),`,
  to: `  setPaintColor: (paintColor) => set({ paintColor }),
  setBrushShape: (brushShape) => set({ brushShape }),
  setBrushWidth: (brushWidth) => set({ brushWidth: clamp(brushWidth, 4, 300) }),`,
});

// R5: botón en la fila de herramientas
reps.push({
  name: 'R5-tool-button',
  from: `  { id: 'pen', icon: <PenLine className="w-4 h-4" />, label: 'Pen' },`,
  to: `  { id: 'pen', icon: <PenLine className="w-4 h-4" />, label: 'Pen' },
  { id: 'brush', icon: <Brush className="w-4 h-4" />, label: 'Pincel (trazo a contorno)' },`,
});

// R6: controles del pincel en fila 2 del toolbar
reps.push({
  name: 'R6-brush-controls',
  from: `          className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        />
        {store.tool === 'paint' && (`,
  to: `          className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        />
        {store.tool === 'brush' && (
          <>
            <div className="w-px h-6 bg-gray-700 mx-1" />
            <label className="text-xs text-purple-300 ml-1">Pincel</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-700 shrink-0">
              <button
                onClick={() => store.setBrushShape('round')}
                className={cn('px-2 py-1 text-xs font-semibold', store.brushShape === 'round' ? 'bg-purple-600 text-white' : 'bg-gray-900 text-gray-300')}
                title="Punta redonda: al girar el trazo hace curvas y las tapas son redondas (bolígrafo)"
              >Redondo</button>
              <button
                onClick={() => store.setBrushShape('square')}
                className={cn('px-2 py-1 text-xs font-semibold', store.brushShape === 'square' ? 'bg-purple-600 text-white' : 'bg-gray-900 text-gray-300')}
                title="Punta cuadrada: al girar el trazo hace esquinas rectas y las tapas son cuadradas (lápiz)"
              >Cuadrado</button>
            </div>
            <label className="text-xs text-gray-400 ml-1">Grueso</label>
            <input
              type="range"
              min="4"
              max="300"
              value={store.brushWidth}
              onChange={(e) => store.setBrushWidth(parseInt(e.target.value) || 40)}
              className="w-24 accent-purple-500"
            />
            <input
              type="number"
              min="4"
              max="300"
              value={store.brushWidth}
              onChange={(e) => store.setBrushWidth(clamp(parseInt(e.target.value) || 40, 4, 300))}
              className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            />
          </>
        )}
        {store.tool === 'paint' && (`,
});

// R7: guardar ajustes del pincel en el JSON
reps.push({
  name: 'R7-save-json',
  from: `const data = JSON.stringify({ fontName: store.fontName, font: store.glyphs, vertexSize: store.vertexSize, standardSize: store.standardSize, paintColor: store.paintColor, customGuide: useEditorStore.getState().customGuideUnits }, null, 2);`,
  to: `const data = JSON.stringify({ fontName: store.fontName, font: store.glyphs, vertexSize: store.vertexSize, standardSize: store.standardSize, paintColor: store.paintColor, customGuide: useEditorStore.getState().customGuideUnits, brushShape: store.brushShape, brushWidth: store.brushWidth }, null, 2);`,
});

// R8: restaurar ajustes del pincel al abrir JSON
reps.push({
  name: 'R8-open-json',
  from: `        if (typeof parsed.customGuide === 'number' && Number.isFinite(parsed.customGuide)) {
          store.setCustomGuide(clamp(Math.round(parsed.customGuide), 0, 1000));
        }`,
  to: `        if (typeof parsed.customGuide === 'number' && Number.isFinite(parsed.customGuide)) {
          store.setCustomGuide(clamp(Math.round(parsed.customGuide), 0, 1000));
        }
        if (parsed.brushShape === 'round' || parsed.brushShape === 'square') {
          store.setBrushShape(parsed.brushShape);
        }
        if (typeof parsed.brushWidth === 'number' && Number.isFinite(parsed.brushWidth)) {
          store.setBrushWidth(clamp(Math.round(parsed.brushWidth), 4, 300));
        }`,
});

// R9: helper buildBrushOutline (antes de la sección de componentes)
reps.push({
  name: 'R9-helper',
  from: `// -------------------- Components --------------------`,
  to: `// -------------------- Pincel: trazo libre -> contorno con los dos lados --------------------
// Convierte un trazo dibujado a mano (bolígrafo/lápiz) en un glifo cerrado con los
// DOS bordes del trazo (izquierdo y derecho) + tapas:
//  - Punta REDONDA: al girar el trazo hace una curva (normales suavizadas) y las
//    tapas son semicírculos (bolígrafo).
//  - Punta CUADRADA: al girar hace esquinas rectas (dos puntos por vértice) y las
//    tapas son rectas (lápiz de punta plana).
const buildBrushOutline = (raw: Point[], width: number, shape: 'round' | 'square'): Point[] => {
  if (raw.length < 2) return [];
  const w = Math.max(1, width) / 2;

  // 1) Remuestreo del trazo a pasos uniformes (limita el nº de puntos y suaviza).
  const step = Math.max(2, width / 5);
  const pts: Point[] = [];
  const addPt = (p: Point) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.4) return;
    pts.push({ x: p.x, y: p.y });
  };
  addPt(raw[0]);
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= step) { addPt(b); continue; }
    const n = Math.ceil(d / step);
    for (let k = 1; k <= n; k++) addPt({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (pts.length < 2) return [];

  // 2) Dirección y normal de cada segmento.
  const segs: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    let dx = pts[i + 1].x - pts[i].x;
    let dy = pts[i + 1].y - pts[i].y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    segs.push({ x: dx, y: dy });
  }
  const segNormals = segs.map((s) => ({ x: -s.y, y: s.x }));

  // Normal en un punto del trazo.
  const ptNormal = (i: number): { x: number; y: number } => {
    if (shape === 'round') {
      // Promedio de normales vecinas (ventana ±2) -> curvas al girar.
      let nx = 0, ny = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(segs.length - 1, i + 1); k++) {
        nx += segNormals[k].x; ny += segNormals[k].y;
      }
      const l = Math.hypot(nx, ny) || 1;
      return { x: nx / l, y: ny / l };
    }
    // Cuadrado: normal del segmento saliente (el entrante en el último punto) -> esquinas rectas.
    const k = Math.min(i, segs.length - 1);
    return segNormals[k];
  };

  // 3) Bordes izquierdo y derecho (los "segmentos a los dos lados").
  const left: Point[] = [];
  const right: Point[] = [];
  const n0 = ptNormal(0);
  left.push({ x: pts[0].x + n0.x * w, y: pts[0].y + n0.y * w });
  right.push({ x: pts[0].x - n0.x * w, y: pts[0].y - n0.y * w });
  for (let i = 1; i < pts.length - 1; i++) {
    if (shape === 'square') {
      // Esquina recta: dos puntos por vértice (normal entrante y saliente).
      const nIn = segNormals[i - 1];
      const nOut = segNormals[i];
      left.push({ x: pts[i].x + nIn.x * w, y: pts[i].y + nIn.y * w });
      left.push({ x: pts[i].x + nOut.x * w, y: pts[i].y + nOut.y * w });
      right.push({ x: pts[i].x - nIn.x * w, y: pts[i].y - nIn.y * w });
      right.push({ x: pts[i].x - nOut.x * w, y: pts[i].y - nOut.y * w });
    } else {
      const n = ptNormal(i);
      left.push({ x: pts[i].x + n.x * w, y: pts[i].y + n.y * w });
      right.push({ x: pts[i].x - n.x * w, y: pts[i].y - n.y * w });
    }
  }
  const nLast = ptNormal(pts.length - 1);
  left.push({ x: pts[pts.length - 1].x + nLast.x * w, y: pts[pts.length - 1].y + nLast.y * w });
  right.push({ x: pts[pts.length - 1].x - nLast.x * w, y: pts[pts.length - 1].y - nLast.y * w });

  // 4) Tapas de los extremos (redonda = semicírculo hacia delante; cuadrada = recta).
  const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const semiArc = (c: Point, r: number, n: { x: number; y: number }, d: { x: number; y: number }): Point[] => {
    const aN = Math.atan2(n.y, n.x);
    const aD = Math.atan2(d.y, d.x);
    const mid1 = aN + Math.PI / 2;
    const mid2 = aN - Math.PI / 2;
    const forward = Math.abs(wrap(mid1 - aD)) <= Math.abs(wrap(mid2 - aD));
    const aEnd = forward ? aN + Math.PI : aN - Math.PI;
    const out: Point[] = [];
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const a = aN + ((aEnd - aN) * k) / steps;
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return out;
  };
  const firstDir = segs[0];
  const lastDir = segs[segs.length - 1];
  const endCap = shape === 'round' ? semiArc(pts[pts.length - 1], w, nLast, lastDir) : [];
  const startCap = shape === 'round' ? semiArc(pts[0], w, n0, firstDir).reverse() : [];

  // 5) Contorno cerrado: izquierdo -> tapa final -> derecho (inverso) -> tapa inicial.
  const outline: Point[] = [...left, ...endCap];
  for (let i = right.length - 1; i >= 0; i--) outline.push({ x: right[i].x, y: right[i].y });
  outline.push(...startCap);
  return outline;
};

// -------------------- Components --------------------`,
});

// R10: estado brushDraft en el canvas
reps.push({
  name: 'R10-canvas-state',
  from: `  const [guideDrag, setGuideDrag] = useState(false);`,
  to: `  const [guideDrag, setGuideDrag] = useState(false);
  // Pincel: puntos del trazo en curso (se convierte a contorno de dos lados al soltar).
  const [brushDraft, setBrushDraft] = useState<Point[] | null>(null);`,
});

// R11: suscripciones del canvas (ancla única: bloque de 3 líneas del EditorCanvas)
reps.push({
  name: 'R11-canvas-subs',
  from: `  const customGuideUnits = useEditorStore((s) => s.customGuideUnits);
  const setCustomGuide = useEditorStore((s) => s.setCustomGuide);
  const openGlyphIds = useEditorStore((s) => s.openGlyphIds);`,
  to: `  const customGuideUnits = useEditorStore((s) => s.customGuideUnits);
  const setCustomGuide = useEditorStore((s) => s.setCustomGuide);
  const brushShape = useEditorStore((s) => s.brushShape);
  const brushWidth = useEditorStore((s) => s.brushWidth);
  const openGlyphIds = useEditorStore((s) => s.openGlyphIds);`,
});

// R12: efecto de limpieza + Escape para el pincel
reps.push({
  name: 'R12-brush-effect',
  from: `    window.addEventListener('keydown', onKeyCircle);
    return () => window.removeEventListener('keydown', onKeyCircle);
  }, [tool]);`,
  to: `    window.addEventListener('keydown', onKeyCircle);
    return () => window.removeEventListener('keydown', onKeyCircle);
  }, [tool]);
  useEffect(() => {
    if (tool !== 'brush') {
      setBrushDraft(null);
      return;
    }
    const onKeyBrush = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBrushDraft(null);
    };
    window.addEventListener('keydown', onKeyBrush);
    return () => window.removeEventListener('keydown', onKeyBrush);
  }, [tool]);`,
});

// R13: pointer down del pincel
reps.push({
  name: 'R13-brush-pointer-down',
  from: `    // Herramienta Círculo: primer clic fija el centro; al soltar se crea el círculo.
    if (tool === 'circle') {
      setCircleDraft({ x0: pt.x, y0: pt.y });
      setCircleMouse(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Segundo clic de la herramienta Line: fija el extremo de la línea en curso.`,
  to: `    // Herramienta Círculo: primer clic fija el centro; al soltar se crea el círculo.
    if (tool === 'circle') {
      setCircleDraft({ x0: pt.x, y0: pt.y });
      setCircleMouse(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Herramienta Pincel: empieza a registrar el trazo libre (bolígrafo/lápiz).
    // Magnetismo: si el inicio cae cerca de un vértice existente, se conecta a él.
    if (tool === 'brush') {
      pushHistory();
      const hit = findNearestVertexAcross(glyphs, raw, 22);
      let start: Point = snapPoint(raw);
      if (hit) {
        const hg = glyphs.find((gg) => gg.id === hit.glyphId);
        if (hg && hg.points[hit.vertex]) start = { x: hg.points[hit.vertex].x, y: hg.points[hit.vertex].y };
      }
      setBrushDraft([start]);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Segundo clic de la herramienta Line: fija el extremo de la línea en curso.`,
});

// R14: pointer move del pincel
reps.push({
  name: 'R14-brush-pointer-move',
  from: `    // Herramienta Círculo: preview mientras se arrastra (se crea al soltar).
    if (tool === 'circle' && circleDraft) {
      setCircleMouse(snap);
      return;
    }

    // Herramienta Curve: mientras se arrastra, abre/cierra la curva del segmento.`,
  to: `    // Herramienta Círculo: preview mientras se arrastra (se crea al soltar).
    if (tool === 'circle' && circleDraft) {
      setCircleMouse(snap);
      return;
    }

    // Herramienta Pincel: registra los puntos del trazo (muestreados por distancia).
    if (tool === 'brush' && brushDraft) {
      const cur = snapPoint(raw);
      const last = brushDraft[brushDraft.length - 1];
      if (Math.hypot(cur.x - last.x, cur.y - last.y) >= 2) {
        setBrushDraft([...brushDraft, cur]);
      }
      return;
    }

    // Herramienta Curve: mientras se arrastra, abre/cierra la curva del segmento.`,
});

// R15: pointer up del pincel (finaliza -> crea el glifo contorno)
reps.push({
  name: 'R15-brush-pointer-up',
  from: `  const handlePointerUp = () => {
    // Herramienta Rect: al soltar se crea el rectángulo (si tiene tamaño mínimo).`,
  to: `  const handlePointerUp = () => {
    // Herramienta Pincel: al soltar, el trazo se convierte en un contorno cerrado
    // con los DOS lados del trazo (borde izq. + der.) y tapas redondas/cuadradas.
    if (tool === 'brush' && brushDraft) {
      if (brushDraft.length >= 2) {
        const pts = buildBrushOutline(brushDraft, brushWidth, brushShape);
        if (pts.length >= 3) {
          const id = 'g' + Date.now() + Math.random().toString(36).slice(2, 6);
          const brushGlyph: Glyph = {
            id,
            name: 'Br' + (glyphs.length + 1),
            points: pts,
            closed: true,
            stroke,
            fill: stroke,
            strokeWidth: Math.min(2, strokeWidth || 2),
            texture: null,
            font: useEditorStore.getState().fontName,
          };
          addGlyph(brushGlyph);
          selectGlyph(id, false);
          setOpenGlyphs([...new Set([...openGlyphIds, id])]);
        }
      }
      setBrushDraft(null);
      return;
    }
    // Herramienta Rect: al soltar se crea el rectángulo (si tiene tamaño mínimo).`,
});

// R16: cursor del pincel
reps.push({
  name: 'R16-cursor',
  from: `          className={cn('bg-gray-900 border border-green-900/50 select-none', tool === 'scale' && 'cursor-ew-resize', (tool === 'connect' || tool === 'paint' || tool === 'rect' || tool === 'circle' || tool === 'fillzone') && 'cursor-crosshair')}`,
  to: `          className={cn('bg-gray-900 border border-green-900/50 select-none', tool === 'scale' && 'cursor-ew-resize', (tool === 'connect' || tool === 'paint' || tool === 'rect' || tool === 'circle' || tool === 'fillzone' || tool === 'brush') && 'cursor-crosshair')}`,
});

// R17: preview del trazo del pincel
reps.push({
  name: 'R17-brush-preview',
  from: `              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          )}
        </svg>`,
  to: `              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          )}
          {/* Herramienta Pincel: preview del trazo en curso (mismo aspecto que el resultado final). */}
          {tool === 'brush' && brushDraft && brushDraft.length >= 2 && (
            <polyline
              points={brushDraft.map((p) => p.x + ',' + p.y).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={brushWidth}
              strokeLinecap={brushShape === 'round' ? 'round' : 'square'}
              strokeLinejoin={brushShape === 'round' ? 'round' : 'miter'}
              opacity={0.85}
              className="pointer-events-none"
            />
          )}
        </svg>`,
});

let ok = true;
for (const r of reps) {
  const count = src.split(r.from).length - 1;
  if (count !== 1) {
    console.error(`FALLO [${r.name}]: se encontró ${count} veces el ancla (se esperaba 1)`);
    ok = false;
  } else {
    src = src.split(r.from).join(r.to);
    console.log(`OK [${r.name}]`);
  }
}

if (!ok) {
  console.error('No se escribió nada: hay anclas que no son únicas o faltan.');
  process.exit(1);
}

fs.writeFileSync(FILE + '.bak-brush', fs.readFileSync(FILE, 'utf8'));
fs.writeFileSync(FILE, src);
console.log('Backup creado: ' + FILE + '.bak-brush');
console.log('Parche aplicado correctamente.');
