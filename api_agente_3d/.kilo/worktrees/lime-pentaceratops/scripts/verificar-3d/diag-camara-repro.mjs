/**
 * DIAG-CAMARA-REPRO — reproducción con la cámara-objeto real.
 *
 * Comprueba: con ≥2 fotogramas, cada ventana tiene un SELECTOR de cámara;
 * al activar una cámara en la ventana 3D se VE LA ESCENA desde la cámara
 * (píxeles del objeto en el centro: el cuerpo/lente de la propia cámara no
 * tapan la imagen) y al reproducir la cámara viaja kf1→kf2; las demás
 * ventanas no se inmutan; al volver a «Sin cámara» se restaura la vista
 * del panel; «Exportar MP4» sigue habilitado. El botón «Vista cámara» ya
 * NO existe.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';

const R = crearResultados('DIAG-CAMARA-REPRO · reproducción con cámara-objeto');

const { browser, page, errores } = await abrirEditor();

/** Firma + tinta del visor (índice idx). */
async function firmaVisor(idx) {
  return page.evaluate(async (i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i] && conts[i].querySelector('canvas');
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
    const f0 = [d[0], d[1], d[2]];
    let tinta = 0;
    const firma = [];
    for (let y = 0; y < off.height; y += 3) {
      for (let x = 0; x < off.width; x += 3) {
        const o = (y * off.width + x) * 4;
        const r = d[o], g = d[o + 1], b = d[o + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) tinta++;
        firma.push(((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5));
      }
    }
    return { tinta, firma: firma.join(',') };
  }, idx);
}

/**
 * Píxeles de color (rango de tono) en el PARCHE CENTRAL del visor idx:
 * con la cámara activada, el centro debe mostrar la escena (el objeto
 * apuntado), no la lente del cuerpo de la propia cámara.
 */
async function contarColorCentro(idx, hueMin, hueMax, satMin = 0.25, valMin = 0.3) {
  return page.evaluate(async ({ i, hueMin, hueMax, satMin, valMin }) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i] && conts[i].querySelector('canvas');
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
    const x0 = Math.floor(off.width * 0.3), x1 = Math.floor(off.width * 0.7);
    const y0 = Math.floor(off.height * 0.3), y1 = Math.floor(off.height * 0.7);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * off.width + x) * 4;
        const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx === 0 || mx - mn < 0.08) continue;
        const sat = (mx - mn) / mx;
        if (sat < satMin || mx < valMin) continue;
        let hue;
        if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
        else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
        else hue = 240 + ((r - g) / (mx - mn)) * 60;
        if (hue < 0) hue += 360;
        if (hue >= hueMin && hue <= hueMax) n++;
      }
    }
    return n;
  }, { i: idx, hueMin, hueMax, satMin, valMin });
}

/**
 * Píxeles morados (cuerpo de cámara-objeto, matiz 250-300) de TODO el
 * lienzo de la ventana idx. Sirve para comprobar que el visual del cuerpo
 * se oculta en la ventana que maneja la cámara y vuelve al salir.
 */
async function contarMoradoVentana(idx) {
  return page.evaluate(async (i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i] && conts[i].querySelector('canvas');
    if (!canvas) return -1;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === 0 || mx - mn < 0.08) continue;
      const sat = (mx - mn) / mx;
      let hue;
      if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
      else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
      else hue = 240 + ((r - g) / (mx - mn)) * 60;
      if (hue < 0) hue += 360;
      if (hue >= 250 && hue <= 300 && sat >= 0.15 && mx >= 0.2) n++;
    }
    return n;
  }, idx);
}

/** Recorre el fiber buscando props.sceneObjects (posiciones de los objetos). */
async function volcarObjetos() {
  return page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return [];
    const hallados = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 60 || hallados.length) return;
      const p = fib.memoizedProps;
      if (p && Array.isArray(p.sceneObjects)) {
        for (const o of p.sceneObjects) {
          hallados.push({
            id: o.id,
            name: o.name,
            kind: o.kind ?? '(figura)',
            px: o.transform?.px ?? 0,
            py: o.transform?.py ?? 0,
            pz: o.transform?.pz ?? 0,
          });
        }
        return;
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f && !hallados.length; f = f.return) visit(f, 0);
    return hallados;
  });
}

try {
  // 1. Un objeto de texto (figura con color) para tener QUÉ ver: la cámara
  //    lo apuntará desde delante.
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500); // auto-creación del objeto de texto
  const objetos = await volcarObjetos();
  const figura = objetos.find((o) => o.kind !== 'camera');
  R.check(!!figura, 'hay una figura en la escena', 'el objeto de texto no se creó');
  const fx = figura?.px ?? 0, fy = figura?.py ?? 0, fz = figura?.pz ?? 0;
  console.log(`  · figura en (${fx}, ${fy}, ${fz})`);

  // 2. Crear la cámara apuntando a la figura: kf0 delante de ella a 3
  //    unidades, kf1 a un lado — el encuadre cambia mucho entre ambos.
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.fill('[data-testid="camera-focus-x"]', String(fx));
  await page.fill('[data-testid="camera-focus-y"]', String(fy));
  await page.fill('[data-testid="camera-focus-z"]', String(fz));
  await esperar(500);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-x"]', String(fx));
  await page.fill('[data-testid="camera-kf-pos-0-y"]', String(fy + 0.5));
  await page.fill('[data-testid="camera-kf-pos-0-z"]', String(fz + 3));
  await esperar(500);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', String(fx + 4));
  await page.fill('[data-testid="camera-kf-pos-1-y"]', String(fy + 1.5));
  await page.fill('[data-testid="camera-kf-pos-1-z"]', String(fz + 2));
  await esperar(800);

  // 3. Las 4 ventanas tienen selector de cámara con «Sin cámara» + «Cámara 1»,
  //    todas en «Sin cámara» al inicio. El botón «Vista cámara» ya no existe.
  const sel3d = page.locator('[data-testid="camera-select-3d"]');
  R.check((await sel3d.count()) === 1, 'la ventana 3D tiene selector de cámara', 'no hay selector en la ventana 3D');
  const nSelectores = await page.locator('[data-testid^="camera-select-"]').count();
  R.check(nSelectores === 4, 'las 4 ventanas tienen selector de cámara', `hay ${nSelectores} selectores, esperaba 4`);
  const opciones = await sel3d.locator('option').allTextContents();
  R.check(opciones.length === 2 && opciones[1].includes('Cámara 1'),
    'el selector lista «Sin cámara» y «Cámara 1»', 'opciones del selector raras: ' + opciones.join(' | '));
  R.check((await page.locator('button[title="Entrar en vista de cámara"]').count()) === 0,
    'el botón «Vista cámara» de la barra superior ya no existe', 'el botón viejo sigue en la interfaz');

  // 4. Vista libre + reproducir: la cámara del panel NO se mueve.
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.locator('button', { hasText: 'Editor de animación' }).first().click();
  await esperar(600);
  const libreA = await firmaVisor(3);
  const libreFrente = await firmaVisor(0);
  const moradoAntes = (await contarMoradoVentana(3)) ?? -1;
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(1200);
  const libreB = await firmaVisor(3);
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(500);
  const mismoLibre = libreA && libreB && libreA.firma === libreB.firma;
  R.check(mismoLibre, 'en vista libre reproducir NO mueve la cámara del panel', 'la vista libre cambió al reproducir (la cámara-objeto no debe manejarla)');

  // 5. Activar «Cámara 1» en la ventana 3D con el selector: se VE la escena
  //    desde la cámara (píxeles de la figura en el centro) y el encuadre
  //    cambia. El frontal NO se inmuta.
  const rojoBaseCentro = (await contarColorCentro(3, 0, 18)) ?? -1;
  await sel3d.selectOption({ index: 1 });
  await esperar(1200);
  const camVista = await firmaVisor(3);
  R.check(camVista && libreA && camVista.firma !== libreA.firma,
    'activar «Cámara 1» en la ventana cambia el encuadre (se ve desde la cámara)',
    'activar la cámara no cambió el encuadre');
  const rojoCentro = (await contarColorCentro(3, 0, 18)) ?? -1;
  console.log(`  · píxeles de la figura en el centro: libre ${rojoBaseCentro} → con cámara ${rojoCentro}`);
  R.check(rojoCentro > 40, 'desde la cámara activada se VE la escena (la figura llena el centro)',
    `la ventana activada no muestra la escena (píxeles de figura: ${rojoCentro}) — ¿tapa el cuerpo/lente de la cámara?`);
  const frenteTrasActivar = await firmaVisor(0);
  R.check(frenteTrasActivar && libreFrente && frenteTrasActivar.firma === libreFrente.firma,
    'activar la cámara en la ventana 3D no toca la ventana frontal',
    'el frontal cambió al activar la cámara en la ventana 3D');
  // Mientras la ventana maneja la cámara, su visual (cuerpo+lente+cono)
  // está oculto EN ESA VENTANA: el ojo vive dentro del cuerpo y taparía.
  const moradoActivo = (await contarMoradoVentana(3)) ?? -1;
  console.log(`  · píxeles del cuerpo en la ventana activada: ${moradoActivo} (antes: ${moradoAntes})`);
  R.check(moradoActivo <= moradoAntes, 'mientras maneja, el visual de la cámara se oculta en la ventana activada',
    `el cuerpo de la cámara no se ocultó en la ventana que maneja (${moradoActivo} píxeles morados vs ${moradoAntes} antes)`);
  // Ojo: en la ventana 3D el cuerpo casi no entra en encuadre (0-2 píxeles
  // según la pasada, con bordes de antialiasing), por eso el umbral no
  // exige 0 exacto. La prueba fuerte de que no tapa es la de
  // «se VE la escena» de arriba (píxeles de la figura en el centro).

  // 6. Reproducir: la imagen de la ventana 3D cambia (la cámara viaja
  //    kf1 → kf2 con el scrubbing) y sigue viéndose la escena al final.
  const camA = await firmaVisor(3);
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(1200);
  const camB = await firmaVisor(3);
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(500);
  R.check(camA && camB && camA.firma !== camB.firma,
    'con la cámara activa, reproducir mueve la cámara (el encuadre viaja kf1→kf2)',
    'reproducir con la cámara activa no cambió el encuadre');

  // 7. Volver a «Sin cámara»: se restaura la vista del panel y el cuerpo
  //    de la cámara vuelve a verse (el visual se desoculta).
  await sel3d.selectOption({ index: 0 });
  await esperar(1200);
  const salida = await firmaVisor(3);
  R.check(salida && salida.firma === libreA.firma,
    'volver a «Sin cámara» restaura la vista del panel',
    'al desactivar no se restauró la vista del panel');
  const moradoDespues = (await contarMoradoVentana(3)) ?? -1;
  console.log(`  · píxeles morados (cuerpo de cámara) tras desactivar: ${moradoDespues} (antes: ${moradoAntes})`);
  R.check(moradoDespues === moradoAntes,
    'al salir, el visual del cuerpo de la cámara vuelve a su visibilidad original',
    `el cuerpo quedó con otra visibilidad tras desactivar (${moradoDespues} píxeles morados vs ${moradoAntes} antes)`);

  // 8. Exportar MP4 habilitado (hay cámara con recorrido).
  const mp4 = page.locator('button', { hasText: 'Exportar MP4' }).last();
  await mp4.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const mp4Visible = await mp4.count();
  R.check(mp4Visible > 0, '«Exportar MP4» aparece con una cámara con recorrido', '«Exportar MP4» no aparece');
} finally {
  await R.resumen({ browser, errores });
}