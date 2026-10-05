// Encuentra el target vivo: el que tenga un <video> con src media:// o el mayor
// número de elementos. Imprime resumen por target.
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
    const videos = [...document.querySelectorAll('video')].map(v => ({
      src: (v.currentSrc || v.src || '').slice(0, 60),
      crossOrigin: v.crossOrigin,
      w: v.videoWidth, h: v.videoHeight, rs: v.readyState,
    }));
    return {
      title: document.title,
      bodyChildren: document.body ? document.body.children.length : -1,
      iframes: document.querySelectorAll('iframe').length,
      videos,
      hasCanvas: !!document.querySelector('canvas'),
      url: location.href,
    };
  })()`;

  let found = 0;
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
    const hasMedia = val?.videos?.some(v => v.src.includes('media://'));
    const alive = val && val.bodyChildren > 0;
    if (alive) {
      found++;
      console.log(`target ${i}: body=${val.bodyChildren} iframes=${val.iframes} canvas=${val.hasCanvas} videos=${JSON.stringify(val.videos)} ${hasMedia ? ' <<< MEDIA' : ''}`);
    }
    ws.close();
  }
  console.log('alive targets:', found);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
