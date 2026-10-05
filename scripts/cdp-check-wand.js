// Verifica el fix de la varita mágica vía CDP contra el Electron dev.
// Conecta al primer target "page" de la app y evalúa el estado del <video> y la legibilidad del canvas.
const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  console.log('targets page:', pages.length);
  if (!pages.length) { console.log('NO PAGES'); return; }

  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await new Promise((r) => ws.on('open', r));

  const expr = `(() => {
    const v = document.querySelector('video[src]') || document.querySelectorAll('video')[0];
    if (!v) return { error: 'no video element' };
    let readOk = null, readErr = null;
    const w = v.videoWidth || 0, h = v.videoHeight || 0;
    if (w && h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      try { ctx.drawImage(v, 0, 0, w, h); ctx.getImageData(0, 0, 1, 1); readOk = true; }
      catch (e) { readErr = String(e); readOk = false; }
    }
    return {
      crossOrigin: v.crossOrigin,
      src: (v.currentSrc || v.src || '').slice(0, 80),
      videoW: w, videoH: h,
      readyState: v.readyState,
      paused: v.paused,
      currentTime: v.currentTime,
      readOk, readErr,
    };
  })()`;

  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(res.result?.result?.value ?? res, null, 2));
  ws.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
