/**
 * DIAG EXTRUSIÓN — el botón «Extrudir» crea la extrusión EXACTA de lo
 * seleccionado (lo que pidió el usuario): duplicados de los vértices de
 * la selección desplazados con el delta X·Y·Z de la barra, más paredes
 * RECTAS del anillo original al anillo duplicado. Las caras vecinas NO
 * se estiran (sus vértices quedan donde estaban).
 *
 * Señales:
 *  1. Botón face-extrude-apply presente en la barra.
 *  2. La malla del objeto crece (caras y vértices nuevos).
 *  3. TODOS los vértices originales quedan con su posición exacta
 *     (nada vecino se estira).
 *  4. Existe al menos una cara-pared: 2 vértices originales + 2
 *     duplicados, y cada duplicado está en original + delta (pared recta).
 *  5. La selección se remapea a las tapas: la barra sigue con el mismo
 *     número de caras.
 *  6. Señal visual: diff píxel a píxel entre captura antes / después.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG EXTRUSIÓN · extrudir exacto la selección');

const leerMesh = () =>
  page.evaluate(() => {
    let hallado = null;
    document.querySelectorAll('[data-testid="viewer-container"]').forEach((cont) => {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      const visit = (fib, prof) => {
        if (!fib || prof > 80 || hallado) return;
        const p = fib.memoizedProps;
        if (
          p && p.mesh && p.mesh.faces && p.mesh.vertices &&
          Array.isArray(p.selectedFaceIds) &&
          p.mesh.vertices.length > 0
        ) {
          hallado = {
            nFaces: p.mesh.faces.length,
            nVerts: p.mesh.vertices.length,
            faces: p.mesh.faces,
            verts: p.mesh.vertices.map((v) => [v.x, v.y, v.z]),
            selCaras: p.selectedFaceIds.length,
            grupos: p.mesh.faceTextureGroups ? p.mesh.faceTextureGroups.length : -1,
          };
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    });
    return hallado;
  });

const captarCanvases = () =>
  page.evaluate(() => {
    const caps = [];
    document.querySelectorAll('[data-testid="viewer-container"]')[0]
      ?.querySelectorAll('canvas')
      .forEach((canvas) => {
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        caps.push(ctx.getImageData(0, 0, off.width, off.height).data);
      });
    window.__capsAntes = caps;
    return caps.length;
  });

const diffConAntes = () =>
  page.evaluate(() => {
    const antes = window.__capsAntes ?? [];
    let nDif = 0;
    const rects = [];
    let idx = 0;
    document.querySelectorAll('[data-testid="viewer-container"]')[0]
      ?.querySelectorAll('canvas')
      .forEach((canvas) => {
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        const a = antes[idx++];
        if (!a || d.length !== a.length) return;
        let xMin = 1e9, xMax = -1, yMin = 1e9, yMax = -1;
        for (let p = 0; p < d.length; p += 4) {
          if (d[p] !== a[p] || d[p + 1] !== a[p + 1] || d[p + 2] !== a[p + 2]) {
            nDif++;
            const px = (p / 4) % off.width;
            const py = Math.floor(p / 4 / off.width);
            if (px < xMin) xMin = px;
            if (px > xMax) xMax = px;
            if (py < yMin) yMin = py;
            if (py > yMax) yMax = py;
          }
        }
        if (nDif && xMax >= 0) rects.push([xMin, yMin, xMax, yMax]);
      });
    return { nDif, rects };
  });

const barCaras = () =>
  page.evaluate(() => {
    const b = document.querySelector('[data-testid="face-select-bar"]');
    const m = b && (b.textContent ?? '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  });

const { browser, page, errores } = await abrirEditor({ consola: false });
page.on('console', (msg) => {
  if (msg.text().includes('[EXD]')) console.log('EXD:', msg.text());
});
try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.locator('button[title*="Seleccionar caras"]').first().click();
  await esperar(700);
  await page.selectOption('select[title*="Qué seleccionar"]', 'cara');
  await esperar(400);
  const cont = page.locator('[data-testid="viewer-container"]').first();
  const caja = await cont.boundingBox();
  // Rectángulo sobre la mitad izquierda de la H (frontal).
  await page.mouse.move(caja.x + caja.width * 0.30, caja.y + caja.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.58, caja.y + caja.height * 0.55, { steps: 6 });
  await page.mouse.up();
  await esperar(900);
  const bar0 = await barCaras();
  console.log('caras seleccionadas:', bar0);
  R.check((bar0 ?? 0) > 2, `el rectángulo selecciona caras (${bar0} caras)`, 'la selección no eligió caras — flujo roto');

  const botExtrudir = page.locator('[data-testid="face-extrude-apply"]');
  R.check(await botExtrudir.count() === 1, 'botón «Extrudir» presente en la barra', 'no está el botón de extrusión — falta la pieza');

  // Delta: usar el campo Z de la barra (sacar hacia fuera).
  await page.locator('[data-testid="face-move-z"]').fill('0.4');
  await esperar(300);

  const antes = await leerMesh();
  console.log('antes:', JSON.stringify(antes && { nFaces: antes.nFaces, nVerts: antes.nVerts, selCaras: antes.selCaras }));
  await captarCanvases();

  await botExtrudir.click();
  await esperar(1500);

  const despues = await leerMesh();
  const bar1 = await barCaras();
  console.log('después:', JSON.stringify(despues && { nFaces: despues.nFaces, nVerts: despues.nVerts, selCaras: despues.selCaras, grupos: despues.grupos }));

  R.check(!!despues, 'leí la malla del objeto en el visor', 'la malla no accesible desde fiber');
  if (antes && despues) {
    const N = antes.nVerts;
    R.check(despues.nVerts > N, `la malla crea vértices duplicados (${despues.nVerts - N} nuevos)`, 'no se duplicaron vértices — extrusión no ocurrió — BUG');
    R.check(despues.nFaces > antes.nFaces, `la malla crea caras nuevas (+${despues.nFaces - antes.nFaces})`, 'no se crearon caras — BUG');

    // 3) TODOS los vértices originales intactos (nada vecino se estira).
    const iguales = (va, vb) =>
      Math.abs(va[0] - vb[0]) < 1e-9 && Math.abs(va[1] - vb[1]) < 1e-9 && Math.abs(va[2] - vb[2]) < 1e-9;
    let movidos = 0;
    for (let i = 0; i < Math.min(N, despues.verts.length); i++) {
      if (!iguales(antes.verts[i], despues.verts[i])) movidos++;
    }
    R.check(movidos === 0, `caras vecinas sin estirar: 0 vértices originales se movieron (${movidos})`, `se movieron ${movidos} vértices ya existentes — se estiró lo que NO estaba seleccionado — BUG del cuño`);

    // 4) Paredes rectas: cara nueva con 2 originales + 2 duplicados,
    //    duplicado = su original pareja + delta Z (0.4).
    const pos = despues.verts;
    const delta = 0.4;
    let paredOK = null;
    const carasNuevas = despues.faces.slice(antes.nFaces);
    let paredes = 0;
    for (const f of carasNuevas) {
      if (f.length < 4) continue;
      if (!f.some((v) => v < N) || !f.some((v) => v >= N)) continue;
      paredes++;
      let rects = true;
      for (const v of f) {
        if (v >= N) {
          const [x, y, z] = pos[v];
          let par = false;
          for (let j = 0; j < N; j++) {
            const r = pos[j];
            if (Math.abs(r[0] - x) < 1e-6 && Math.abs(r[1] - y) < 1e-6 && Math.abs(r[2] + delta - z) < 1e-6) { par = true; break; }
          }
          if (!par) { rects = false; break; }
        }
      }
      if (rects && !paredOK) paredOK = f;
    }
    if (paredes === 0) {
      R.check(false, 'hubo caras-pared (2 originales + 2 duplicados)', 'ninguna cara nueva con mezcla origen/duplicado — las paredes no se crean — BUG');
    } else {
      R.check(!!paredOK, `paredes rectas: ${paredes} pared(es), la primera ${JSON.stringify(paredOK)} con duplicados = original + delta`, 'los duplicados de las paredes no salen del anillo original — paredes inclinadas — BUG del cuño');
    }

    // 5) La selección se remapea a las tapas: mismo número de caras.
    R.check(bar1 === bar0, `la selección siguió a la copia movida (barra ${bar0} → ${bar1})`, `la barra cambió de ${bar0} a ${bar1} — el remapeo de la selección está roto`);
  }

  // 6) Señal visual: diff píxel a píxel contra la captura «antes».
  const dif1 = await diffConAntes();
  await page.keyboard.press('Escape');
  await esperar(900);
  const bar2 = await barCaras();
  const dif2 = await diffConAntes();
  console.log('diff tras extrudir:', JSON.stringify(dif1), '— tras deseleccionar:', JSON.stringify(dif2), '— bar:', bar2);
  R.check(dif1.nDif > 50, `el visor cambió tras extrudir (${dif1.nDif} px distintos)`, 'el render no cambió — la extrusión no se ve — BUG');
  R.check(dif2.nDif > 50, `tras soltar la selección el bloque extraído sigue (${dif2.nDif} px distintos)`, 'al deseleccionar volvió la figura original — la extrusión no persistió — BUG');

  // ---- FASE 2: extrudir HACIA DENTRO → HUECO (lo que pidió el usuario:
  // la boca queda abierta, sin tapa que la cierre; el Mover inclinaba,
  // esto no). Segundo rectángulo sobre la letra A (zona con caras).
  await page.mouse.move(caja.x + caja.width * 0.56, caja.y + caja.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.84, caja.y + caja.height * 0.55, { steps: 6 });
  await page.mouse.up();
  await esperar(900);
  const barF2 = await barCaras();
  console.log('fase 2 · caras seleccionadas:', barF2);
  R.check((barF2 ?? 0) > 2, `el segundo rectángulo selecciona caras (${barF2})`, 'el segundo rectángulo quedó vacío — ajustar la sonda');
  const base2 = await leerMesh();
  if (!despues) throw new Error('sin malla de la fase 1');
  const N2 = despues.nVerts;
  const origAntes2 = base2 ? base2.faces.length : -1;
  console.log('fase 2 · antes:', JSON.stringify(base2 && { nFaces: base2.nFaces, nVerts: base2.nVerts, selCaras: base2.selCaras }), 'caras previas:', origAntes2);

  await captarCanvases(); // línea base ANTES de extrudir (no después)
  await page.locator('[data-testid="face-move-z"]').fill('-0.4');
  await esperar(300);
  await botExtrudir.click();
  await esperar(1500);
  const despues2 = await leerMesh();
  const barTras2 = await barCaras();
  console.log('fase 2 · después:', JSON.stringify(despues2 && { nFaces: despues2.nFaces, nVerts: despues2.nVerts, selCaras: despues2.selCaras }), 'bar:', barTras2);

  R.check(!!despues2, 'fase 2: leí la malla tras extrudir hacia dentro', 'malla no accesible');
  if (despues2 && base2) {
    // Reparto en la malla nueva: tapas (todos los vértices ≥ N2),
    // paredes (mezcla origen/duplicado) y supervivientes (todos < N2).
    const caps2 = despues2.faces.filter((f) => f.every((v) => v >= N2)).length;
    const mezcla2 = despues2.faces.filter((f) => f.some((v) => v >= N2) && f.some((v) => v < N2)).length;
    const supervivientes = despues2.faces.length - caps2 - mezcla2;
    const esperados = origAntes2 - (barF2 ?? 0);
    R.check(supervivientes === esperados,
      `la boca del hueco queda ABIERTA: la malla pierde exactamente las caras originales de la selección (supervivientes ${supervivientes}, esperados ${esperados})`,
      `las caras originales no se quitaron (esperados ${esperados}, quedaron ${supervivientes}) — el hueco sigue sellado — BUG`);
    R.check(despues2.nVerts > base2.nVerts, 'la malla crea los vértices del hueco', 'sin duplicados — no hubo extrusión — BUG');
    const iguales2 = (va, vb) =>
      Math.abs(va[0] - vb[0]) < 1e-9 && Math.abs(va[1] - vb[1]) < 1e-9 && Math.abs(va[2] - vb[2]) < 1e-9;
    let movidos2 = 0;
    const NB = base2.nVerts;
    for (let i = 0; i < Math.min(NB, despues2.verts.length); i++) {
      if (!iguales2(base2.verts[i], despues2.verts[i])) movidos2++;
    }
    R.check(movidos2 === 0, `vecinos de la fase 2 sin tocar (0 de ${movidos2} movidos)`, `se movieron ${movidos2} vértices ya existentes — BUG`);
    R.check(barTras2 === barF2, `la selección siguió al suelo del hueco (barra ${barF2} → ${barTras2})`, `barra ${barF2} → ${barTras2} — remapeo de la selección roto`);
  }

  // Señal visual de la fase 2 (difiere del estado justo antes de extrudir).
  const difF2 = await diffConAntes();
  // Captura del panel FREnte para ver el hueco a ojo.
  const rec1 = await page.evaluate(() => {
    const c = document.querySelectorAll('[data-testid="viewer-container"]')[0].querySelector('canvas');
    return c.getBoundingClientRect();
  });
  await page.screenshot({
    path: 'zoom-hueco.png',
    clip: { x: rec1.x, y: rec1.y, width: rec1.width, height: rec1.height },
  });
  console.log('fase 2 · diff visual:', JSON.stringify(difF2));
  R.check(difF2.nDif > 50, `el hueco hacia dentro se ve en el visor (${difF2.nDif} px distintos)`, 'el render no cambió — el hueco no se ve — BUG');
} finally {
  await R.resumen({ browser, errores });
}