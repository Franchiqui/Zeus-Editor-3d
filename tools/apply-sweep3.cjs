const fs = require('fs');

// --- PathCanvas: hints traducibles en Editor3D ---
let ed = fs.readFileSync('components/editor/Editor3D.tsx', 'utf8');
{
  const needle = 'onRemove={removeSweepNode}';
  const parts = ed.split(needle);
  if (parts.length !== 2) throw new Error('onRemove count=' + (parts.length - 1));
  ed =
    parts[0] +
    [
      needle,
      "                       emptyHint={t('editor3D.sweepEmptyHint')}",
      "                       helpHint={t('editor3D.sweepHelpHint')}",
    ].join('\n') +
    parts[1];
  fs.writeFileSync('components/editor/Editor3D.tsx', ed);
  console.log('  - editor hints');
}

// --- i18n ---
const langs = [
  {
    anchor: "sweepRemove: 'Quitar vértice',",
    extra: [
      "    sweepEmptyHint: 'Haz clic para trazar el segmento',",
      "    sweepHelpHint: 'Arrastra los vértices · doble clic para quitarlos',",
    ],
  },
  {
    anchor: "sweepRemove: 'Remove vertex',",
    extra: [
      "    sweepEmptyHint: 'Click to draw the segment',",
      "    sweepHelpHint: 'Drag the vertices · double-click to remove',",
    ],
  },
  {
    anchor: "sweepRemove: 'Supprimer le sommet',",
    extra: [
      "    sweepEmptyHint: 'Cliquez pour tracer le segment',",
      "    sweepHelpHint: 'Faites glisser les sommets · double-clic pour les supprimer',",
    ],
  },
  {
    anchor: "sweepRemove: 'Knoten entfernen',",
    extra: [
      "    sweepEmptyHint: 'Klicke, um das Segment zu zeichnen',",
      "    sweepHelpHint: 'Knoten ziehen · Doppelklick zum Entfernen',",
    ],
  },
  {
    anchor: "sweepRemove: 'Rimuovi vertice',",
    extra: [
      "    sweepEmptyHint: 'Fai clic per tracciare il segmento',",
      "    sweepHelpHint: 'Trascina i vertici · doppio clic per rimuoverli',",
    ],
  },
  {
    anchor: "sweepRemove: '删除顶点',",
    extra: [
      "    sweepEmptyHint: '点击绘制线段',",
      "    sweepHelpHint: '拖动顶点 · 双击删除',",
    ],
  },
  {
    anchor: "sweepRemove: 'शीर्ष हटाएँ',",
    extra: [
      "    sweepEmptyHint: 'खंड खींचने के लिए क्लिक करें',",
      "    sweepHelpHint: 'शीर्ष खींचें · हटाने के लिए डबल-क्लिक करें',",
    ],
  },
];

let t = fs.readFileSync('lib/i18n/translations.ts', 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const { anchor, extra } of langs) {
  const rx = new RegExp(esc(anchor), 'g');
  const m = t.match(rx);
  if (!m || m.length !== 1) throw new Error(`[${anchor}] count=${m ? m.length : 0}`);
  t = t.replace(rx, anchor + '\n' + extra.join('\n'));
  console.log('  - i18n ' + anchor.slice(0, 24));
}
fs.writeFileSync('lib/i18n/translations.ts', t);

const edt = fs.readFileSync('components/editor/Editor3D.tsx', 'utf8');
for (const s of ['sweepEmptyHint', 'sweepHelpHint']) {
  if (!(edt.includes(s) && t.includes(s))) throw new Error('falta ' + s);
}
console.log('OK');
