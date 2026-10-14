// lee-chat-golpe.mjs: lee de PocketBase las conversaciones recientes y sus
// mensajes con contenido crudo (incluye los bloques [ZEUS_ACTION]) para
// diagnosticar qué emite el modelo local. CREDENCIALES: .env.local (users).
// Uso: node lee-chat-golpe.mjs [--full] [N]
import fs from 'node:fs';

const URLS = ['http://127.0.0.1:8236', 'https://zeus-media-studio-ia.fly.dev'];
const args = process.argv.slice(2);
const dumpFull = args.includes('--full');
const argN = args.find((a) => /^\d+$/.test(a));
const cuantas = argN ? +argN : 4;

let correo = '', clave = '';
const env = fs.readFileSync('.env.local', 'utf8');
const m1 = env.match(/^POCKETBASE_EMAIL=(.*)$/m);
const m2 = env.match(/^POCKETBASE_PASSWORD=(.*)$/m);
if (m1) correo = m1[1].trim().replace(/^["']|["']$/g, '');
if (m2) clave = m2[1].trim().replace(/^["']|["']$/g, '');
if (!correo || !clave) { console.log('Sin POCKETBASE_EMAIL/PASSWORD en .env.local'); process.exit(1); }

async function pbBase() {
  for (const base of URLS) {
    try {
      const r = await fetch(`${base}/api/collections/users/auth-with-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: correo, password: clave }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.token) return { base, token: j.token };
    } catch { /* siguiente: base local */ }
  }
  return null;
}

const sesion = await pbBase();
if (!sesion) { console.log('No autenticó contra ninguna PocketBase'); process.exit(1); }
console.log('PocketBase:', sesion.base);
const headers = { Authorization: `Bearer ${sesion.token}` };

const cons = await fetch(`${sesion.base}/api/collections/conversations/records?perPage=10&sort=-created`, { headers }).then((r) => r.json());
const lista = cons.items ?? [];
console.log('conversaciones recientes:', lista.length);
if (cons.message) console.log('aviso:', cons.message);
for (const c of lista.slice(0, cuantas)) {
  const filtro = encodeURIComponent(`conversation="${c.id}"`);
  const res = await fetch(`${sesion.base}/api/collections/messages/records?perPage=60&sort=created&filter=${filtro}`, { headers });
  const data = await res.json().catch(() => ({ items: [] }));
  console.log(`\n===== conv ${c.id} · ${c.created} · campos: ${Object.keys(c).join(',')}`);
  for (const m of (data.items ?? [])) {
    const rol = m.role ?? '?';
    const contenido = m.content ?? m.content_text ?? '';
    console.log(`\n--- [${rol}]`);
    console.log(dumpFull ? contenido : contenido.slice(0, 1200));
  }
}