/**
 * Debug puntual: crear cámara + 2 kfs, inspeccionar el grupo del recorrido
 * vía hooks del fiber y las tarjetas de la escena tras reabrir.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, 'fixtures', 'diag-camara.zeus');
const R = crearResultados('DEBUG camara');

const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await esperar(400);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', '5');
  await page.fill('[data-testid="camera-kf-pos-1-y"]', '4');
  await page.fill('[data-testid="camera-kf-pos-1-z"]', '2');
  await esperar(1000);

  const info = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const out = [];
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      // Buscar en hooks del fiber (refs viven en memoizedState) un grupo THREE
      const grupos = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 90) return;
        let h = fib.memoizedState;
        let n = 0;
        while (h && n < 120) {
          const v = h.memoizedState;
          if (v && v.current && v.current.isObject3D) {
            const g = v.current;
            const rama = g.getObjectByName('cameraObjectPath');
            if (rama) {
              grupos.push({
                visor: c,
                visible: rama.visible,
                hijos: rama.children.length,
                tubeVisible: rama.children[0]?.visible,
                tubePos: rama.children[0]?.geometry?.parameters ? 'tube' : (rama.children[0]?.type),
                handles: rama.children[1]?.children?.length,
              });
            }
          }
          h = h.next; n++;
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (grupos.length) out.push(JSON.stringify(grupos));
    }
    return out.join(' | ') || 'NO ENCONTRADO';
  });
  console.log('GRUPOS RECORRIDO: ' + info.slice(0, 400));
  console.log('TARJETAS: ' + (await page.evaluate(() => document.querySelectorAll('[data-testid^="scene-object-"]').length)));

  const cianPorVisor = await page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const out = [];
    for (let c = 0; c < conts.length; c++) {
      const canvas = conts[c] && conts[c].querySelector('canvas');
      if (!canvas) { out.push(c + ':sin canvas'); continue; }
      const url = canvas.toDataURL('image/png');
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
      const off = document.createElement('canvas');
      off.width = canvas.width; off.height = canvas.height;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      const f0 = [d[0], d[1], d[2]];
      let cian = 0, morado = 0, tinta = 0;
      const hist = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) tinta++;
        if (b - r > 60 && g > 120 && b > 150) cian++;
        if (r > 100 && b > 180 && g < 90) morado++;
        // Histograma de colores "saturados" (no grises)
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn > 40) {
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          hist.set(key, (hist.get(key) || 0) + 1);
        }
      }
      const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `(${k.replace(/,/g, '·')}×${v})`).join(' ');
      out.push(`${c}: cian=${cian} morado=${morado} tinta=${tinta} top=${top}`);
    }
    return out.join(' | ');
  });
  console.log('CIAN POR VISOR: ' + cianPorVisor);

  const geo = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    const found = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 90 || found.length) return;
      let h = fib.memoizedState; let n = 0;
      while (h && n < 120) {
        const v = h.memoizedState;
        if (v && v.current && v.current.isObject3D) {
          const rama = v.current.getObjectByName?.('cameraObjectPath');
          if (rama) {
            const tube = rama.children[0];
            const pos = rama.children[1]?.children?.map((a) => [a.position.x, a.position.y, a.position.z]);
            const attr = tube?.geometry?.attributes?.position;
            const arr = attr ? Array.from(attr.array).slice(0, 6) : null;
            found.push(JSON.stringify({
              parentChain: (() => { let p = rama.parent, s = ''; while (p && s.length < 60) { s += p.name + '/'; p = p.parent; } return s; })(),
              worldVisible: (() => { let p = rama; let vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } return vis; })(),
              tubeType: tube?.type,
              primerosVerts: arr,
              asas: pos,
            }));
            return;
          }
        }
        h = h.next; n++;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f && !found.length; f = f.return) visit(f, 0);
    return found.join(' | ') || 'NO';
  });
  console.log('GEO: ' + geo);

  const cuerpo = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    const found = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 90 || found.length) return;
      let h = fib.memoizedState; let n = 0;
      while (h && n < 120) {
        const v = h.memoizedState;
        if (v && v.current && v.current.isObject3D) {
          const g = v.current;
          if (g.name === 'meshGroup' || (g.type === 'Group' && g.children.some?.((c) => c.userData?.cameraBodyActive))) {
            const cuerpoRoot = g.getObjectByName('cameraBodyRoot');
            found.push(JSON.stringify({
              groupName: g.name,
              hijos: g.children.map((c) => c.name || c.type).slice(0, 12),
              cuerpo: cuerpoRoot ? {
                visible: cuerpoRoot.visible,
                position: [cuerpoRoot.position.x, cuerpoRoot.position.y, cuerpoRoot.position.z],
                hijoNombres: cuerpoRoot.children.map((c) => c.name || c.type),
                mundo: (() => { const p = new (cuerpoRoot.position.constructor)(); cuerpoRoot.getWorldPosition(p); return [p.x, p.y, p.z]; })(),
              } : 'SIN CUERPO',
            }));
            return;
          }
        }
        h = h.next; n++;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f && !found.length; f = f.return) visit(f, 0);
    return found.join(' | ') || 'NO';
  });
  console.log('CUERPO: ' + cuerpo);

  const proyecta = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    const found = [];
    const cams = [];
    const cuerpos = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 90) return;
      let h = fib.memoizedState; let n = 0;
      while (h && n < 140) {
        const v = h.memoizedState;
        const val = v && v.current;
        if (val && val.isObject3D) {
          if (val.isPerspectiveCamera || val.isOrthographicCamera) cams.push(val);
          const root = val.getObjectByName?.('cameraBodyRoot');
          if (root) cuerpos.push(root);
        }
        h = h.next; n++;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    // Deduplicar cámaras por posición+tipo
    const vistas = new Set();
    const unicas = cams.filter((c) => {
      const k = `${c.isOrthographicCamera ? 'o' : 'p'}${Math.round(c.position.x)},${Math.round(c.position.y)},${Math.round(c.position.z)}`;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
    found.push(`cams=${unicas.length}: ${unicas.map((c) => (c.isOrthographicCamera ? 'ortho' : 'persp') + '@' + [c.position.x, c.position.y, c.position.z].map((x) => Math.round(x * 10) / 10).join(',')).join(' ; ')}`);
    for (const root of cuerpos.slice(0, 2)) {
      root.updateWorldMatrix(true, true);
      const wpos = new (root.position.constructor)();
      root.getWorldPosition(wpos);
      for (const cam of unicas) {
        const p = wpos.clone().project(cam);
        found.push(JSON.stringify({
          cam: cam.isOrthographicCamera ? 'ortho' : 'persp',
          camPos: [cam.position.x, cam.position.y, cam.position.z].map((x) => Math.round(x * 10) / 10),
          ndc: [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100],
        }));
      }
      found.push('wpos=' + JSON.stringify([wpos.x, wpos.y, wpos.z]));
    }
    return found.join(' | ') || 'NO';
  });
  console.log('PROYECTA: ' + proyecta);

  // Histograma de la franja central de cada canvas (donde debería estar
  // el cuerpo si la cámara del panel lo enmarca)
  const muestreo = await page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const out = [];
    for (let c = 0; c < conts.length; c++) {
      const canvas = conts[c] && conts[c].querySelector('canvas');
      if (!canvas) continue;
      const url = canvas.toDataURL('image/png');
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
      const off = document.createElement('canvas');
      off.width = canvas.width; off.height = canvas.height;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const cx = Math.round(off.width / 2), cy = Math.round(off.height / 2);
      const tira = ctx.getImageData(cx - 60, cy - 60, 120, 120).data;
      const hist = new Map();
      for (let i = 0; i < tira.length; i += 4) {
        const key = `${tira[i] >> 3},${tira[i + 1] >> 3},${tira[i + 2] >> 3}`;
        hist.set(key, (hist.get(key) || 0) + 1);
      }
      const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, v]) => `(${k.replace(/,/g, '·')}×${v})`).join(' ');
      out.push(`${c}: centro120 ${top}`);
    }
    return out.join(' | ');
  });
  console.log('MUESTREO: ' + muestreo);
} finally {
  await R.resumen({ browser, errores });
}