/**
 * DIAG SELECCIÓN COLORES — vértices y segmentos CAMBIAN DE COLOR al
 * seleccionarse y los CAMPOS NUMÉRICOS mueven la selección por eje:
 *  1. Objetivo vértice: clic selecciona, y aparecen píxeles AMARILLOS
 *     (el color de «seleccionado», igual que las caras) junto al guía.
 *  2. Objetivo segmento: clic selecciona una arista → píxeles amarillos.
 *  3. Con un vértice seleccionado aparecen los campos X·Y·Z («Mover»);
 *     al poner X=0.5 y aplicar, la mancha amarilla se DESPLAZA a la
 *     derecha (eje X local positivo = derecha en la vista frontal).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG SELECCIÓN COLORES · amarillo + campos X·Y·Z');

const { browser, page, errores } = await abrirEditor();
try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.locator('button[title*="Seleccionar caras"]').first().click();
  await esperar(700);

  const cont = page.locator('[data-testid="viewer-container"]').first();
  const caja = await cont.boundingBox();
  const cx = caja.x + caja.width * 0.40;
  const cy = caja.y + caja.height * 0.42;

  /** Cuenta píxeles AMARILLOS del visor frontal (r alto, g alto, b bajo).
   * Lee TODOS los canvas de todos los paneles y toma el máximo: la
   * cuadrícula de viewports reparte la escena entre varias cámaras. */
  const amarillos = () =>
    page.evaluate(() => {
      let mejor = 0;
      for (const cont of document.querySelectorAll('[data-testid="viewer-container"]')) {
        for (const canvas of cont.querySelectorAll('canvas')) {
          const off = document.createElement('canvas');
          off.width = canvas.width; off.height = canvas.height;
          if (!off.width || !off.height) continue;
          const ctx = off.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(canvas, 0, 0);
          const d = ctx.getImageData(0, 0, off.width, off.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] < 80) n++;
          }
          mejor = Math.max(mejor, n);
        }
      }
      return mejor;
    });

  // 1. Vértices: cambiar objetivo, clic, y debe aparecer amarillo.
  await page.selectOption('select[title*="Qué seleccionar"]', 'vertice');
  await esperar(500);
  const antesV = await amarillos();
  // Guía de todos los vértices (verde-azulado, NO amarillo).
  R.check(antesV < 40, `guía de vértices sin amarillo (${antesV})`, `la guía ya pinta amarillo — el cambio de color no distinguiría (${antesV}) — BUG`);
  await page.mouse.click(cx, cy);
  await esperar(800);
  const desV = await amarillos();
  console.log('vértice: antes', antesV, '→ después', desV);
  R.check(desV > antesV + 2, `el vértice seleccionado CAMBIA de color (amarillo ${antesV} → ${desV})`, `sin cambio de color al seleccionar vértice (${antesV} → ${desV}) — BUG`);

  // 2. Campos numéricos visibles con la selección.
  const camposVisibles = (await page.locator('[data-testid="face-move-fields"]').count()) > 0;
  R.check(camposVisibles, 'campos numéricos X·Y·Z aparecen con la selección', 'los campos numéricos no aparecen — BUG');

  // 3. Mover con X=0.5: la mancha amarilla se desplaza a la derecha.
  const cajaAmarillo = () =>
    page.evaluate(() => {
      let mejor = null;
      for (const cont of document.querySelectorAll('[data-testid="viewer-container"]')) {
        for (const canvas of cont.querySelectorAll('canvas')) {
          const off = document.createElement('canvas');
          off.width = canvas.width; off.height = canvas.height;
          if (!off.width || !off.height) continue;
          const ctx = off.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(canvas, 0, 0);
          const d = ctx.getImageData(0, 0, off.width, off.height).data;
          let xMin = 9e9, xMax = -9, n = 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const o = (y * canvas.width + x) * 4;
              if (d[o] > 240 && d[o + 1] > 240 && d[o + 2] < 80) {
                n++; xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
              }
            }
          }
          const caja = n ? { n, xMin, xMax, xc: (xMin + xMax) / 2 } : null;
          if (caja && (!mejor || caja.n > mejor.n)) mejor = caja;
        }
      }
      return mejor;
    });
  const a0 = await cajaAmarillo();
  await page.fill('[data-testid="face-move-x"]', '0.5');
  await esperar(300);
  await page.click('[data-testid="face-move-apply"]');
  await esperar(1200);
  const a1 = await cajaAmarillo();
  console.log('caja amarilla: antes', a0, '→ después', a1);
  R.check(!!a0 && !!a1 && a1.xc > a0.xc + 3 && a1.xc - a0.xc < 90,
    `«Mover» con X=0.5 desplaza el vértice a la derecha (centro ${a0 ? a0.xc.toFixed(0) : '?'} → ${a1 ? a1.xc.toFixed(0) : '?'})`,
    'los campos numéricos no movieron la selección — BUG');

  // 4. Ctrl = AÑADIR, Mayús = QUITAR (el usuario lo pidió). Con vértices:
  //    un clic selecciona uno; Ctrl+clic cerca añade otro (bar 1 → 2); y
  //    Mayús+clic sobre ese mismo punto lo quita (bar 2 → 1... o menos).
  const bar = () =>
    page.evaluate(() => {
      const b = document.querySelector('[data-testid="face-select-bar"]');
      const m = b && (b.textContent ?? '').match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    });
  const clicConTecla = async (key, dxc, dyc) => {
    await page.keyboard.down(key);
    await page.mouse.click(cx + dxc, cy + dyc);
    await page.keyboard.up(key);
  };
  await clicConTecla('Control', 18, -14);
  await esperar(800);
  let barCtrl = await bar();
  let offAdd = [18, -14];
  console.log('bar tras Ctrl+clic:', barCtrl);
  let ctrlOk = barCtrl === 2;
  if (!ctrlOk) {
    // El punto pudo caer sobre el mismo vértice: probar otros cercanos.
    for (const [dxb, dyb] of [[-18, 10], [22, 4], [-14, -20]]) {
      await clicConTecla('Control', dxb, dyb);
      await esperar(700);
      barCtrl = await bar();
      console.log('bar tras Ctrl+clic alt:', barCtrl);
      if (barCtrl === 2) { ctrlOk = true; offAdd = [dxb, dyb]; break; }
    }
  }
  R.check(ctrlOk, 'Ctrl+clic AÑADE a la selección (bar 1 → 2)',
    `Ctrl+clic no añadió — bar=${barCtrl} — BUG`);
  // Mayús+clic sobre EL MISMO punto (el vértice añadido): lo quita.
  await clicConTecla('Shift', offAdd[0], offAdd[1]);
  await esperar(800);
  const barMayus = await bar();
  console.log('bar tras Mayús+clic:', barMayus);
  R.check(ctrlOk && barMayus < 2, `Mayús+clic QUITA de la selección (bar → ${barMayus})`,
    `Mayús+clic no quitó — bar=${barMayus} — BUG`);

  // 5. Segmentos: objetivo segmento; la arista es una línea de 1 px
  //    antialiased — la cuenta va por PRESENCIA de amarillo puro
  //    (255,255,0): el mando del gizmo solo llega a (232,217,115).
  await page.selectOption('select[title*="Qué seleccionar"]', 'segmento');
  await esperar(500);
  const antesS = await amarillos();
  let desS = antesS;
  for (const [dxb, dyb] of [[0, 0], [6, -6], [-8, 0], [0, 8], [10, 4], [-10, -6], [3, 3], [-3, -3]]) {
    await page.mouse.click(cx + dxb, cy + dyb);
    await esperar(800);
    desS = await amarillos();
    const barSeg = await bar();
    console.log(`segmento (dx=${dxb}, dy=${dyb}): amar=${desS} bar=${barSeg}`);
    if (desS > antesS + 1) break;
  }
  R.check(desS > antesS + 1, `el segmento seleccionado CAMBIA de color (amarillo ${antesS} → ${desS})`, `sin cambio de color al seleccionar segmento (${antesS} → ${desS}) — BUG`);
} finally {
  await R.resumen({ browser, errores });
}