/* Aplica la función "maximizar recorrido/plantilla" en la pestaña Extruir.
 * Reemplazos exactos y verificables (falla si un patrón no aparece 1 vez).
 * Normaliza CRLF/LF para que el emparejamiento no dependa del sistema. */
const fs = require('fs');
const path = require('path');

const ED = path.join('components', 'editor', 'Editor3D.tsx');
const PC = path.join('components', 'editor', 'path-canvas.tsx');

function patch(file, edits) {
  let raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let src = raw.replace(/\r\n/g, '\n');
  for (const [name, oldStr, newStr] of edits) {
    const count = src.split(oldStr).length - 1;
    if (count !== 1) {
      throw new Error(
        `[${path.basename(file)}] "${name}" esperaba 1 coincidencia, encontró ${count}`
      );
    }
    src = src.replace(oldStr, newStr);
    console.log(`  OK  ${name}`);
  }
  fs.writeFileSync(file, src.replace(/\n/g, eol));
  console.log(`\nEscrito: ${file}  (EOL=${JSON.stringify(eol)})\n`);
}

// Copias de seguridad
for (const f of [ED, PC]) {
  const bak = f + '.sweepmax.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);
}

console.log('Editor3D.tsx:');
patch(ED, [
  [
    'estado editingSweepCanvas',
    `  const [editingViewProfile, setEditingViewProfile] = useState<
    'front' | 'side' | 'top' | null
  >(null);
`,
    `  const [editingViewProfile, setEditingViewProfile] = useState<
    'front' | 'side' | 'top' | null
  >(null);
  // Lienzo maximizado de la pestaña Extruir: 'path' abre el Recorrido y
  // 'profile' la plantilla a pantalla completa (ambos ocupan el sitio de
  // las cuatro ventanas). null = rejilla normal.
  const [editingSweepCanvas, setEditingSweepCanvas] = useState<
    'path' | 'profile' | null
  >(null);
`,
  ],
  [
    'isEditingCanvas incluye editingSweepCanvas',
    `    editingMesh ||
    editingMeshSide ||
    (mode === 'extrude' && sweepNodes.length >= 2);
`,
    `    editingMesh ||
    editingMeshSide ||
    editingSweepCanvas !== null ||
    (mode === 'extrude' && sweepNodes.length >= 2);
`,
  ],
  [
    'switchTab cierra el lienzo maximizado',
    `      setEditingViewProfile(null);
      setEditingMeshProfile(null);
`,
    `      setEditingViewProfile(null);
      setEditingSweepCanvas(null);
      setEditingMeshProfile(null);
`,
  ],
  [
    'botón maximizar del lienzo de plantilla (panel)',
    `                     onChange={activeSweepNode ? (poly) => updateSweepNodePolygon(activeSweepNode.id, poly) : updateView('front')}
                     resolution={resolution}
                     onEdit={() => setEditingViewProfile('front')}
`,
    `                     onChange={activeSweepNode ? (poly) => updateSweepNodePolygon(activeSweepNode.id, poly) : updateView('front')}
                     resolution={resolution}
                     onEdit={() => setEditingViewProfile('front')}
                     onMaximize={() => setEditingSweepCanvas('profile')}
`,
  ],
  [
    'botón maximizar del recorrido (panel)',
    `                       emptyHint={t('editor3D.sweepEmptyHint')}
                       helpHint={t('editor3D.sweepHelpHint')}
                     />
`,
    `                       emptyHint={t('editor3D.sweepEmptyHint')}
                       helpHint={t('editor3D.sweepHelpHint')}
                       onMaximize={() => setEditingSweepCanvas('path')}
                     />
`,
  ],
  [
    'rama de layout a pantalla completa (recorrido/plantilla)',
    `            ) : editingPanel !== null ? (
              renderViewerPanel(editingPanel)
`,
    `            ) : mode === 'extrude' && editingSweepCanvas ? (
              <div className="w-full h-full min-h-0">
                {editingSweepCanvas === 'path' ? (
                  <PathCanvas
                    label={t('editor3D.sweepTitle')}
                    axisLabel="PATH"
                    points={sweepNodes}
                    activeId={sweepActiveId}
                    closed={sweepClosed}
                    resolution={resolution}
                    onChange={moveSweepNode}
                    onAdd={addSweepNode}
                    onSelect={setSweepActiveId}
                    onRemove={removeSweepNode}
                    emptyHint={t('editor3D.sweepEmptyHint')}
                    helpHint={t('editor3D.sweepHelpHint')}
                    onClose={() => setEditingSweepCanvas(null)}
                  />
                ) : (
                  <EditorCanvasComponent
                    label={
                      activeSweepNode
                        ? t('editor3D.sweepProfileLabel', { n: sweepNodeNumber })
                        : t('editor3D.panelLabels.front')
                    }
                    axisLabel={t('editor3D.panelLabels.frontAxis')}
                    polygon={
                      activeSweepNode ? activeSweepNode.polygon : views.front
                    }
                    onChange={
                      activeSweepNode
                        ? (poly: Polygon) =>
                            updateSweepNodePolygon(activeSweepNode.id, poly)
                        : updateView('front')
                    }
                    resolution={editorGridResolution}
                    onClose={() => setEditingSweepCanvas(null)}
                    gridResolution={editorGridResolution}
                    onGridResolutionChange={setEditorGridResolution}
                    canvasZoom={editorCanvasZoom}
                    onCanvasZoomChange={setEditorCanvasZoom}
                    polylines={getPolylines('views:front')}
                    onPolylinesChange={(lines: Polyline[]) =>
                      updatePolylines('views:front', lines)
                    }
                    templateImage={templateImage}
                    templateOpacity={templateOpacity}
                    templateScale={templateScale}
                  />
                )}
              </div>
            ) : editingPanel !== null ? (
              renderViewerPanel(editingPanel)
`,
  ],
]);

console.log('path-canvas.tsx:');
patch(PC, [
  [
    'import iconos',
    `import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
`,
    `import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, X } from 'lucide-react';
`,
  ],
  [
    'props onMaximize/onClose en la interfaz',
    `  onSelect: (id: number | null) => void;
  onRemove: (id: number) => void;
}
`,
    `  onSelect: (id: number | null) => void;
  onRemove: (id: number) => void;
  /** Maximizar: abre el recorrido ocupando el sitio de las cuatro ventanas. */
  onMaximize?: () => void;
  /** Volver a la rejilla (visible cuando está maximizado). */
  onClose?: () => void;
}
`,
  ],
  [
    'desestructurar props nuevas',
    `  onSelect,
  onRemove,
}: PathCanvasProps) {
`,
    `  onSelect,
  onRemove,
  onMaximize,
  onClose,
}: PathCanvasProps) {
`,
  ],
  [
    'botones en la cabecera',
    `        <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">
          {points.length} pt{points.length === 1 ? '' : 's'}
        </span>
`,
    `        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-muted-foreground/50 font-mono">
            {points.length} pt{points.length === 1 ? '' : 's'}
          </span>
          {onMaximize && (
            <button
              onClick={onMaximize}
              className="p-1 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Maximizar (ocupar todo el espacio)"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-green-300 hover:bg-green-500/10 transition-colors"
              title="Volver a la rejilla"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
`,
  ],
]);

console.log('Listo.');
