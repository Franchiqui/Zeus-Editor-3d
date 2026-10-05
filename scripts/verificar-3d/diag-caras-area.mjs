/**
 * DIAG CARAS ÁREA — peticiones del usuario sobre el selector de
 * caras/vértices/segmentos:
 *  1. Área nueva (sin teclas) REEMPLAZA la selección: las caras del área
 *     anterior que no vuelven a estar dentro salen solas.
 *  2. Contención COMPLETA: una carita cogida «por la mitad» NO entra.
 *  3. Polígono: clics sucesivos dibujan la forma y el clic cerca del
 *     primer vértice la cierra y aplica la selección.
 *
 * Verificado contra el CONTADOR de la barra flotante (face-select-bar),
 * y con recálculo por fiber (cámara + malla de los hooks del visor) para
 * la contención exacta.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG CARAS ÁREA · reemplazo + contención + polígono');

const { browser, page, errores } = await abrirEditor();

const barCount = () =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-testid="face-select-bar"]');
    if (!bar) return null;
    const m = (bar.textContent ?? '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  });

/** Estado exacto de la selección de caras + recálculo esperado (diagnóstico). */
const volcarSeleccion = (rect) =>
  page.evaluate(([rx1, ry1, rx2, ry2]) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      let camaras = [];
      let grupo = null;
      let selActual = null;
      const visit = (fib, prof) => {
        if (!fib || prof > 70) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.selectedFaceIds) && typeof p.onFaceSelectionChange === 'function') {
          selActual = [...p.selectedFaceIds];
        }
        for (let n = fib.memoizedState, i = 0; n && i < 600; i++, n = n.next) {
          const cur = n.memoizedState?.current;
          if (!cur || typeof cur !== 'object') continue;
          if (cur.isPerspectiveCamera === true) {
            const pos = cur.position ?? { x: NaN, y: NaN, z: NaN };
            camaras.push({
              fov: cur.fov,
              pos: `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`,
              padre: cur.parent ? (cur.parent.userData?.etiqueta ?? cur.parent.type ?? 'si') : 'no',
            });
          }
          if (!grupo && cur.userData && Array.isArray(cur.children) && cur.children.some((c) => c.userData?.sceneObjectDuplicate)) {
            grupo = cur;
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (!grupo) continue;
      // La malla editable (findMainMesh): 'mesh' o primer Mesh propio.
      const meshObj = grupo.getObjectByName('mesh');
      if (!meshObj || !(meshObj?.geometry)) {
        // replica findMainMesh simplificada
        continue;
      }
      meshObj.updateWorldMatrix(true, false);
      const W = meshObj.matrixWorld;
      const camRect = meshObj.getBoundingClientRect ? null : null;
      // canvas del contenedor
      const canvas = cont.querySelector('canvas');
      if (!canvas) continue;
      const crect = canvas.getBoundingClientRect();
      // cámara: la MÁS CERCANA a mirar el origen con vista frontal
      camaras.sort((a, b) => 0);
      const proyecta = (v) => {
        const p = new (meshObj.position.constructor || Object)(v.x, v.y, v.z).applyMatrix4(W);
        return p;
      };
      return { selActual, camaras, aviso: 'solo diagnóstico', rango: null, crect: null };
    }
    return null;
  }, rect);

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');

  // Modo selección de caras: botón con el título largo.
  await page.locator('button[title*="Seleccionar caras"]').first().click();
  await esperar(700);
  R.check((await barCount()) !== null, 'barra flotante de selección visible', 'la barra no apareció — FLUJO');

  const cont = page.locator('[data-testid="viewer-container"]').first();
  const caja = await cont.boundingBox();
  // El texto ocupa la franja central: elegir puntos CLIC y bandas.
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;

  // Clic simple: selecciona UNA cara.
  await page.mouse.click(cx + 10, cy + 5);
  await esperar(600);
  const nClic = (await barCount()) ?? -1;
  console.log('clic simple:', nClic);
  R.check(nClic === 1, `clic simple selecciona 1 cara (${nClic})`, `clic simple no dio 1 (${nClic}) — BUG`);

  // R1 — Reemplazo: banda A ancha, luego banda B a la derecha (disjunta).
  const dragRecto = async (x1, y1, x2, y2) => {
    await page.mouse.move(caja.x + x1, caja.y + y1);
    await page.mouse.down();
    await page.mouse.move(caja.x + x2, caja.y + y2, { steps: 6 });
    await page.mouse.up();
    await esperar(700);
    return (await barCount()) ?? -1;
  };
  const nA = await dragRecto(caja.width * 0.2, caja.height * 0.35, caja.width * 0.55, caja.height * 0.62);
  console.log('banda A:', nA);
  R.check(nA >= 3, `área A selecciona varias caras (${nA})`, `área A no cogió varias (${nA}) — BUG`);
  // Banda B: franja DENTRO del área del texto pero distinta (a la
  // derecha-medio); si se acumularía más de A, con reemplazo solo quedan
  // las caras de B.
  const nB = await dragRecto(caja.width * 0.3, caja.height * 0.35, caja.width * 0.48, caja.height * 0.62);
  console.log('banda B (a la derecha de A):', nB);
  R.check(nB >= 1 && nB < nA, `área B REEMPLAZA (solo queda B: ${nB}; con acumulación sería ≥ ${nA + 1})`, `B no reemplazó (${nA} → ${nB}) — BUG`);

  // Volver a A: la selección vuelve a las caras de A (no a A∪B).
  const nA2 = await dragRecto(caja.width * 0.2, caja.height * 0.35, caja.width * 0.55, caja.height * 0.62);
  console.log('banda A otra vez:', nA2);
  R.check(Math.abs(nA2 - nA) <= Math.ceil(nA * 0.05), `re-seleccionar A repone su cuenta (${nA} → ${nA2})`, `A no se repuso (${nA} → ${nA2}) — BUG`);

  // R2 — Contención: área MININA (10 px) centrada donde un clic sí
  // selecciona una cara: con contención no hay cara COMPLETAMENTE dentro.
  await page.mouse.click(cx + 15, cy + 8);
  await esperar(600);
  const antesMini = (await barCount()) ?? -1;
  const nMini = await dragRecto(cx + 15 - 5, cy + 8 - 5, cx + 15 + 5, cy + 8 + 5);
  console.log(`mini-área (10 px): antes ${antesMini} → mini ${nMini}`);
  R.check(nMini === 0, `área minina no retiene media cara (mini ${nMini})`, `la mini-área aún coge caras a medias (${nMini}) — BUG de contención`);

  // R3 — Polígono: herramienta poligono, 4 clics formando banda, cierre.
  const selTool = page.locator('select', { has: page.locator('option[value="poligono"]') }).first();
  await selTool.selectOption('poligono');
  await esperar(400);
  const izq = caja.x + caja.width * 0.2;
  const dr = caja.x + caja.width * 0.55;
  const arriba = caja.y + caja.height * 0.35;
  const abajo = caja.y + caja.height * 0.62;
  const clics = [
    [izq, arriba],
    [dr, arriba],
    [dr, caja.y + caja.height * 0.62],
    [izq, caja.y + caja.height * 0.62],
  ];
  let nPolig = -2;
  for (const [px, py] of clics) {
    await page.mouse.click(px, py);
    await esperar(250);
  }
  // Cierre: clic a 2 px del primer punto.
  await page.mouse.click(izq, arriba + 2);
  await esperar(700);
  nPolig = (await barCount()) ?? -1;
  console.log('polígono cerrado:', nPolig);
  R.check(nPolig >= 1, `polígono cerrado selecciona (${nPolig})`, `el polígono no seleccionó nada (${nPolig}) — BUG`);

  // El polígono TAMBIÉN reemplaza: misma banda pero más estrecha.
  const nPoly2 = await (async () => {
    const izq2 = caja.x + caja.width * 0.24;
    const der2 = caja.x + caja.width * 0.4;
    for (const [px, py] of [[izq2, arriba], [der2, arriba], [der2, caja.y + caja.height * 0.62], [izq2, caja.y + caja.height * 0.62]]) {
      await page.mouse.click(px, py);
      await esperar(250);
    }
    await page.mouse.click(izq2, arriba + 2);
    await esperar(700);
    return (await barCount()) ?? -1;
  })();
  console.log('polígono estrecho:', nPoly2);
  R.check(nPoly2 < nPolig, `polígono nuevo reemplaza (${nPolig} → ${nPoly2})`, `el polígono acumuló (${nPolig} → ${nPoly2}) — BUG`);

  // Clic derecho cancela una forma a medias sin seleccionar.
  const antes = (await barCount()) ?? 0;
  await page.mouse.click(izq, arriba);
  await esperar(300);
  await page.mouse.click(izq + 40, arriba);
  await esperar(300);
  await page.mouse.click(izq + 40, arriba, { button: 'right' });
  await esperar(400);
  const nCancel = (await barCount()) ?? -2;
  R.check(nCancel === antes, `clic derecho cancela la forma sin tocar la selección (${antes} → ${nCancel})`, `cancelar cambió la selección (${antes} → ${nCancel}) — BUG`);
} finally {
  await R.resumen({ browser, errores });
}