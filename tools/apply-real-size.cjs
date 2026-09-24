#!/usr/bin/env node
/**
 * 1) Plantillas (drawing-canvas.tsx): poder REDUCIR todo lo que se quiera.
 *    - Se quita el tope inferior de zoom (antes 0.5 -> ahora ZOOM_MIN = 0.01).
 *    - La rejilla limita el numero de lineas para no colapsar el DOM al alejarse.
 *    - Los trazos principales se escalan por uiScale para seguir visibles.
 * 2) Recorrido (path-canvas.tsx): ver el TAMANO REAL de la plantilla de cada
 *    vertice. Antes se dibujaba con un radio arbitrario (clamp 4..16 de
 *    profileRadius*60); ahora es el tamano real: profileRadius * 100, la misma
 *    proporcion que usa la malla barrida (UNIT*scale en ambos lados).
 *    Ademas se permite reducir (alejar) el recorrido (ZOOM_MIN = 0.05).
 *
 * Con zoom = 1 (uiScale = 1) el aspecto no cambia.
 *
 * Idempotente: si ya esta aplicado no hace nada. Respeta LF/CRLF de cada archivo.
 */
const fs = require('fs');
const path = require('path');

// Nota: se comprueba PRIMERO si el resultado ('to') ya esta presente; asi la
// sustitucion es idempotente aunque 'from' siga apareciendo dentro de 'to'.
function replaceOnce(src, from, to, label) {
  if (src.indexOf(to) !== -1) { console.log('· ya aplicado:', label); return src; }
  const i = src.indexOf(from);
  if (i === -1) throw new Error('No encontrado: ' + label + ' -> ' + from);
  if (src.indexOf(from, i + 1) !== -1) throw new Error('No unico: ' + label);
  console.log('✔', label);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

function replaceAll(src, from, to, label) {
  if (src.indexOf(from) === -1) { console.log('· ya aplicado:', label); return src; }
  const n = src.split(from).length - 1;
  console.log('✔', label, `(${n})`);
  return src.split(from).join(to);
}

/* ============================ drawing-canvas.tsx (LF) ====================== */
{
  const p = path.resolve(__dirname, '../components/drawing-canvas.tsx');
  if (!fs.existsSync(p + '.realsize.bak')) fs.copyFileSync(p, p + '.realsize.bak');
  const NL = fs.readFileSync(p, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  let s = fs.readFileSync(p, 'utf8');

  // a) Quitar el tope inferior de zoom (0.5) para poder reducir todo lo que se quiera.
  s = replaceOnce(s,
    '  const clampZoom = (z: number) => Math.max(0.5, Math.min(8, z));',
    [
      '  // Se puede reducir la plantilla todo lo que se quiera (limite practico).',
      '  const ZOOM_MIN = 0.01;',
      '  const ZOOM_MAX = 8;',
      '  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));',
    ].join(NL),
    'clampZoom: tope inferior 0.5 -> ZOOM_MIN');

  // b) Rejilla: limitar el numero de lineas cuando la vista es muy amplia.
  s = replaceOnce(s,
    '  const gyEnd = Math.ceil(canvasBounds.maxY * resolution);' + NL + '  for (let i = gxStart; i <= gxEnd; i++) {',
    [
      '  const gyEnd = Math.ceil(canvasBounds.maxY * resolution);',
      '  // Al reducir mucho la vista, dibujar menos lineas para no colapsar el DOM.',
      '  const maxGrid = 90;',
      '  const gStepX = Math.max(1, Math.ceil((gxEnd - gxStart) / maxGrid));',
      '  for (let i = gxStart; i <= gxEnd; i += gStepX) {',
    ].join(NL),
    'rejilla: paso X');

  s = replaceOnce(s,
    '  for (let i = gyStart; i <= gyEnd; i++) {',
    [
      '  const gStepY = Math.max(1, Math.ceil((gyEnd - gyStart) / maxGrid));',
      '  for (let i = gyStart; i <= gyEnd; i += gStepY) {',
    ].join(NL),
    'rejilla: paso Y');

  // c) Trazos principales constantes en pantalla (identico a 100%).
  s = replaceAll(s, 'strokeWidth={0.3}', 'strokeWidth={0.3 * uiScale}', 'trazo 0.3');
  s = replaceAll(s, 'strokeWidth={0.2}', 'strokeWidth={0.2 * uiScale}', 'trazo 0.2');
  s = replaceAll(s, 'strokeWidth={0.15}', 'strokeWidth={0.15 * uiScale}', 'trazo 0.15');

  fs.writeFileSync(p, s);
}

/* ============================ path-canvas.tsx (CRLF) ======================= */
{
  const p = path.resolve(__dirname, '../components/editor/path-canvas.tsx');
  if (!fs.existsSync(p + '.realsize.bak')) fs.copyFileSync(p, p + '.realsize.bak');
  const NL = fs.readFileSync(p, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  let s = fs.readFileSync(p, 'utf8');

  // a) Radio real de la plantilla "de canto" (misma proporcion que la malla barrida).
  s = replaceOnce(s,
    '                const r = Math.max(4, Math.min(16, profileRadius(p.polygon) * 60));',
    [
      '                // Tamano REAL de la plantilla (misma escala que la malla barrida:',
      '                // el lienzo 0..1 -> 0..100 en ambos lados).',
      '                const r = profileRadius(p.polygon) * 100;',
    ].join(NL),
    'radio real de la plantilla');

  // b) Plantilla por defecto mas pequena (para contornos vacios/degenerados).
  s = replaceOnce(s,
    '  if (!polygon || polygon.length < 3) return 0.3;',
    '  if (!polygon || polygon.length < 3) return 0.06;',
    'profileRadius: fallback <3 puntos');
  s = replaceOnce(s,
    '  return r || 0.3;',
    '  return r || 0.06;',
    'profileRadius: fallback r=0');

  // c) Permitir reducir (alejar) el recorrido.
  s = replaceOnce(s,
    '  const clampPan = (v: number, z: number) =>',
    [
      '  // Rango de zoom del recorrido: se puede reducir bastante para ver todo.',
      '  const ZOOM_MIN = 0.05;',
      '  const ZOOM_MAX = 8;',
      '  const clampPan = (v: number, z: number) =>',
    ].join(NL),
    'path: definir ZOOM_MIN/ZOOM_MAX');

  s = replaceAll(s,
    'const nz = Math.max(1, Math.min(8, zoom * factor));',
    'const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));',
    'path: clamp de zoom');

  s = replaceOnce(s,
    '            disabled={zoom <= 1}',
    '            disabled={zoom <= ZOOM_MIN}',
    'path: boton alejar');
  s = replaceOnce(s,
    '            disabled={zoom >= 8}',
    '            disabled={zoom >= ZOOM_MAX}',
    'path: boton acercar');

  fs.writeFileSync(p, s);
}

console.log('\nListo.');
