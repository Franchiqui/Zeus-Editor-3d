// Escanea TODOS los <video> del target y prueba getImageData en cada uno.
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
  const { default: WebSocket } = await import('ws');

  const expr = `(() => {
    const out = [];
    for (const v of document.querySelectorAll('video')) {
      const w = v.videoWidth || 0, h = v.videoHeight || 0;
      let readOk = null, readErr = null;
      if (w && h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        try { ctx.drawImage(v, 0, 0, w, h); ctx.getImageData(0, 0, 1, 1); readOk = true; }
        catch (e) { readErr = String(e).slice(0, 80); readOk = false; }
      }
      out.push({
        crossOrigin: v.crossOrigin,
        src: (v.currentSrc || v.src || '').slice(0, 70),
        w, h, readyState: v.readyState, paused: v.paused,
        currentTime: v.currentTime,
        readOk, readErr,
      });
    }
    return out;
  })()`;

  for (let i = 0; i < pages.length; i++) {
    const ws = new WebSocket(pages[i].webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const mid = ++id; pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    await new Promise((r) => ws.on('open', r));
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const val = res.result?.result?.value;
    if (val && val.length) {
      console.log('=== target', i, pages[i].url.slice(0, 60), '===');
      console.log(JSON.stringify(val, null, 1));
    }
    ws.close();
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
