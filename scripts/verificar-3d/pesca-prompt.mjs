// pesca-prompt.mjs: solo busca el system prompt del editor en vivo y lo
// guarda (sin llamar a ningún modelo). Para verificar cambios por hot-reload.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext();
await sembrarAuth(context);
const page = await context.newPage();
await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
const prompt = await page.evaluate(() => {
  // Puente: contiene executeAction+applyZeiaPlans (diag4) y getEditorSystemPrompt
  // (repro). La PISTA de contexto no va en el prompt: se llama aparte.
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const vistos = new Set(); const cola = [raiz];
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue; vistos.add(f);
    for (let h = f.memoizedState; h; h = h.next) {
      const hv = h.memoizedState;
      if (hv && typeof hv === 'object' && 'getEditorSystemPrompt' in hv) window.__bridge = window.__bridge ?? hv;
      if (hv && typeof hv === 'object' && 'executeAction' in hv && 'getContextHint' in hv) window.__hint = hv;
    }
    for (let d = f.dependencies?.firstContext; d; d = d.next) {
      const ms = d.memoizedValue ?? d.value;
      if (ms && typeof ms === 'object' && 'getEditorSystemPrompt' in ms) window.__bridge = window.__bridge ?? ms;
      if (ms && typeof ms === 'object' && 'executeAction' in ms && 'getContextHint' in ms) window.__hint = window.__hint ?? ms;
    }
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
  }
  return window.__bridge?.getEditorSystemPrompt?.() ?? null;
});
const pista = await page.evaluate(() => window.__hint?.getContextHint?.() ?? null);
fs.writeFileSync('scripts/verificar-3d/out-pista-contexto.txt', pista ?? '');
console.log('prompt:', prompt ? `${prompt.length} chars` : 'NO');
console.log('pista contexto:', pista ? `${pista.length} chars` : 'NO');
console.log('pista lista Trineo/Avion/Coche:', ['Trineo', 'Avion', 'Coche'].every((n) => pista?.includes(`"${n}"`)) ? 'SÍ' : 'NO');
console.log('línea loadSavedObject nueva:', prompt?.includes('trineo, "avion/avión", "coche"') ? 'SÍ' : 'NO');
console.log('pista Trineo en prompt:', prompt?.includes('"Trineo"') ? 'SÍ' : 'NO');
await browser.close();