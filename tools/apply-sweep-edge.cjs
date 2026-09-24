'use strict';

/**
 * Añade el "cuadrado de selección" para ver las plantillas de canto en el
 * lienzo del Recorrido (Extruir), con la inclinación de cada vértice.
 *
 * Cambios:
 *  1) Editor3D.tsx  -> estado `sweepEdgeTemplates` y props en los dos
 *                      <PathCanvas> (panel y maximizado).
 *  2) lib/i18n/translations.ts -> clave `sweepShowTemplates` en los 7 idiomas.
 *
 * Idempotente: si ya está aplicado, no vuelve a insertar.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content);
}

function assertCount(haystack, needle, expected, label) {
  const count = haystack.split(needle).length - 1;
  if (count !== expected) {
    throw new Error(`[${label}] esperaba ${expected} coincidencia(s), encontré ${count}`);
  }
}

// ---------------------------------------------------------------- Editor3D.tsx
(function patchEditor() {
  const rel = 'components/editor/Editor3D.tsx';
  let src = read(rel);
  const original = src;

  // 1) Estado del selector "de canto".
  const stateAnchor = '  const [sweepSubdivisions, setSweepSubdivisions] = useState(10);';
  if (!src.includes('const [sweepEdgeTemplates')) {
    assertCount(src, stateAnchor, 1, 'sweepSubdivisions state');
    src = src.replace(
      stateAnchor,
      stateAnchor +
        '\n  // Ver la plantilla de cada vértice "de canto" (en perfil) en el\n' +
        '  // lienzo del Recorrido, girada según su inclinación.\n' +
        '  const [sweepEdgeTemplates, setSweepEdgeTemplates] = useState(false);'
    );
  }

  // 2) Props en los <PathCanvas> (panel y maximizado). Se anclan en la línea
  //    helpHint, conservando la indentación de la línea siguiente.
  const edgeProps = (indent) =>
    `${indent}showEdgeTemplates={sweepEdgeTemplates}\n` +
    `${indent}onToggleEdgeTemplates={() => setSweepEdgeTemplates((v) => !v)}\n` +
    `${indent}edgeTemplatesLabel={t('editor3D.sweepShowTemplates')}\n`;

  if (!src.includes('showEdgeTemplates={sweepEdgeTemplates}')) {
    const panelRe =
      /(helpHint=\{t\('editor3D\.sweepHelpHint'\)\}\n)([ \t]*)(onMaximize=\{\(\) => setEditingSweepCanvas\('path'\)\})/;
    const maxRe =
      /(helpHint=\{t\('editor3D\.sweepHelpHint'\)\}\n)([ \t]*)(onClose=\{\(\) => setEditingSweepCanvas\(null\)\})/;

    if (!panelRe.test(src)) throw new Error('no encontré el <PathCanvas> del panel');
    if (!maxRe.test(src)) throw new Error('no encontré el <PathCanvas> maximizado');

    src = src.replace(panelRe, (_m, a, indent, c) => a + edgeProps(indent) + indent + c);
    src = src.replace(maxRe, (_m, a, indent, c) => a + edgeProps(indent) + indent + c);
  }

  if (src === original) {
    console.log('[Editor3D.tsx] ya estaba aplicado, sin cambios');
  } else {
    write(rel, src);
    console.log('[Editor3D.tsx] parcheado');
  }
})();

// --------------------------------------------------- lib/i18n/translations.ts
(function patchI18n() {
  const rel = 'lib/i18n/translations.ts';
  let src = read(rel);
  const original = src;

  const entries = [
    ["    sweepTitle: 'Recorrido',", "    sweepShowTemplates: 'Ver plantillas de canto',"],
    ["    sweepTitle: 'Sweep path',", "    sweepShowTemplates: 'Show templates edge-on',"],
    ["    sweepTitle: 'Parcours',", "    sweepShowTemplates: 'Gabarits de profil',"],
    ["    sweepTitle: 'Verlauf',", "    sweepShowTemplates: 'Schablonen von der Seite',"],
    ["    sweepTitle: 'Percorso',", "    sweepShowTemplates: 'Sagome di profilo',"],
    ["    sweepTitle: '\u8def\u5f84',", "    sweepShowTemplates: '\u4fa7\u89c6\u663e\u793a\u6a21\u677f',"],
    ["    sweepTitle: '\u092a\u0925',", "    sweepShowTemplates: '\u091f\u0947\u092e\u094d\u092a\u0932\u0947\u091f \u0915\u093f\u0928\u093e\u0930\u0947 \u0938\u0947 \u0926\u093f\u0916\u093e\u090f\u0902',"],
  ];

  if (src.includes('sweepShowTemplates')) {
    console.log('[translations.ts] ya estaba aplicado, sin cambios');
    return;
  }

  for (const [anchor, insert] of entries) {
    assertCount(src, anchor, 1, `i18n ${anchor.trim()}`);
    src = src.replace(anchor, `${anchor}\n${insert}`);
  }

  if (src === original) throw new Error('translations.ts sin cambios');
  write(rel, src);
  console.log('[translations.ts] parcheado (7 idiomas)');
})();

console.log('OK');
