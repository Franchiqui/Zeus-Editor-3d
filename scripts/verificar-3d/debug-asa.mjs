/**
 * Debug puntual: proyectar el asa del recorrido al canvas frontal y
 * muestrear los píxeles reales alrededor.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';

const R = crearResultados('DEBUG asa recorrido');
const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-pos-0-x"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-y"]', '1');
  await page.fill('[data-testid="camera-kf-pos-0-z"]', '1.5');
  await esperar(600);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', '0');
  await page.fill('[data-testid="camera-kf-pos-1-y"]', '1.5');
  await page.fill('[data-testid="camera-kf-pos-1-z"]', '-1.5');
  await esperar(1000);

  const datos = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    const cams = [];
    const asas = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 90) return;
      let h = fib.memoizedState; let n = 0;
      while (h && n < 140) {
        const v = h.memoizedState;
        const val = v && v.current;
        if (val && val.isObject3D) {
          if (val.isPerspectiveCamera || val.isOrthographicCamera) cams.push(val);
          const rama = val.getObjectByName?.('cameraObjectPath');
          if (rama && rama.parent) {
            for (const a of rama.children[1].children) asas.push({ asa: a, rama });
          }
        }
        h = h.next; n++;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    const out = [];
    const canvas = cont.querySelector('canvas');
    for (const { asa, rama } of asas.slice(0, 3)) {
      rama.updateWorldMatrix(true, true);
      const w = new (asa.position.constructor)();
      asa.getWorldPosition(w);
      const proyecciones = cams.map((cam) => {
        cam.updateMatrixWorld();
        const p = w.clone().project(cam);
        return JSON.stringify({
          cam: [Math.round(cam.position.x * 10) / 10, Math.round(cam.position.y * 10) / 10, Math.round(cam.position.z * 10) / 10],
          ndc: [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100],
        });
      });
      out.push('asa=' + JSON.stringify([w.x, w.y, w.z]) + ' asaVisible=' + asa.visible + ' ramaVisible=' + rama.visible + ' proys=' + proyecciones.join(' ; '));
    }
    out.push('canvas=' + canvas.width + 'x' + canvas.height);
    return out.join(' || ');
  });
  console.log('DATOS: ' + datos);

  // Muestrear píxeles en los puntos proyectados (visor frontal, cam 0,0,5.5)
  const muestra = await page.evaluate(async () => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const canvas = cont.querySelector('canvas');
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // centro vertical del canvas: la curva está en x=0 (centro horizontal),
    // y entre 1 y 1.5 → arriba del centro
    const cx = Math.round(off.width / 2);
    const filas = [];
    for (const dy of [0, 40, 80, 120, 160]) {
      const y = Math.round(off.height / 2) - dy;
      const tira = ctx.getImageData(cx - 30, y, 60, 1).data;
      const top = new Map();
      for (let i = 0; i < tira.length; i += 4) {
        const k = `${tira[i]},${tira[i + 1]},${tira[i + 2]}`;
        top.set(k, (top.get(k) || 0) + 1);
      }
      const mejor = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + '×' + v).join(' ');
      filas.push(`y=${y}: ${mejor}`);
    }
    return filas.join(' | ');
  });
  console.log('MUESTRA: ' + muestra);
} finally {
  await R.resumen({ browser, errores });
}