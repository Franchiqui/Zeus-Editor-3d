/* Parche único para integrar el Recorrido (sweep) en Editor3D.tsx.
   Cada reemplazo exige exactamente 1 coincidencia; si no, aborta. */
const fs = require('fs');

const FILE = 'components/editor/Editor3D.tsx';
let src = fs.readFileSync(FILE, 'utf8');

const log = [];
function re(pattern, repl, tag) {
  const rx = new RegExp(pattern, 'g');
  const m = src.match(rx);
  if (!m || m.length !== 1) {
    throw new Error(`[${tag}] coincidencias=${m ? m.length : 0}`);
  }
  src = src.replace(rx, repl);
  log.push(tag);
}
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 1) Imports
re(
  esc("import { buildLoftMesh } from '@/lib/loft-mesh';"),
  "import { buildLoftMesh } from '@/lib/loft-mesh';\nimport { buildSweepMesh, type SweepNode } from '@/lib/sweep-mesh';",
  'import-sweep'
);
re(
  esc("import { AxisHeader } from './axis-header';"),
  "import { AxisHeader } from './axis-header';\nimport PathCanvas from './path-canvas';",
  'import-pathcanvas'
);

// 2) Estado
re(
  "const \\[extrudeHoles, setExtrudeHoles\\] = useState<string\\[\\]>\\(\\[\\]\\);",
  [
    "const [extrudeHoles, setExtrudeHoles] = useState<string[]>([]);",
    "  // Recorrido (Extruir): el segmento por el que se barre la figura y la",
    "  // plantilla de cada vértice (la que se le da forma en el lienzo Frontal).",
    "  const [sweepNodes, setSweepNodes] = useState<SweepNode[]>([]);",
    "  const [sweepActiveId, setSweepActiveId] = useState<number | null>(null);",
    "  const [sweepClosed, setSweepClosed] = useState(false);",
    "  const [sweepSubdivisions, setSweepSubdivisions] = useState(10);",
    "  const sweepIdRef = useRef(1);",
  ].join('\n'),
  'state'
);

// 3) Helpers (tras handleVerticesChange)
re(
  "const handleVerticesChange = useCallback\\(\\(verts: Vertex3D\\[\\]\\) => \\{\\s*setEditedVertices\\(verts\\);\\s*\\}, \\[\\]\\);",
  [
    "const handleVerticesChange = useCallback((verts: Vertex3D[]) => {",
    "    setEditedVertices(verts);",
    "  }, []);",
    "",
    "  // --- Recorrido (Extruir) ---",
    "  const defaultSweepProfile = useCallback((): Polygon => {",
    "    if (views.front.length >= 3) return structuredClone(views.front);",
    "    return [",
    "      { x: 0.3, y: 0.3 },",
    "      { x: 0.7, y: 0.3 },",
    "      { x: 0.7, y: 0.7 },",
    "      { x: 0.3, y: 0.7 },",
    "    ];",
    "  }, [views.front]);",
    "",
    "  const addSweepNode = useCallback(",
    "    (x: number, y: number) => {",
    "      const id = sweepIdRef.current;",
    "      sweepIdRef.current += 1;",
    "      setSweepNodes((prev) => [",
    "        ...prev,",
    "        { id, x, y, tilt: 0, polygon: defaultSweepProfile() },",
    "      ]);",
    "      setSweepActiveId(id);",
    "    },",
    "    [defaultSweepProfile]",
    "  );",
    "",
    "  const moveSweepNode = useCallback((id: number, x: number, y: number) => {",
    "    setSweepNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));",
    "  }, []);",
    "",
    "  const removeSweepNode = useCallback((id: number) => {",
    "    setSweepNodes((prev) => prev.filter((n) => n.id !== id));",
    "    setSweepActiveId((cur) => (cur === id ? null : cur));",
    "  }, []);",
    "",
    "  const updateSweepNodePolygon = useCallback((id: number, polygon: Polygon) => {",
    "    setSweepNodes((prev) =>",
    "      prev.map((n) => (n.id === id ? { ...n, polygon } : n))",
    "    );",
    "  }, []);",
    "",
    "  const setSweepNodeTilt = useCallback((id: number, tilt: number) => {",
    "    setSweepNodes((prev) =>",
    "      prev.map((n) => (n.id === id ? { ...n, tilt } : n))",
    "    );",
    "  }, []);",
    "",
    "  const activeSweepNode =",
    "    mode === 'extrude'",
    "      ? sweepNodes.find((n) => n.id === sweepActiveId) ?? null",
    "      : null;",
    "  const sweepNodeNumber = activeSweepNode",
    "    ? sweepNodes.findIndex((n) => n.id === activeSweepNode.id) + 1",
    "    : 0;",
  ].join('\n'),
  'helpers'
);

// 4) isEditingCanvas: el recorrido dibuja en vivo la figura
re(
  "editingMesh \\|\\|\\s*editingMeshSide;",
  "editingMesh ||\n    editingMeshSide ||\n    (mode === 'extrude' && sweepNodes.length >= 2);",
  'isediting'
);

// 5) allHaveShapes con recorrido
re(
  "const allHaveShapes =\\s*mode === 'extrude'\\s*\\? views\\.front\\.length >= 3\\s*: views\\.front\\.length >= 3 &&",
  [
    "const sweepCanBuild =",
    "      mode === 'extrude' &&",
    "      sweepNodes.length >= 2 &&",
    "      sweepNodes.every((n) => n.polygon.length >= 3 || views.front.length >= 3);",
    "",
    "    const allHaveShapes =",
    "      mode === 'extrude'",
    "        ? views.front.length >= 3 || sweepCanBuild",
    "        : views.front.length >= 3 &&",
  ].join('\n'),
  'allhave'
);

// 6) Rama de construccion en Extruir
re(
  "if \\(mode === 'extrude'\\) \\{\\s*\\/\\/ Recolecta el polígono principal[^\\n]*\\n[\\s\\S]*?mesh = buildExtrudeMeshes\\(shapes, extrudeDepth, holes\\);\\s*\\}",
  [
    "if (mode === 'extrude') {",
    "      // Recorrido: con un segmento de al menos 2 vértices la figura se",
    "      // barre a lo largo de él y la plantilla va cambiando de forma (y de",
    "      // inclinación) de un vértice al siguiente. Sin segmento, extrusión",
    "      // normal del contorno Frontal.",
    "      const sweepWithProfiles = sweepNodes.map((n) => ({",
    "        ...n,",
    "        polygon: n.polygon.length >= 3 ? n.polygon : views.front,",
    "      }));",
    "      const canSweep =",
    "        sweepNodes.length >= 2 &&",
    "        sweepWithProfiles.every((n) => n.polygon.length >= 3);",
    "      if (canSweep) {",
    "        mesh = buildSweepMesh(sweepWithProfiles, {",
    "          closed: sweepClosed,",
    "          subdivisions: sweepSubdivisions,",
    "        });",
    "      } else {",
    "        // Recolecta el polígono principal más las polilíneas cerradas",
    "        // dibujadas con la herramienta Línea: todas se extruyen juntas.",
    "        const frontPolylines = getPolylines('views:front');",
    "        const shapes: Polygon[] = [views.front];",
    "        const holes: Polygon[] = [];",
    "        for (const line of frontPolylines) {",
    "          const poly = polylineToPolygon(line);",
    "          if (!poly) continue;",
    "          if (extrudeHoles.includes(line.id)) {",
    "            holes.push(poly);",
    "          } else {",
    "            shapes.push(poly);",
    "          }",
    "        }",
    "        mesh = buildExtrudeMeshes(shapes, extrudeDepth, holes);",
    "      }",
    "    }",
  ].join('\n'),
  'build-branch'
);

// 7) deps del useMemo de malla
re(
  "meshSilhouetteView,\\s*meshSideView,\\s*meshOpacity,\\s*\\]\\);\\s*const mesh = useMemo\\(\\(\\) => \\{",
  [
    "meshSilhouetteView,",
    "    meshSideView,",
    "    meshOpacity,",
    "    sweepNodes,",
    "    sweepClosed,",
    "    sweepSubdivisions,",
    "  ]);",
    "",
    "  const mesh = useMemo(() => {",
  ].join('\n'),
  'build-deps'
);

// 8) Rejilla del lienzo Extruir (Frente + recorrido + controles)
re(
  "grid-rows-\\[320px_auto\\] gap-3 p-3 min-h-0 custom-scrollbar",
  "grid-rows-[260px_320px_auto] gap-3 p-3 min-h-0 custom-scrollbar",
  'grid'
);

// 9) Lienzo Frontal (edita la plantilla del vértice activo) + lienzo del
//    Recorrido insertado justo antes del bloque de controles de Extruir.
//    El contexto hasta `<div className="flex flex-col gap-3">` es único de
//    Extruir (el lienzo Frontal de Vistas va seguido de otro DrawingCanvas).
re(
  [
    "label=\\{t\\('editor3D\\.panelLabels\\.front'\\)\\}",
    "\\s*axisLabel=\\{t\\('editor3D\\.panelLabels\\.frontAxis'\\)\\}",
    "\\s*polygon=\\{views\\.front\\}",
    "\\s*onChange=\\{updateView\\('front'\\)\\}",
    "\\s*resolution=\\{resolution\\}",
    "\\s*onEdit=\\{\\(\\) => setEditingViewProfile\\('front'\\)\\}",
    "\\s*polylines=\\{getPolylines\\('views:front'\\)\\}",
    "\\s*\\/>\\s*<div className=\"flex flex-col gap-3\">",
  ].join(''),
  [
    "label={activeSweepNode ? t('editor3D.sweepProfileLabel', { n: sweepNodeNumber }) : t('editor3D.panelLabels.front')}",
    "                     axisLabel={t('editor3D.panelLabels.frontAxis')}",
    "                     polygon={activeSweepNode ? activeSweepNode.polygon : views.front}",
    "                     onChange={activeSweepNode ? (poly) => updateSweepNodePolygon(activeSweepNode.id, poly) : updateView('front')}",
    "                     resolution={resolution}",
    "                     onEdit={() => setEditingViewProfile('front')}",
    "                     polylines={getPolylines('views:front')}",
    "                   />",
    "                   <div className=\"flex flex-col gap-2 min-h-0\">",
    "                     <PathCanvas",
    "                       label={t('editor3D.sweepTitle')}",
    "                       axisLabel=\"PATH\"",
    "                       points={sweepNodes}",
    "                       activeId={sweepActiveId}",
    "                       closed={sweepClosed}",
    "                       resolution={resolution}",
    "                       onChange={moveSweepNode}",
    "                       onAdd={addSweepNode}",
    "                       onSelect={setSweepActiveId}",
    "                       onRemove={removeSweepNode}",
    "                     />",
    "                     <div className=\"flex items-center gap-2 flex-wrap\">",
    "                       <button",
    "                         onClick={() => setSweepClosed((v) => !v)}",
    "                         className={overlayToolChip(sweepClosed)}",
    "                         title={t('editor3D.sweepClosed')}",
    "                       >",
    "                         {t('editor3D.sweepClosed')}",
    "                       </button>",
    "                       {sweepActiveId !== null && (",
    "                         <>",
    "                           <button",
    "                             onClick={() => removeSweepNode(sweepActiveId)}",
    "                             className=\"px-1.5 py-0.5 rounded text-[10px] font-medium border border-red-500/30 bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors\"",
    "                             title={t('editor3D.sweepRemove')}",
    "                           >",
    "                             {t('editor3D.sweepRemove')}",
    "                           </button>",
    "                           <div className=\"flex items-center gap-2 flex-1 min-w-[150px]\">",
    "                             <span className=\"text-[10px] text-muted-foreground/80 whitespace-nowrap\">",
    "                               {t('editor3D.sweepTilt')}",
    "                             </span>",
    "                             <Slider",
    "                               min={-90}",
    "                               max={90}",
    "                               step={1}",
    "                               value={[activeSweepNode?.tilt ?? 0]}",
    "                               onValueChange={([v]) => setSweepNodeTilt(sweepActiveId, v)}",
    "                               className=\"flex-1\"",
    "                             />",
    "                             <span className=\"font-mono text-[10px] text-green-400 w-8 text-right\">",
    "                               {(activeSweepNode?.tilt ?? 0).toFixed(0)}\u00b0",
    "                             </span>",
    "                           </div>",
    "                         </>",
    "                       )}",
    "                       <div className=\"flex items-center gap-2 min-w-[150px]\">",
    "                         <span className=\"text-[10px] text-muted-foreground/80 whitespace-nowrap\">",
    "                           {t('editor3D.sweepSubdivisions')}",
    "                         </span>",
    "                         <Slider",
    "                           min={2}",
    "                           max={40}",
    "                           step={1}",
    "                           value={[sweepSubdivisions]}",
    "                           onValueChange={([v]) => setSweepSubdivisions(v)}",
    "                           className=\"flex-1\"",
    "                         />",
    "                         <span className=\"font-mono text-[10px] text-green-400 w-6 text-right\">",
    "                           {sweepSubdivisions}",
    "                         </span>",
    "                       </div>",
    "                     </div>",
    "                     <p className=\"text-[10px] text-muted-foreground/60 flex items-start gap-1\">",
    "                       <Info className=\"w-2.5 h-2.5 shrink-0 mt-0.5\" />",
    "                       {t('editor3D.sweepHint')}",
    "                     </p>",
    "                   </div>",
    "                   <div className=\"flex flex-col gap-3\">",
  ].join('\n'),
  'front+pathcanvas'
);

// 10) i18n
const i18n = [
  {
    anchor: "extrusionHint: 'La figura se extruye",
    block: [
      "    sweepTitle: 'Recorrido',",
      "    sweepHint: 'Marca vértices en el segmento de abajo: la plantilla que dibujas arriba es la del vértice activo. La figura recorre el segmento cambiando de forma de un vértice al siguiente.',",
      "    sweepProfileLabel: 'Plantilla del vértice {n}',",
      "    sweepTilt: 'Inclinación',",
      "    sweepClosed: 'Cerrar recorrido',",
      "    sweepSubdivisions: 'Subdivisiones',",
      "    sweepRemove: 'Quitar vértice',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: 'The figure is extruded",
    block: [
      "    sweepTitle: 'Sweep path',",
      "    sweepHint: 'Mark vertices on the segment below: the template you draw above belongs to the active vertex. The shape sweeps along the segment, morphing from one vertex to the next.',",
      "    sweepProfileLabel: 'Vertex {n} template',",
      "    sweepTilt: 'Tilt',",
      "    sweepClosed: 'Close path',",
      "    sweepSubdivisions: 'Subdivisions',",
      "    sweepRemove: 'Remove vertex',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: 'La figure est extrud",
    block: [
      "    sweepTitle: 'Parcours',",
      "    sweepHint: 'Marquez des sommets sur le segment ci-dessous : le gabarit que vous dessinez ci-dessus est celui du sommet actif. La figure parcourt le segment en se déformant d\\'un sommet à l\\'autre.',",
      "    sweepProfileLabel: 'Gabarit du sommet {n}',",
      "    sweepTilt: 'Inclinaison',",
      "    sweepClosed: 'Fermer le parcours',",
      "    sweepSubdivisions: 'Subdivisions',",
      "    sweepRemove: 'Supprimer le sommet',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: 'Die Form wird von der Vorderseite",
    block: [
      "    sweepTitle: 'Verlauf',",
      "    sweepHint: 'Markiere Knoten auf dem Segment unten: Die Vorlage, die du oben zeichnest, gehört zum aktiven Knoten. Die Form verläuft entlang des Segments und wandelt sich von Knoten zu Knoten.',",
      "    sweepProfileLabel: 'Vorlage von Knoten {n}',",
      "    sweepTilt: 'Neigung',",
      "    sweepClosed: 'Verlauf schließen',",
      "    sweepSubdivisions: 'Unterteilungen',",
      "    sweepRemove: 'Knoten entfernen',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: 'La figura è estrusa",
    block: [
      "    sweepTitle: 'Percorso',",
      "    sweepHint: 'Segna i vertici sul segmento in basso: la sagoma che disegni sopra è quella del vertice attivo. La figura percorre il segmento trasformandosi da un vertice all\\'altro.',",
      "    sweepProfileLabel: 'Sagoma del vertice {n}',",
      "    sweepTilt: 'Inclinazione',",
      "    sweepClosed: 'Chiudi percorso',",
      "    sweepSubdivisions: 'Suddivisioni',",
      "    sweepRemove: 'Rimuovi vertice',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: '图形从正面画布",
    block: [
      "    sweepTitle: '路径',",
      "    sweepHint: '在下方的线段上标记顶点：你在上方绘制的模板属于当前顶点。图形沿线段扫掠，并在顶点之间逐渐变形。',",
      "    sweepProfileLabel: '顶点 {n} 的模板',",
      "    sweepTilt: '倾斜',",
      "    sweepClosed: '闭合路径',",
      "    sweepSubdivisions: '细分',",
      "    sweepRemove: '删除顶点',",
    ].join('\n'),
  },
  {
    anchor: "extrusionHint: 'फिगर फ्रंट",
    block: [
      "    sweepTitle: 'पथ',",
      "    sweepHint: 'नीचे खंड पर शीर्ष चिह्नित करें: ऊपर आप जो टेम्पलेट बनाते हैं वह सक्रिय शीर्ष का होता है। आकृति खंड के साथ चलती है और एक शीर्ष से दूसरे में बदलती जाती है।',",
      "    sweepProfileLabel: 'शीर्ष {n} का टेम्पलेट',",
      "    sweepTilt: 'झुकाव',",
      "    sweepClosed: 'पथ बंद करें',",
      "    sweepSubdivisions: 'उपविभाजन',",
      "    sweepRemove: 'शीर्ष हटाएँ',",
    ].join('\n'),
  },
];

const TFILE = 'lib/i18n/translations.ts';
let tsrc = fs.readFileSync(TFILE, 'utf8');
for (const { anchor, block } of i18n) {
  const rx = new RegExp(esc(anchor) + '[^\\n]*\\n', 'g');
  const m = tsrc.match(rx);
  if (!m || m.length !== 1) {
    throw new Error(`[i18n ${anchor}] coincidencias=${m ? m.length : 0}`);
  }
  tsrc = tsrc.replace(rx, (full) => full + block + '\n');
  log.push('i18n:' + anchor.slice(13, 30));
}

fs.writeFileSync(FILE, src);
fs.writeFileSync(TFILE, tsrc);

const checks = ['buildSweepMesh', 'PathCanvas', 'sweepNodes', 'sweepCanBuild', 'sweepTitle', 'sweepProfileLabel'];
for (const c of checks) {
  const total = src.split(c).length - 1 + (tsrc.split(c).length - 1);
  if (total === 0) throw new Error('falta ' + c);
}

console.log('OK. Reemplazos:');
for (const l of log) console.log('  - ' + l);
console.log(`Editor3D.tsx: ${src.length} bytes; translations.ts: ${tsrc.length} bytes`);
