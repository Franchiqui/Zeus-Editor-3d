/* Smoke test de la API ZEIA. Ejecuta: node _smoke.js */
process.env.ZEIA_JOB_SECONDS = '1';
require('ts-node/register/transpile-only');
const net = require('net');

const mod = require('./api.ts');
const { server } = mod;

const BASE = 'http://127.0.0.1:3099';
let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + label);
  } else {
    fail++;
    console.log('  \u2717 ' + label + (extra ? '  ->  ' + JSON.stringify(extra) : ''));
  }
}
async function req(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, ct };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wsHandshake(path) {
  return new Promise((resolve) => {
    const sock = net.connect(3099, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:3099\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n')) {
        sock.destroy();
        resolve(buf.split('\r\n')[0]);
      }
    });
    sock.on('error', () => resolve('ERROR'));
    setTimeout(() => {
      try { sock.destroy(); } catch {}
      resolve(buf.split('\r\n')[0] || 'TIMEOUT');
    }, 2000);
  });
}

async function main() {
  await new Promise((r) => server.listen(3099, r));
  console.log('\n=== ZEIA smoke test ===');

  console.log('\n[System]');
  let r = await req('GET', '/health');
  ok(r.status === 200 && r.data.status === 'ok', 'GET /health');
  r = await req('GET', '/v1/meta');
  ok(r.status === 200 && r.data.tabs.length === 10, 'GET /v1/meta (10 tabs)');

  console.log('\n[Tabs & Prompts]');
  r = await req('GET', '/v1/tabs');
  ok(r.status === 200 && Array.isArray(r.data) && r.data.length === 10, 'GET /v1/tabs');
  r = await req('GET', '/v1/tabs/animation');
  ok(r.status === 200 && r.data.tab === 'animation', 'GET /v1/tabs/animation');
  r = await req('GET', '/v1/tabs/animation/tools');
  ok(r.status === 200 && r.data.some((t) => t.name === 'create_keyframe'), 'GET tools (create_keyframe)');
  r = await req('GET', '/v1/tabs/animation/prompt');
  ok(r.status === 200 && /keyframes/.test(r.data.system_prompt), 'GET prompt animation');
  r = await req('GET', '/v1/tabs/animation/schema');
  ok(r.status === 200 && r.data.properties.action.enum.includes('motions.create'), 'GET schema animation');
  r = await req('POST', '/v1/tabs/animation/prompt/render', { variables: { fps: 60 } });
  ok(r.status === 200 && typeof r.data.rendered === 'string', 'POST prompt/render');
  r = await req('GET', '/v1/tabs/nope');
  ok(r.status === 404 && r.ct.includes('problem+json'), 'GET tab inválida -> 404 problem+json');

  console.log('\n[Projects & sessions]');
  r = await req('GET', '/v1/projects');
  ok(r.status === 200 && r.data.length >= 1, 'GET /v1/projects');
  const projectId = r.data[0].id;
  r = await req('POST', '/v1/projects', { name: 'Test Project', tabs: ['modeling', 'animation'] });
  ok(r.status === 201 && r.data.id, 'POST /v1/projects');
  const newProjectId = r.data.id;
  r = await req('GET', `/v1/projects/${projectId}`);
  ok(r.status === 200 && Array.isArray(r.data.scenes), 'GET /v1/projects/{id} con escenas');
  const sceneId = r.data.scenes[0].id;
  r = await req('POST', `/v1/projects/${newProjectId}/sessions`);
  ok(r.status === 201 && r.data.ws_url.startsWith('/ws/session/'), 'POST sessions');
  r = await req('DELETE', `/v1/sessions/${r.data.id}`);
  ok(r.status === 204, 'DELETE sessions');
  r = await req('PATCH', `/v1/projects/${newProjectId}`, { name: 'Renombrado' });
  ok(r.status === 200 && r.data.name === 'Renombrado', 'PATCH project');

  console.log('\n[Scenes & Objects]');
  r = await req('GET', `/v1/scenes/${sceneId}/objects`);
  ok(r.status === 200 && r.data.length >= 1, 'GET objects');
  r = await req('POST', `/v1/scenes/${sceneId}/objects`, { type: 'mesh', geometry: { primitive: 'sphere' } });
  ok(r.status === 201 && r.data.type === 'mesh', 'POST object (sphere)');
  const objId = r.data.id;
  r = await req('GET', `/v1/objects/${objId}`);
  ok(r.status === 200 && r.data.geometry.primitive === 'sphere', 'GET object');
  r = await req('PATCH', `/v1/objects/${objId}`, { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  ok(r.status === 200 && r.data.transform.position[1] === 2, 'PATCH object transform');
  r = await req('POST', `/v1/objects/${objId}/duplicate`);
  ok(r.status === 201 && r.data.id !== objId, 'POST object duplicate');
  const dupId = r.data.id;
  r = await req('POST', `/v1/objects/${objId}/parent`, { parent_id: null });
  ok(r.status === 200, 'POST object parent');
  r = await req('POST', '/v1/objects/batch', { operations: [
    { op: 'create', scene_id: sceneId, data: { type: 'mesh', geometry: { primitive: 'cube' } } },
    { op: 'update', id: objId, data: { name: 'SphereX' } },
    { op: 'delete', id: dupId },
  ] });
  ok(r.status === 200 && r.data.results.length === 3, 'POST objects/batch (3 ops)');

  console.log('\n[Motions & Animations]');
  r = await req('POST', `/v1/objects/${objId}/motions`, { type: 'rotate', duration: 3 });
  ok(r.status === 201 && r.data.keyframes.length === 2, 'POST motion rotate');
  const motionId = r.data.id;
  r = await req('GET', `/v1/objects/${objId}/motions`);
  ok(r.status === 200 && r.data.length === 1, 'GET motions');
  r = await req('POST', '/v1/animations', { name: 'Walk Cycle', duration: 5, fps: 30 });
  ok(r.status === 201 && r.data.fps === 30, 'POST animation');
  const animId = r.data.id;
  r = await req('POST', '/v1/animations', { name: 'Bad fps', fps: 5 });
  ok(r.status === 422 && r.ct.includes('problem+json'), 'POST animation fps inválido -> 422');
  r = await req('POST', `/v1/animations/${animId}/tracks`, { object_id: objId, motion_id: motionId });
  ok(r.status === 201 && r.data.id, 'POST animation track');
  const trackId = r.data.id;
  r = await req('POST', `/v1/animations/${animId}/keyframes`, { track_id: trackId, keyframes: [{ t: 1, value: [0, 90, 0], easing: 'linear' }] });
  ok(r.status === 201 && r.data.added === 1, 'POST animation keyframes');
  r = await req('POST', `/v1/animations/${animId}/play`);
  ok(r.status === 200 && r.data.playing, 'POST animation play');
  r = await req('POST', `/v1/animations/${animId}/render`, { format: 'mp4', fps: 30 });
  ok(r.status === 202 && r.data.job_id, 'POST animation render (202)');
  await sleep(1400);
  r = await req('GET', `/v1/animations/${animId}/status`);
  ok(r.status === 200 && r.data.status === 'completed', 'GET animation status (completed)');

  console.log('\n[Plugins]');
  r = await req('GET', '/v1/plugins');
  ok(r.status === 200 && r.data.length >= 5, 'GET plugins');
  r = await req('POST', '/v1/plugins/plg_volumetric_fog/install');
  ok(r.status === 200 && r.data.status === 'installed', 'POST plugin install');
  r = await req('GET', '/v1/plugins/plg_volumetric_fog/capabilities');
  ok(r.status === 200 && r.data.capabilities.includes('fog'), 'GET plugin capabilities');
  r = await req('POST', '/v1/plugins', { name: 'My Plugin', capabilities: ['x'] });
  ok(r.status === 201 && r.data.id.startsWith('plg_'), 'POST plugin register');
  r = await req('POST', '/v1/plugins/plg_volumetric_fog/disable');
  ok(r.status === 200 && r.data.status === 'disabled', 'POST plugin disable');

  console.log('\n[Effects]');
  r = await req('GET', '/v1/effects');
  ok(r.status === 200 && r.data.catalog.length >= 5, 'GET effects catalog');
  r = await req('POST', '/v1/effects', { name: 'Dense Fog', params: { density: 0.9 } });
  ok(r.status === 201 && r.data.id.startsWith('eff_'), 'POST effect');
  const effId = r.data.id;
  r = await req('POST', `/v1/effects/${effId}/apply`, { targets: [sceneId] });
  ok(r.status === 200 && r.data.applied_to.includes(sceneId), 'POST effect apply');
  r = await req('POST', `/v1/effects/${effId}/preview`);
  ok(r.status === 200 && r.data.preview_id, 'POST effect preview');
  r = await req('PATCH', `/v1/effects/${effId}`, { params: { density: 0.5 } });
  ok(r.status === 200 && r.data.params.density === 0.5, 'PATCH effect');

  console.log('\n[Exports]');
  r = await req('POST', '/v1/exports', { format: 'gltf', target: 'my_scene', scene_id: sceneId });
  ok(r.status === 202 && r.data.job_id, 'POST export (202)');
  const exportId = r.data.id;
  await sleep(1400);
  r = await req('GET', `/v1/exports/${exportId}`);
  ok(r.status === 200 && r.data.status === 'completed', 'GET export status (completed)');
  const dl = await fetch(`${BASE}/v1/exports/${exportId}/download`);
  ok(dl.status === 200 && (dl.headers.get('content-disposition') || '').includes('attachment'), 'GET export download');

  console.log('\n[AI orchestration]');
  r = await req('POST', '/v1/ai/plan', { intent: 'Crea una escena con un cubo animado y niebla volumétrica, expórtala a MP4', project_id: projectId });
  ok(r.status === 201 && r.data.steps.length === 5, 'POST ai/plan (5 pasos como el README)', r.data);
  const planId = r.data.plan_id;
  ok(r.data.steps[0].action === 'objects.create' && r.data.steps[4].action === 'animations.render', 'plan: primer y último paso correctos');
  r = await req('POST', '/v1/ai/execute', { plan_id: planId, auto_approve: true });
  ok(r.status === 200 && r.data.results.every((x) => x.ok !== undefined), 'POST ai/execute');
  r = await req('POST', '/v1/ai/execute', { plan_id: 'pln_inexistente' });
  ok(r.status === 404 && r.ct.includes('problem+json'), 'POST ai/execute plan inexistente -> 404');
  r = await req('GET', '/v1/ai/context');
  ok(r.status === 200 && r.data.counts.objects >= 1, 'GET ai/context');
  r = await req('POST', '/v1/ai/feedback', { plan_id: planId, rating: 5, comment: 'ok' });
  ok(r.status === 201 && r.data.id.startsWith('fbk_'), 'POST ai/feedback');

  console.log('\n[Webhooks & Events]');
  r = await req('GET', '/v1/webhooks/events');
  ok(r.status === 200 && r.data.events.includes('plugin.installed'), 'GET webhooks/events');
  r = await req('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/noop', events: ['plugin.installed'] });
  ok(r.status === 201 && r.data.id.startsWith('whk_'), 'POST webhook');
  r = await req('GET', '/v1/webhooks');
  ok(r.status === 200 && r.data.length === 1, 'GET webhooks');

  console.log('\n[Auth]');
  r = await req('POST', '/v1/auth/token', { grant_type: 'client_credentials', client_id: 'zeus-ai', client_secret: 'x' });
  ok(r.status === 201 && r.data.access_token && r.data.refresh_token, 'POST auth/token');
  const refresh = r.data.refresh_token;
  r = await req('POST', '/v1/auth/refresh', { refresh_token: refresh });
  ok(r.status === 201 && r.data.access_token, 'POST auth/refresh');
  r = await req('POST', '/v1/auth/api-keys', { name: 'svc' });
  ok(r.status === 201 && r.data.api_key.startsWith('zc_'), 'POST auth/api-keys');

  console.log('\n[OpenAPI / Swagger]');
  r = await req('GET', '/openapi.json');
  const npaths = Object.keys(r.data.paths || {}).length;
  ok(r.status === 200 && npaths >= 45, `GET /openapi.json (${npaths} rutas)`);

  console.log('\n[WebSocket]');
  const hs = await wsHandshake('/ws/session/ses_test');
  ok(/101 Switching Protocols/.test(hs), 'WS handshake 101', hs);
  const hsBad = await wsHandshake('/ws/nope');
  ok(!/101/.test(hsBad), 'WS ruta inválida rechazada', hsBad);

  console.log('\n[404 / errores]');
  r = await req('GET', '/v1/does-not-exist');
  ok(r.status === 404 && r.ct.includes('problem+json') && r.data.type, 'GET ruta inexistente -> problem+json');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FALLOS ===\n`);
  server.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('SMOKE CRASH', e);
  process.exit(2);
});
