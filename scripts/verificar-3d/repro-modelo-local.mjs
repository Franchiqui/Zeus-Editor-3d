// repro-modelo-local.mjs: replica la llamada del chat al modelo LOCAL con el
// system prompt REAL del editor (pescado del puente IA en vivo) y el registro
// de PocketBase; vuelca la respuesta cruda y la parsea como FloatingChatButton.
import { chromium } from 'playwright';
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const correo = env.match(/^POCKETBASE_EMAIL=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
const clave = env.match(/^POCKETBASE_PASSWORD=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
const PB = 'http://127.0.0.1:8236';

// ── 1. Modelos de PocketBase ─────────────────────────────────────────────
const auth = await fetch(`${PB}/api/collections/users/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: correo, password: clave }),
}).then((r) => r.json());
const headers = { Authorization: `Bearer ${auth.token}` };
const modelos = await fetch(`${PB}/api/collections/modelos/records?perPage=20`, { headers }).then((r) => r.json());
console.log('modelos en PB:', (modelos.items ?? []).map((m) => `${m.id} ${m.name ?? m.nombre} · prov=${m.proveedor ?? m.provider} · url=${m.api_url ?? m.url ?? ''} · id_modelo=${m.id_modelo ?? m.model ?? ''}`).join('\n  '));
const locales = (modelos.items ?? []).filter((m) => /localhost|127\.0\.0\.1/i.test(m.api_url ?? m.url ?? ''));
if (locales.length === 0) { console.log('SIN modelo local configurado'); process.exit(1); }
// Args: node repro-modelo-local.mjs [prompt] [filtro de modelo]
// filtro: id de PocketBase, o trozo que case con el id_modelo (p. ej. "Qwen", "minicpm").
const [mensaje, filtroModelo] = process.argv.slice(2);
const pedido = mensaje || 'Crea un trineo en el editor 3D.';
let local = locales[0];
if (filtroModelo) {
  local = locales.find((m) => (m.id_modelo ?? m.model ?? '').toLowerCase().includes(filtroModelo.toLowerCase()))
    ?? locales.find((m) => m.id === filtroModelo);
  if (!local) { console.log(`filtro "${filtroModelo}" no casó con ningún local`); process.exit(1); }
}
console.log('PROMPT:', pedido);
console.log('local elegido:', local.id, local.name ?? local.nombre, JSON.stringify({ url: local.api_url ?? local.url, modelo: local.id_modelo ?? local.model }));

// ── 2. System prompt real del editor, pescado en vivo ────────────────────
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext();
await context.addInitScript(() => {});
const page = await context.newPage();
// reusar sembrado de auth de comun? solo necesario el editor abierto; seembramos cookies:
const { sembrarAuth } = await import('./comun.mjs');
await sembrarAuth(context);
await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
const promptEditor = await page.evaluate(() => {
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
      if (hv && typeof hv === 'object' && 'getEditorSystemPrompt' in hv) return hv.getEditorSystemPrompt();
    }
    for (let d = f.dependencies?.firstContext; d; d = d.next) {
      const ms = d.memoizedValue ?? d.value;
      if (ms && typeof ms === 'object' && 'getEditorSystemPrompt' in ms) return ms.getEditorSystemPrompt();
    }
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
  }
  return null;
});
console.log('prompt editor leído:', promptEditor ? `${promptEditor.length} caracteres` : 'NO');
fs.writeFileSync('scripts/verificar-3d/out-prompt-editor.txt', promptEditor ?? '');

// ── 2b. Pista de contexto real (objetos guardados), como hace el chat ─────
const pista = await page.evaluate(() => {
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
      if (hv && typeof hv === 'object' && 'executeAction' in hv && 'getContextHint' in hv) return hv.getContextHint();
    }
    for (let d = f.dependencies?.firstContext; d; d = d.next) {
      const ms = d.memoizedValue ?? d.value;
      if (ms && typeof ms === 'object' && 'executeAction' in ms && 'getContextHint' in ms) return ms.getContextHint();
    }
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
  }
  return null;
});
console.log('pista contexto leída:', pista ? `${pista.length} caracteres` : 'NO');

// ── 3. Llamar al modelo LOCAL con el mismo sistema ────────────────────────
const systemContext = pista ? `${promptEditor ?? ''}\n\n${pista}` : (promptEditor ?? '');
const mensajes = [
  { role: 'system', content: systemContext },
  { role: 'user', content: pedido },
];
const baseUrl = (local.api_url ?? local.url ?? '').replace(/\/+$/, '');
// Ollama nativo (/api/chat): cuerpo {model, messages, stream:false} SIN sufijo.
// OpenAI-compat: la URL del registro YA termina en /chat/completions (no se
// añade otra vez: el doble sufijo da 404 "File Not Found").
const esOllamaNative = baseUrl.endsWith('/api/chat');
const endpoint = esOllamaNative ? baseUrl
  : baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
const peticion = esOllamaNative
  ? { model: local.id_modelo ?? local.model ?? '', messages: mensajes, stream: false }
  : { model: local.id_modelo ?? local.model ?? '', messages: mensajes };
console.log('llamando a', endpoint, 'modelo', peticion.model, esOllamaNative ? '(ollama nativo)' : '');
const resp = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(peticion),
  signal: AbortSignal.timeout(300000),
});
const data = await resp.json().catch(() => null);
const texto = (data?.choices?.[0]?.message?.content ?? data?.message?.content)
  ?? JSON.stringify(data).slice(0, 500);
console.log('RESPUESTA DEL MODELO LOCAL:');
console.log(texto);
const nombreSalida = `${(local.id_modelo ?? local.model ?? 'local').replace(/[^\w.-]/g, '_')}-${texto.slice(0, 8).replace(/[^\w]/g, '_')}.txt`;
fs.writeFileSync(`scripts/verificar-3d/out-respuesta-${nombreSalida}`, texto);
await browser.close();