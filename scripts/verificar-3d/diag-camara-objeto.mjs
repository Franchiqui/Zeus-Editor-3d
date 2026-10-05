/**
 * DIAG-CAMARA-OBJETO — la cámara como objeto de escena (sistema nuevo).
 *
 * Comprueba: crear con «+ Cámara» → tarjeta con insignia Cámara; panel
 * camera-editor (FOV, foco); fotogramas del recorrido (tiempo, posición);
 * el cuerpo y la curva cian se VEN en el visor frontal; guardar/reabrir
 * conserva kind+camera; ocultar y borrar desde la tarjeta.
 *
 * Nota de encuadre: la cámara-objeto nace en (0,2,6), DETRÁS de la cámara
 * por defecto del panel frontal (0,0,5.5). Para poder VERLA, el diag
 * coloca los fotogramas cerca del origen y carga el fotograma 0 en el
 * cuerpo (seleccionar la fila mueve la cámara a su pose).
 */
import {
  abrirEditor,
  esperar,
  numObjetos,
  textoListado,
  crearResultados,
} from './comun.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, 'fixtures', 'diag-camara.zeus');

const R = crearResultados('DIAG-CAMARA-OBJETO · cámara como objeto');

const { browser, page, errores } = await abrirEditor();

/**
 * Recorre el fiber desde un visor buscando props.sceneObjects y devuelve
 * un resumen de los objetos (kind, camera.fov, camera.target, keyframes).
 */
async function volcarObjetos() {
  return page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return 'SIN FIBER';
    const hallados = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 60 || hallados.length) return;
      const p = fib.memoizedProps;
      if (p && Array.isArray(p.sceneObjects)) {
        for (const o of p.sceneObjects) {
          hallados.push(
            JSON.stringify({
              name: o.name,
              kind: o.kind ?? '(figura)',
              hidden: !!o.hidden,
              px: Number(o.transform?.px?.toFixed(2)),
              py: Number(o.transform?.py?.toFixed(2)),
              pz: Number(o.transform?.pz?.toFixed(2)),
              fov: o.camera?.fov ?? '(sin)',
              target: o.camera?.target
                ? [o.camera.target.x, o.camera.target.y, o.camera.target.z]
                : '(sin)',
              kfs: (o.camera?.keyframes || []).map((k) => [
                k.time,
                Number(k.position.x.toFixed(1)),
                Number(k.position.y.toFixed(1)),
                Number(k.position.z.toFixed(1)),
              ]),
            })
          );
        }
        return;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f && !hallados.length; f = f.return) visit(f, 0);
    return hallados.join(' | ') || 'ESCENA VACIA';
  });
}

/**
 * Cuenta píxeles por RANGO DE TONO en el visor frontal (0). El tono
 * sobrevive al tone mapping del renderer (el cian 0x22d3ee se pinta
 * ≈(129,215,223), el morado del cuerpo se aclara), mientras que una
 * comparación de color exacta no.
 */
async function contarHue(hueMin, hueMax, satMin = 0.25, valMin = 0.35) {
  return page.evaluate(async ({ hueMin, hueMax, satMin, valMin }) => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === 0 || mx - mn < 0.08) continue;
      const sat = (mx - mn) / mx;
      const val = mx;
      if (sat < satMin || val < valMin) continue;
      let hue;
      if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
      else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
      else hue = 240 + ((r - g) / (mx - mn)) * 60;
      if (hue < 0) hue += 360;
      if (hue >= hueMin && hue <= hueMax) n++;
    }
    return n;
  }, { hueMin, hueMax, satMin, valMin });
}

try {
  // 1. Escena vacía al arrancar.
  R.check((await numObjetos(page)) === 0, 'arranque: sin objetos', 'arranque con objetos fantasma');

  // 2. Crear la cámara con «+ Cámara».
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(900);
  R.check((await numObjetos(page)) === 1, '«+ Cámara» crea 1 tarjeta', '«+ Cámara» no creó tarjeta');
  const texto = await textoListado(page);
  R.check(texto.includes('Cámara'), 'la tarjeta lleva el nombre/insignia Cámara', 'la tarjeta no dice Cámara: ' + texto.slice(0, 80));
  R.check((await page.locator('[data-testid="camera-editor"]').count()) === 1,
    'camera-editor aparece al crearla (queda seleccionada)', 'camera-editor NO aparece tras crearla');
  const volcado0 = await volcarObjetos();
  console.log('  · cámara recién creada: ' + volcado0);
  R.check(volcado0.includes('"kind":"camera"'), 'el objeto vivo tiene kind=camera', 'kind=camera no llegó al objeto vivo: ' + volcado0);

  // 3. FOV con el slider (Radix: flechas sobre el thumb).
  const thumb = page.locator('[data-testid="camera-fov"] [role="slider"]');
  await thumb.click();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await esperar(700);
  const conFov = await volcarObjetos();
  R.check(/"fov":6\d/.test(conFov), 'el slider FOV sube el ángulo (≈60°)', 'el slider FOV no cambió camera.fov: ' + conFov);

  // 4. Foco X/Y/Z numérico.
  await page.fill('[data-testid="camera-focus-x"]', '2.5');
  await esperar(700);
  const conFoco = await volcarObjetos();
  R.check(conFoco.includes('"target":[2.5,1,0]'), 'el foco X editable (2.5) llega a camera.target', 'el foco X no se aplicó: ' + conFoco);

  // 5. Fotogramas del recorrido, encuadrados en el panel frontal:
  //    kf0 (0,1,1.5) t=0 · kf1 (0,1.5,-1.5) t=2 s.
  const cianBase = (await contarHue(160, 210)) ?? -1;
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(700);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-x"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-y"]', '1');
  await page.fill('[data-testid="camera-kf-pos-0-z"]', '1.5');
  await esperar(600);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(700);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', '0');
  await page.fill('[data-testid="camera-kf-pos-1-y"]', '1.5');
  await page.fill('[data-testid="camera-kf-pos-1-z"]', '-1.5');
  await esperar(900);
  const conKfs = await volcarObjetos();
  console.log('  · con 2 fotogramas: ' + conKfs);
  R.check(conKfs.includes('"kfs":[[0,0,1,1.5],[2000,0,1.5,-1.5]]'),
    'los fotogramas quedan en la cámara (2, tiempos 0 y 2 s)',
    'los fotogramas no quedaron como se esperaba: ' + conKfs);

  // 6. La curva cian aparece en el visor frontal.
  const cianConKfs = (await contarHue(160, 210)) ?? -1;
  console.log(`  · píxeles cian: base ${cianBase} → con recorrido ${cianConKfs}`);
  R.check(cianConKfs > cianBase + 30, 'la curva del recorrido aparece en 3D (tinta cian crece)', `la curva no se dibujó (cian ${cianBase} → ${cianConKfs})`);

  // 7. Seleccionar el fotograma 0: el cuerpo de la cámara viaja a su pose
  //    (0,1,1.5) y se ve morado en el frontal.
  await page.click('[data-testid="camera-keyframe-0"]');
  await esperar(900);
  const conCuerpo = await volcarObjetos();
  R.check(conCuerpo.includes('"px":0,"py":1,"pz":1.5'),
    'seleccionar un fotograma carga su pose en la cámara (0,1,1.5)',
    'la pose del fotograma no llegó al transform: ' + conCuerpo);
  const morado = (await contarHue(250, 300, 0.2, 0.3)) ?? -1;
  console.log('  · píxeles morado (cuerpo): ' + morado);
  R.check(morado > 20, 'el cuerpo de la cámara se dibuja en el frontal (tinta morada)', `el cuerpo no se ve (morado ${morado})`);

  // 8. Guardar y reabrir: kind+camera sobreviven.
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag-camara');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  R.check(!!dl, 'el guardado dispara descarga', 'no se disparó la descarga al guardar');
  if (dl) {
    await dl.saveAs(ARCHIVO);
    const data = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
    const lista = Array.isArray(data) ? data : data.sceneObjects ?? [];
    const cam = lista.find((o) => o.kind === 'camera');
    R.check(!!cam && cam.camera?.keyframes?.length === 2,
      'el .zeus guarda kind=camera con sus 2 fotogramas',
      'el .zeus perdió la cámara: ' + JSON.stringify(lista).slice(0, 300));

    // Reabrir tras recargar (el archivo abre en la pestaña Views: ir a Escena).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
    await esperar(1200);
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.click('[data-testid="open-obj3d-modal"]');
    await esperar(700);
    await page.setInputFiles('[data-testid="zeus-file-input"]', ARCHIVO);
    await esperar(3500);
    await page.click('[data-testid="tab-scene"]');
    await esperar(1000);
    const reabierto = await volcarObjetos();
    console.log('  · tras reabrir: ' + reabierto);
    R.check(reabierto.includes('"kind":"camera"') && reabierto.includes('"kfs":[[0,0,1,1.5],[2000,0,1.5,-1.5]]'),
      'reabrir conserva la cámara y su recorrido',
      'reabrir perdió la cámara/fotogramas: ' + reabierto);
  }

  // 9. Ocultar y mostrar desde la tarjeta.
  await page.locator('button[title="Ocultar objeto"]').first().click();
  await esperar(800);
  const oculta = await volcarObjetos();
  R.check(oculta.includes('"hidden":true'), 'ocultar marca la cámara (hidden=true)', 'ocultar no funcionó: ' + oculta);
  await page.locator('button[title="Mostrar objeto"]').first().click();
  await esperar(800);

  // 10. Borrar la cámara. Primero se crea una figura de relleno: el editor
  //     no deja borrar al ÚLTIMO objeto de la escena (regla preexistente,
  //     igual para figuras) y la cámara era la única.
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500); // auto-creación del objeto de texto
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  R.check((await numObjetos(page)) === 2, 'objeto de texto de relleno creado (2 tarjetas)', 'el objeto de relleno no se creó');
  await page.locator('button[title="Eliminar objeto"]').nth(0).click();
  await esperar(600);
  await page.click('[data-testid="confirm-delete-btn"]');
  await esperar(900);
  const trasBorrar = await textoListado(page);
  R.check((await numObjetos(page)) === 1 && !trasBorrar.includes('Cámara'),
    'borrar la cámara la quita de la lista (queda el objeto de relleno)',
    'la cámara sigue en la lista tras borrar: ' + trasBorrar.slice(0, 60));
} finally {
  await R.resumen({ browser, errores });
}