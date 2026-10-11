/**
 * PROBE 2 — Clic de vértice en posición CALCULADA.
 * Carga Cubo.zeus, lee panelCameras por React fiber, replica la cámara
 * del visor (orto para ventanas planas, perspectiva para la 3D libre),
 * proyecta las 8 esquinas del cubo y cliquea las 2 superiores de la
 * silueta con pequeños márgenes. Comprueba la cuenta de la barra.
 */
import { abrirEditor, esperar } from './comun.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CUBO = path.join(AQUI, '..', '..', 'public', 'Obj-3D', 'Cubo.zeus');
const DOC = JSON.parse((await import('node:fs')).readFileSync(CUBO, 'utf8'));

const { browser, page, errores } = await abrirEditor();

page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[ZPICK]')) console.log('  🖥', t);
});

const textoBarra = () => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="face-select-bar"]');
  return bar ? bar.textContent?.replace(/\s+/g, ' ').slice(0, 40) ?? '' : '(sin barra)';
});
const cuentaBarra = (b) => parseInt((b.match(/(\d+)\s*v[eé]rtice(s?)/) || [])[1] ?? '0', 10);

// panelCameras actuales (estado real del editor) por React fiber.
const leerCamaras = () => page.evaluate(() => {
  const conts = document.querySelectorAll('[data-testid="viewer-container"]');
  for (const cont of conts) {
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) continue;
    for (let f = cont[llave]; f; f = f.return) {
      const p = f.memoizedProps;
      if (p && p.panelCameras && p.viewKinds !== undefined) {
        return p.panelCameras;
      }
    }
  }
  return null;
});

// Rect + aspect del canvas de la ventana idx.
const rectVentana = async (idx) => {
  const r = await page.evaluate((i) => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[i];
    const canvas = cont?.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }, idx);
  return r;
};

// Proyección de las 8 esquinas del cubo con la cámara de la ventana.
// replica de applyCamera + THREE (sin la librería).
function proyectarCubo(camCfg, w, h) {
  const rotX = camCfg.rotationX ?? 0;
  const rotY = camCfg.rotationY ?? 0;
  const zoom = camCfg.zoom ?? 1;
  const offX = camCfg.offsetX ?? 0;
  const offY = camCfg.offsetY ?? 0;
  const aspect = w / h;
  const esOrto = Math.abs(rotX) < 0.01
    && [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0].some(() => true)
    && (Math.abs(rotY) < 0.01 || Math.abs(rotY - Math.PI / 2) < 0.01
      || Math.abs(rotY + Math.PI / 2) < 0.01 || Math.abs(Math.abs(rotY) - Math.PI) < 0.01);
  let pos, alto, tanHalf;
  if (esOrto) {
    const ALTURA_BASE_PLANO = 2.2779;
    alto = ALTURA_BASE_PLANO / Math.max(0.1, Math.min(5, zoom));
    // pose frontal: pos (offX, offY, d), target (offX, offY, 0)
    pos = [offX, offY, 1]; // la distancia orto no afecta NDC
    const px = ([x, y]) => [
      ((x - offX) / (alto * aspect) + 1) / 2 * w,
      (1 - (y - offY) / alto) / 2 * h,
    ];
    return { tipo: 'orto', proyectar: px };
  }
  // Perspectiva (3D libre): la rama especial de rotX≈0/rotY≈0 NO se da
  // en la ventana 3D con la posa por defecto (rotX .5236, rotY -.7854).
  const dist = 5.5 / zoom;
  pos = [
    dist * Math.cos(rotX) * Math.sin(rotY) + offX,
    dist * Math.sin(rotX) + offY,
    dist * Math.cos(rotX) * Math.cos(rotY),
  ];
  const target = [offX, offY, 0];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const l = Math.hypot(...v) || 1;
    return v.map((n) => n / l);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = norm(sub(target, pos));
  let r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  tanHalf = Math.tan((45 / 2) * Math.PI / 180);
  const proyectar = ([x, y, z]) => {
    const d = sub([x, y, z], pos);
    const cx = dot(d, r);
    const cy = dot(d, u);
    const cz = dot(d, f);
    const ndcX = (cx / -cz) / (tanHalf * aspect);
    const ndcY = (cy / -cz) / tanHalf;
    return [(ndcX + 1) / 2 * w, (1 - ndcY) / 2 * h];
  };
  return { tipo: 'persp', pos, proyectar };
}

const ESQUINAS = [
  [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5],
];

/** Selecciona los 2 vértices superiores de la silueta en la ventana idx. */
async function elegirSuperiores(idx, etiqueta) {
  const rect = await rectVentana(idx);
  const camCfg = DOC.panelCameras[idx];
  if (!camCfg) return `SIN camCfg idx ${idx}`;
  const cam = proyectarCubo(camCfg, rect.w, rect.h);
  const proys = ESQUINAS.map((c) => {
    const [cx, cy] = cam.proyectar(c);
    return { c, x: rect.x + cx, y: rect.y + cy };
  });
  // Fila superior: el mayor y de pantalla es el MENOR py.
  const orden = [...proys].sort((a, b) => a.y - b.y);
  const topY = orden[0].y;
  const filaTop = orden.filter((o) => Math.abs(o.y - topY) < Math.max(2, rect.h * 0.02)).sort((a, b) => a.x - b.x);
  console.log(`[${etiqueta}] cam=${cam.tipo} filaTop=${filaTop.length} px=${filaTop.map((o) => `(${Math.round(o.x)},${Math.round(o.y)})`).join(' ')}`);
  if (filaTop.length < 2) return 'FILA INCOMPLETA';

  const centro = [rect.x + rect.w / 2, rect.y + rect.h / 2];
  const clicar = async (p, desplaz, shift) => {
    // Desplazar el clic hacia el centro (naxar dentro de la silueta).
    const dx = centro[0] - p.x;
    const dy = centro[1] - p.y;
    const l = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / l) * desplaz;
    const y = p.y + (dy / l) * desplaz;
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    if (shift) await page.keyboard.up('Shift');
    await esperar(700);
    return cuentaBarra(await textoBarra());
  };
  // Reintentos: primero TL, luego TR con MAYÚS → hasta 2.
  const logN = [];
  for (const ins of [3, 6, 10, 16, 24]) {
    const n = await clicar(filaTop[0], ins, false);
    logN.push(`TLins${ins}=${n}`);
    if (n > 0) {
      for (const ins2 of [3, 6, 10, 16, 24]) {
        const n2 = await clicar(filaTop[1], ins2, true);
        logN.push(`TRins${ins2}=${n2}`);
        if (n2 >= 2) break;
      }
      break;
    }
  }
  const final = await textoBarra();
  console.log(`[${etiqueta}] ${logN.join(' ')} → FINAL: ${final}`);
  return cuentaBarra(final);
}

try {
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(800);
  await page.setInputFiles('[data-testid="zeus-file-input"]', CUBO);
  await esperar(4000);
  await page.keyboard.press('Escape');
  await esperar(600);

  await page.click('[data-testid="scene-object-0"]');
  await esperar(1000);
  await page.click('[data-testid="subselect-vertice"]');
  await esperar(900);

  const r0 = await elegirSuperiores(0, 'FRENTE plana');
  const r3 = await elegirSuperiores(3, '3D libre');
  console.log(`\nRESULTADO: frente=${r0} 3d=${r3}`);
  if (errores.length) console.log('⚠ consola:', errores.slice(0, 10));
} finally {
  await browser.close();
}