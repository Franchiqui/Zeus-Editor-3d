const fs = require('fs');
const FILE = 'components/editor/Editor3D.tsx';
let src = fs.readFileSync(FILE, 'utf8');

function re(pattern, repl, tag) {
  const rx = new RegExp(pattern, 'g');
  const m = src.match(rx);
  if (!m || m.length !== 1) throw new Error(`[${tag}] coincidencias=${m ? m.length : 0}`);
  src = src.replace(rx, repl);
  console.log('  - ' + tag);
}

// canBuild (barra/botón de construir)
re(
  "mode === 'extrude'\\s*\\? views\\.front\\.length >= 3\\s*: views\\.front\\.length >= 3 &&",
  [
    "mode === 'extrude'",
    "            ? views.front.length >= 3 ||",
    "              (sweepNodes.length >= 2 &&",
    "                sweepNodes.every(",
    "                  (n) => n.polygon.length >= 3 || views.front.length >= 3",
    "                ))",
    "            : views.front.length >= 3 &&",
  ].join('\n'),
  'canBuild'
);

// Detector de "está creando": umbral (met)
re(
  ": views\\.front\\.length >= 3; // views y extrude",
  [
    ": mode === 'extrude'",
    "              ? views.front.length >= 3 ||",
    "                (sweepNodes.length >= 2 &&",
    "                  sweepNodes.every(",
    "                    (n) => n.polygon.length >= 3 || views.front.length >= 3",
    "                  ))",
    "              : views.front.length >= 3; // views y extrude",
  ].join('\n'),
  'draft-met'
);

// Detector de "está creando": huella de datos (data)
re(
  "latheProfile,\\s*meshSilhouette,\\s*meshSections,\\s*meshSideView,\\s*\\}\\);",
  [
    "latheProfile,",
    "      meshSilhouette,",
    "      meshSections,",
    "      meshSideView,",
    "      sweepNodes,",
    "    });",
  ].join('\n'),
  'draft-data'
);

// Detector de "está creando": dependencias
re(
  "meshSideView,\\s*configObjectId,\\s*isUndoRedo,\\s*obj3dOpeningName,\\s*adoptPanelAsNewObject",
  [
    "meshSideView,",
    "    sweepNodes,",
    "    configObjectId,",
    "    isUndoRedo,",
    "    obj3dOpeningName,",
    "    adoptPanelAsNewObject",
  ].join('\n'),
  'draft-deps'
);

fs.writeFileSync(FILE, src);
console.log('OK. Editor3D.tsx: ' + src.length + ' bytes');
