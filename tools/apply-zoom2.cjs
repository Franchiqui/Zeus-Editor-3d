#!/usr/bin/env node
/**
 * drawing-canvas.tsx: mantener constante en pantalla el tamaño de los
 * v\u00e9rtices y las zonas de agarre (halos) al hacer zoom.
 * Con zoom = 1 (uiScale = 1) no cambia nada.
 */
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '../components/drawing-canvas.tsx');

function replaceOnce(src, from, to, label) {
  const i = src.indexOf(from);
  if (i === -1) {
    if (src.indexOf(to) !== -1) { console.log('\u00b7 ya aplicado:', label); return src; }
    throw new Error('No encontrado: ' + label + ' -> ' + from);
  }
  if (src.indexOf(from, i + 1) !== -1) throw new Error('No \u00fanico: ' + label);
  console.log('\u2714', label);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

let s = fs.readFileSync(p, 'utf8');
if (!s.includes('.zoom2.bak')) { /* marcador inofensivo */ }
if (!fs.existsSync(p + '.zoom2.bak')) fs.copyFileSync(p, p + '.zoom2.bak');

s = replaceOnce(s,
  '  const viewSpan = span * 100;',
  '  const viewSpan = span * 100;\n  // Tama\u00f1o constante en pantalla de v\u00e9rtices y halos de agarre.\n  const uiScale = 1 / effZoom;',
  'definir uiScale');

s = replaceOnce(s, 'r={2.2}', 'r={2.2 * uiScale}', 'halo del asa');
s = replaceOnce(s, 'r={3}', 'r={3 * uiScale}', 'halo del v\u00e9rtice');
s = replaceOnce(s, 'r={1.8}', 'r={1.8 * uiScale}', 'anillo hover');
s = replaceOnce(s, 'r={dragIndex === i ? 0.65 : 0.5}', 'r={(dragIndex === i ? 0.65 : 0.5) * uiScale}', 'punto de v\u00e9rtice');
s = replaceOnce(s, 'r={0.65}', 'r={0.65 * uiScale}', 'punto del asa');

fs.writeFileSync(p, s);
console.log('\nListo.');
