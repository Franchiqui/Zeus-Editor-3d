/**
 * apply-template-scale.cjs
 * ---------------------------------------------------------------------------
 * Anade a las PLANTILLAS (DrawingCanvas) un CONTROL DE ESCALA REAL, separado
 * del zoom de la vista.
 *
 *   - Zoom   = cambia la VISTA (viewBox). No modifica la plantilla.
 *   - Escala = cambia el TAMANO REAL de la plantilla: se "cuece" en el propio
 *              poligono (alrededor de su centroide) y por tanto el objeto
 *              barrido / recorrido se hace de verdad mas grande o mas pequeno.
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar nada.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'drawing-canvas.tsx');
let src = fs.readFileSync(file, 'utf8');
const before = src;

function apply(label, needle, repl) {
  if (src.includes(repl)) {
    console.log('skip (ya aplicado):', label);
    return;
  }
  const i = src.indexOf(needle);
  if (i === -1) throw new Error('No se encontro el ancla: ' + label);
  src = src.slice(0, i) + repl + src.slice(i + needle.length);
  console.log('ok:', label);
}

// 1) Iconos ----------------------------------------------------------------
apply(
  'imports (Minus, Plus, Scaling)',
  `  ZoomIn,
  ZoomOut,
  Hand,
} from 'lucide-react';`,
  `  ZoomIn,
  ZoomOut,
  Hand,
  Minus,
  Plus,
  Scaling,
} from 'lucide-react';`
);

// 2) Helper scalePolygon ----------------------------------------------------
apply(
  'helper scalePolygon',
  `} as const;

interface DrawingCanvasProps {`,
  `} as const;

/**
 * Escala el poligono (y sus asas de curvatura) alrededor de su centroide.
 * Cambia el TAMANO REAL de la plantilla (no la vista): afecta al objeto
 * barrido / recorrido, que se reconstruye a partir de estas coordenadas.
 */
function scalePolygon(poly: Polygon, factor: number): Polygon {
  if (poly.length === 0 || factor === 1) return poly;
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  const f = (x: number, y: number) => ({
    x: cx + (x - cx) * factor,
    y: cy + (y - cy) * factor,
  });
  return poly.map((p) => {
    const np: Polygon[number] = { ...f(p.x, p.y) };
    if (p.hIn) np.hIn = f(p.hIn.x, p.hIn.y);
    if (p.hOut) np.hOut = f(p.hOut.x, p.hOut.y);
    return np;
  });
}

interface DrawingCanvasProps {`
);

// 3) Estado de la escala ----------------------------------------------------
apply(
  'estado scalePct / refs',
  `  const panStartRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);`,
  `  const panStartRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /* ---- Escala REAL de la plantilla (tamano, NO la vista) ----
     La escala se guarda implicitamente: 100% = el poligono tal cual entro en el
     lienzo. Al escalar se reescribe el poligono (centroide fijo), de modo que
     el recorrido muestra el tamano que tiene realmente la plantilla. */
  const scaleBaseRef = useRef<Polygon>(polygon);
  const scaleEmittedRef = useRef<Polygon | null>(null);
  const [scalePct, setScalePct] = useState(100);`
);

// 4) Efecto + manejadores (despues del hook, para tener applyShape) ---------
apply(
  'effect + scaleBy/resetScale',
  `  } = usePolygonEditor({ polygon, onChange, resolution, coordinateBounds: canvasBounds });

  const gridLines = [];`,
  `  } = usePolygonEditor({ polygon, onChange, resolution, coordinateBounds: canvasBounds });

  // Si el poligono cambia por FUERA (dibujar/editar/deshacer/otra forma/otra
  // pestana), reinicia la referencia: 100% = tamano actual.
  useEffect(() => {
    if (polygon === scaleEmittedRef.current) return;
    scaleBaseRef.current = polygon;
    scaleEmittedRef.current = null;
    setScalePct(100);
  }, [polygon]);

  const MIN_SCALE = 1; // % (se puede reducir todo lo que se quiera)
  const MAX_SCALE = 4000; // %
  const scaleBy = (factor: number) => {
    if (polygon.length < 3) return;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scalePct * factor));
    const f = next / scalePct;
    if (!isFinite(f) || Math.abs(f - 1) < 1e-6) return;
    const scaled = scalePolygon(polygon, f);
    scaleEmittedRef.current = scaled;
    setScalePct(next);
    applyShape(scaled); // entra en el historial (Deshacer/Rehacer)
  };
  const resetScale = () => {
    const base = scaleBaseRef.current;
    if (!base || base.length < 3 || polygon === base) return;
    scaleEmittedRef.current = base;
    setScalePct(100);
    applyShape(base);
  };

  const gridLines = [];`
);

// 5) UI: control de escala flotante (arriba a la derecha) -------------------
apply(
  'UI control de escala',
  `              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>`,
  `              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        )}
        {/* Control de ESCALA REAL de la plantilla (NO es zoom): cambia el
            tamano de la pieza. El zoom de arriba solo acerca/aleja la vista. */}
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-0.5 rounded-md border border-green-500/30 bg-black/40 backdrop-blur-sm px-1 py-0.5">
          <Scaling className="w-3 h-3 text-green-400/80" />
          <button
            onClick={() => scaleBy(1 / 1.15)}
            disabled={polygon.length < 3}
            className="p-1 rounded text-muted-foreground hover:text-green-300 hover:bg-green-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Encoger la plantilla (tamano real)"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={resetScale}
            disabled={polygon.length < 3}
            className="px-1 text-[9px] font-mono text-green-400/90 hover:text-green-300 transition-colors tabular-nums disabled:opacity-40"
            title="Escala real de la plantilla (clic = 100%)"
          >
            {Math.round(scalePct)}%
          </button>
          <button
            onClick={() => scaleBy(1.15)}
            disabled={polygon.length < 3}
            className="p-1 rounded text-muted-foreground hover:text-green-300 hover:bg-green-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Agrandar la plantilla (tamano real)"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>`
);

if (src !== before) {
  fs.writeFileSync(file, src);
  console.log('\\nEscrito:', path.relative(path.join(__dirname, '..'), file));
} else {
  console.log('\\nSin cambios.');
}
