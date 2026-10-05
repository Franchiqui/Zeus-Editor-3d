/**
 * Debug puntual: reabrir diag-camara.zeus e inspeccionar el panel Escena.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, 'fixtures', 'diag-camara.zeus');
const R = crearResultados('DEBUG reabrir');

const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles('[data-testid="zeus-file-input"]', ARCHIVO);
  await esperar(3500);

  const panel = await page.evaluate(() => {
    const lista = document.querySelector('[data-testid="scene-object-list"]');
    const tarjetas = document.querySelectorAll('[data-testid^="scene-object-"]').length;
    const botones = Array.from(document.querySelectorAll('button[title]'))
      .map((b) => b.title)
      .filter((t) => /objeto|Objeto/.test(t))
      .slice(0, 20);
    return JSON.stringify({ lista: !!lista, tarjetas, botones, tabActiva: document.querySelector('[data-testid="tab-scene"]')?.className?.slice(0, 80) });
  });
  console.log('PANEL: ' + panel);
  const tabs = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="tab-"]')) {
      out.push(el.getAttribute('data-testid') + ':' + (/green/.test(el.className || '') ? 'ACTIVA' : 'off'));
    }
    return out.join(' ');
  });
  console.log('TABS: ' + tabs);
  const modos = await page.evaluate(() => {
    // mode del Editor via fiber: buscar props con .mode string
    const cont = document.querySelector('[data-testid="viewer-container"]');
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    const vals = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 40) return;
      const p = fib.memoizedProps;
      if (p && typeof p.mode === 'string' && typeof p.setSceneMode === 'function') {
        out.push('mode=' + p.mode);
        return;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f && !out.length; f = f.return) visit(f, 0);
    return out.join(',') || '?';
  });
  console.log('MODOS: ' + modos);
  console.log('TITULOS: ' + await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="scene-object-list"] button')).map((b) => b.title || b.textContent?.trim()).join(' ¦ ')));
} finally {
  await R.resumen({ browser, errores });
}