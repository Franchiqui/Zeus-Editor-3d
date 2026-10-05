/**
 * DIAG GRUPOS TEXTURA — cada «Asignar textura» es UNA asignación propia
 * con su propia caja de UV (lo que pidió el usuario): la imagen del
 * rectángulo de arriba NO se reescala cuando se texturiza otra
 * selección (antes se ajustaban «como si las dos fueran una sola»).
 *
 * Flujo: texto HOLA → modo selección caras:
 *   1. rectángulo ARRIBA + Asignar degradado → deseleccionar → cap A.
 *   2. rectángulo ABAJO + ASIGNAR EL MISMO degradado → deseleccionar → cap B.
 * 3. diff píxel a píxel A↔B: los píxeles distintos deben quedar DENTRO
 *    de la caja del rectángulo de abajo (±margen) — arriba no cambió.
 * 4. Datos: la malla lleva DOS ids de grupo distintos (asignación por
 *    grupo) y las caras de arriba conservan el suyo propio.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';
import { pngDegradado } from './png-degradado.mjs';

const R = crearResultados('DIAG GRUPOS TEXTURA · caja de UV por asignación');

const leerMesh = () =>
  page.evaluate(() => {
    let hallado = null;
    document.querySelectorAll('[data-testid="viewer-container"]').forEach((cont) => {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      const visit = (fib, prof) => {
        if (!fib || prof > 80 || hallado) return;
        const p = fib.memoizedProps;
        if (p && p.mesh && p.mesh.faces && p.mesh.vertices && p.mesh.vertices.length > 0) {
          const texturas = p.mesh.faceTextures ?? [];
          const grupos = p.mesh.faceTextureGroups ?? null;
          const conTex = [];
          texturas.forEach((t, i) => { if (t && p.mesh.faces[i]) conTex.push(i); });
          const ids = new Set((grupos ?? []).filter((g) => !!g));
          hallado = {
            carasTex: conTex.length,
            idsGrupos: [...ids].length,
            grupos: grupos ? grupos.length : -1,
          };
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    });
    return hallado;
  });

// Captura device-px de TODOS los canvas del primer contenedor.
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
        caps.push({ rect: canvas.getBoundingClientRect(), w: canvas.width, data: ctx.getImageData(0, 0, off.width, off.height).data });
      });
    window.__capsGrupos = caps;
    return caps.length;
  });

// Diff contra lo capturado; devuelve los píxeles distintos por canvas en
// COORDENADAS DE PÁGINA (mapea device→css con el rect real del canvas).
const diffConAntes = (cajaInteres) =>
  page.evaluate(([interes]) => {
    const antes = window.__capsGrupos ?? [];
    const fuera = [];
    let nDif = 0;
    let idx = 0;
    document.querySelectorAll('[data-testid="viewer-container"]')[0]
      ?.querySelectorAll('canvas')
      .forEach((canvas) => {
        const previo = antes[idx++];
        if (!previo) return;
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        const a = previo.data;
        const escala = canvas.width / previo.w / (canvas.getBoundingClientRect().width / previo.rect.width);
        const escalaCss = canvas.getBoundingClientRect().width / previo.w;
        void escala;
        for (let p = 0; p < d.length; p += 4) {
          if (d[p] !== a[p] || d[p + 1] !== a[p + 1] || d[p + 2] !== a[p + 2]) {
            nDif++;
            const px = ((p / 4) % canvas.width) * escalaCss + canvas.getBoundingClientRect().x;
            const py = (Math.floor(p / 4 / canvas.width)) * escalaCss + canvas.getBoundingClientRect().y;
            const dentro =
              px >= interes[0] - 12 && px <= interes[2] + 12 &&
              py >= interes[1] - 12 && py <= interes[3] + 12;
            if (!dentro) fuera.push([Math.round(px), Math.round(py)]);
          }
        }
      });
    return { nDif, fuera: fuera.slice(0, 8) };
  }, [cajaInteres]);

const asignar = async (page) => {
  const [elegido] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button[title*="Asignar textura"]').first().click(),
  ]);
  await elegido.setFiles({
    name: 'degradado.png', mimeType: 'image/png',
    buffer: Buffer.from(pngDegradado, 'base64'),
  });
};

const { browser, page, errores } = await abrirEditor({ consola: false });
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

  // Rectángulo ARRIBA (sobre la mitad izquierda de la H).
  const arr = [caja.x + caja.width * 0.30, caja.y + caja.height * 0.34];
  await page.mouse.move(arr[0], arr[1]);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.58, caja.y + caja.height * 0.55, { steps: 6 });
  await page.mouse.up();
  await esperar(900);
  await asignar(page);
  await esperar(3500);
  await page.keyboard.press('Escape');
  await esperar(1000);
  await captarCanvases();

  const m1 = await leerMesh();
  console.log('después de asignar arriba:', JSON.stringify(m1));
  R.check((m1?.carasTex ?? 0) > 2 && (m1?.idsGrupos ?? 0) >= 1,
    'la primera asignación estampa su grupo', 'la asignación 1 no trajo grupo — arrays sin alinear');

  // Rectángulo ABAJO-DERECHA (sobre las letras LA y algo más abajo).
  const aba = [caja.x + caja.width * 0.58, caja.y + caja.height * 0.40];
  await page.mouse.move(aba[0], aba[1]);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.85, caja.y + caja.height * 0.62, { steps: 6 });
  await page.mouse.up();
  await esperar(900);
  const bar2 = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="face-select-bar"]');
    const m = b && (b.textContent ?? '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  });
  console.log('caras del segundo rectángulo:', bar2);
  R.check((bar2 ?? 0) > 2, `el segundo rectángulo selecciona caras (${bar2})`, 'el segundo rectángulo quedó vacío — ajustar coordenadas de la sonda');
  await asignar(page);
  await esperar(3500);
  await page.keyboard.press('Escape');
  await esperar(1000);

  const m2 = await leerMesh();
  console.log('después de asignar abajo:', JSON.stringify(m2));

  R.check((m2?.idsGrupos ?? 0) >= 2,
    `DOS asignaciones → dos ids de grupo distintos (${m2?.idsGrupos})`,
    `una sola caja para todo (${m2?.idsGrupos}) — las dos imágenes comparten escala — BUG`);

  // Diff visual: los cambios solo en la caja nueva.
  const cajaAbajo = [aba[0], aba[1], caja.x + caja.width * 0.85, caja.y + caja.height * 0.62];
  const dif = await diffConAntes(cajaAbajo);
  console.log('diff visual:', JSON.stringify(dif));
  R.check(dif.nDif > 30, `la segunda asignación se ve en el visor (${dif.nDif} px distintos)`, 'el render no cambió — la segunda asignación no se ve — BUG');
  R.check(dif.fuera.length === 0,
    'la imagen de ARRIBA no cambió tras la segunda asignación',
    `hay cambios FUERA de la caja nueva: ${JSON.stringify(dif.fuera)} — la primera imagen se reescaló — BUG`);
} finally {
  await R.resumen({ browser, errores });
}