/**
 * DIAG-GRABACION — modo grabación de fotogramas con la cámara-objeto.
 *
 * Comprueba: con la cámara apuntando a una figura y un recorrido previo de
 * 2 fotogramas hechos a mano, al pulsar REC (cámara asignada a la ventana
 * 3D) la vista sigue a la cámara en vivo; un clic sin arrastre NO captura;
 * cada arrastre de la vista soltado captura un kf encadenado al final
 * (último + 1 s); mover el cuerpo con el GIZMO en otra ventana (frontal)
 * TAMBIÉN captura un kf al soltar y la ventana grabadora sigue a la
 * cámara; al parar, la ventana vuelve a manejo sin saltos; y durante el
 * export MP4 no salen ayudas de edición (gizmo con su bola amarilla ni
 * asas del recorrido), restaurándose al terminar.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';

const R = crearResultados('DIAG-GRABACION · fotogramas grabados al soltar');

const { browser, page, errores } = await abrirEditor();

/** Vuelca la cámara-objeto y la figura por el fiber (con subida .return). */
async function volcarEscena() {
  return page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return null;
    const visit = (fib, prof) => {
      if (!fib || prof > 60) return null;
      const p = fib.memoizedProps;
      if (p && Array.isArray(p.sceneObjects)) {
        const cam = p.sceneObjects.find((o) => o.kind === 'camera' && o.camera);
        return {
          camara: cam
            ? {
                id: cam.id,
                transform: { px: cam.transform.px, py: cam.transform.py, pz: cam.transform.pz },
                keyframes: cam.camera.keyframes.map((k) => ({
                  time: k.time,
                  position: { ...k.position },
                  target: { ...k.target },
                })),
              }
            : null,
          figura: p.sceneObjects.find((o) => o.kind !== 'camera') ?? null,
        };
      }
      return visit(fib.child, prof + 1) ?? visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) {
      const r = visit(f, 0);
      if (r) return r;
    }
    return null;
  });
}

/** Firma de la ventana 3D (índice 3) para detectar saltos de encuadre. */
async function firmaVisor3D() {
  return page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[3] && conts[3].querySelector('canvas');
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
    const firma = [];
    for (let y = 0; y < off.height; y += 3) {
      for (let x = 0; x < off.width; x += 3) {
        const o = (y * off.width + x) * 4;
        firma.push(
          ((d[o] >> 5) << 10) | ((d[o + 1] >> 5) << 5) | (d[o + 2] >> 5)
        );
      }
    }
    return { firma: firma.join(',') };
  });
}

/** Simula un arrastre sobre el canvas de la ventana 3D. */
async function arrastrar(page, dx, dy) {
  const caja = await page
    .locator('[data-testid="viewer-container"]')
    .nth(3)
    .boundingBox();
  if (!caja) return false;
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
  return true;
}

/**
 * Píxeles saturados por rangos de matiz en la ventana idx: recuento,
 * centroide y caja envolvente (para encontrar flechas del gizmo).
 * `region` acota la búsqueda a [x0, y0, x1, y1] del lienzo (para aislar
 * el gizmo del entorno del cuerpo de la cámara).
 */
async function pixeles(idx, rangos, region) {
  return page.evaluate(async ({ i, rangos, region }) => {
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
    const salida = { width: off.width, height: off.height };
    for (const [nombre, h0, h1, satMin, valMin] of rangos) {
      let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      const envuelve = h0 > h1; // rango que cruza 0/360 (p. ej. rojo)
      const X0 = region ? Math.max(0, region[0]) : 0;
      const Y0 = region ? Math.max(0, region[1]) : 0;
      const X1 = region ? Math.min(off.width - 1, region[2]) : off.width - 1;
      const Y1 = region ? Math.min(off.height - 1, region[3]) : off.height - 1;
      for (let y = Y0; y <= Y1; y++) {
        for (let x = X0; x <= X1; x++) {
          const o = (y * off.width + x) * 4;
          const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx === 0 || mx - mn < 0.08) continue;
          const sat = (mx - mn) / mx;
          if (sat < (satMin ?? 0.45) || mx < (valMin ?? 0.5)) continue;
          let hue;
          if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
          else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
          else hue = 240 + ((r - g) / (mx - mn)) * 60;
          if (hue < 0) hue += 360;
          const dentro = envuelve ? hue >= h0 || hue <= h1 : hue >= h0 && hue <= h1;
          if (dentro) {
            n++; sx += x; sy += y;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      salida[nombre] = {
        n,
        cx: n ? Math.round(sx / n) : -1,
        cy: n ? Math.round(sy / n) : -1,
        x0: n ? x0 : -1,
        x1: n ? x1 : -1,
        y0: n ? y0 : -1,
        y1: n ? y1 : -1,
      };
    }
    return salida;
  }, { i: idx, rangos });
}

const RANGO_ASA = ['asa', 28, 58, 0.5, 0.85]; // asa naranja del foco (0xf59e0b, val ~0.92) y bolas del gizmo (0xffd93d, val 1.0); excluye el contorno AA de la figura (132,85,15, val ~0.52)
const RANGO_FLECHA_X = ['rojoVivo', 348, 12, 0.5, 0.72]; // flecha X 0xff4444 (val alto; los aros 0.55 quedan fuera)
const RANGO_FLECHA_Y = ['verde', 100, 160, 0.45, 0.5]; // flecha Y 0x44dd55
const RANGO_FLECHA_Z = ['azul', 210, 250, 0.45, 0.5]; // flecha Z 0x4488ff

try {
  // 1. Figura de texto (la cámara la apuntará) + cámara con 2 fotogramas
  //    hechos a mano, como en el flujo real del usuario.
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500);
  const esc1 = await volcarEscena();
  const figura = esc1?.figura;
  R.check(!!figura, 'hay una figura en la escena', 'el objeto de texto no se creó');
  const fx = figura?.transform?.px ?? 0, fy = figura?.transform?.py ?? 0, fz = figura?.transform?.pz ?? 0;
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

  // 2. Asignar la cámara a la ventana 3D y encender la grabación: la vista
  //    sigue a la cámara (pose del último kf, anclada al arrancar).
  await page.locator('[data-testid="camera-select-3d"]').selectOption({ index: 1 });
  await esperar(900);
  const sel = page.locator('[data-testid="camera-select-3d"]');
  R.check((await sel.count()) === 1, 'la cámara está asignada a la ventana 3D', 'no hay selector de cámara en la ventana 3D');
  const preRec = await volcarEscena();
  R.check(preRec?.camara?.keyframes?.length === 2, 'la cámara arranca con 2 fotogramas previos (hechos a mano)', `esperaba 2 kfs previos, hay ${preRec?.camara?.keyframes?.length}`);

  await page.click('[data-testid="rec-btn-3d"]');
  await esperar(900);
  const rec = page.locator('[data-testid="rec-indicator"]');
  R.check((await rec.count()) === 1, 'el botón REC enciende la grabación (overlay «REC» en el visor)', 'el overlay REC no apareció al pulsar REC');
  R.check(((await rec.textContent()) || '').trim().includes('2'),
    'el overlay REC cuenta los 2 fotogramas previos',
    'el overlay REC no refleja los 2 fotogramas previos: ' + (await rec.textContent()));

  // 2b. Al arrancar la grabación la vista NO salta: la ventana grabadora
  //     ya mostraba la pose del último kf (el manejo no se interrumpe).
  const firmaRecA = await firmaVisor3D();
  await esperar(600);
  const firmaRecB = await firmaVisor3D();
  R.check(firmaRecA && firmaRecB && firmaRecA.firma === firmaRecB.firma,
    'con la grabación encendida, la vista sigue a la cámara (estable en el último kf)',
    'la vista de la ventana grabadora se mueve sola al grabar');

  // 3. Un clic sin arrastre NO crea fotograma.
  const caja = await page.locator('[data-testid="viewer-container"]').nth(3).boundingBox();
  await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await esperar(900);
  const trasClic = await volcarEscena();
  R.check(trasClic?.camara?.keyframes?.length === 2, 'un clic sin arrastre (<4 px) NO captura fotograma',
    `un clic sin arrastre creó kf extra (total ${trasClic?.camara?.keyframes?.length})`);

  // 4. Tres arrastres soltados → tres kfs encadenados 3000, 4000, 5000
  //    (después de los previos 0 y 2000).
  for (const [dx, dy] of [[90, 40], [-110, 30], [70, -80]]) {
    await arrastrar(page, dx, dy);
    await esperar(900);
  }
  const trasDrags = await volcarEscena();
  const kfs = trasDrags?.camara?.keyframes ?? [];
  R.check(kfs.length === 5, `los 3 arrastres añadieron 3 kfs al recorrido (total ${kfs.length})`,
    `esperaba 5 fotogramas tras 3 arrastres, hay ${kfs.length}`);
  R.check(
    kfs.length === 5 && kfs[2].time === 3000 && kfs[3].time === 4000 && kfs[4].time === 5000,
    'los tiempos van encadenados al final del recorrido previo: 3 s, 4 s y 5 s',
    'los tiempos no quedaron encadenados: ' + kfs.map((k) => k.time).join(', ')
  );
  if (kfs.length === 5) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    R.check(
      dist(kfs[2].position, kfs[3].position) > 0.05 &&
        dist(kfs[3].position, kfs[4].position) > 0.05,
      'cada arrastre dejó una pose distinta (la cámara se movió de verdad)',
      'las poses capturadas coinciden: los arrastres no movieron la cámara'
    );
    const tr = trasDrags.camara.transform;
    const ultimo = kfs[4].position;
    R.check(
      Math.abs(tr.px - ultimo.x) < 1e-6 &&
        Math.abs(tr.py - ultimo.y) < 1e-6 &&
        Math.abs(tr.pz - ultimo.z) < 1e-6,
      'el transform del cuerpo quedó en el último punto grabado',
      `el transform (${tr.px}, ${tr.py}, ${tr.pz}) no coincide con el último kf (${ultimo.x}, ${ultimo.y}, ${ultimo.z})`
    );
  }

  // 5. La lista del panel y el contador del overlay se actualizan en vivo.
  const filasLista = await page.locator('[data-testid="camera-keyframe-list"] [data-testid^="camera-keyframe-"]').count();
  R.check(filasLista === 5, `la lista de fotogramas del panel muestra 5 (${filasLista})`, `la lista del panel muestra ${filasLista} filas, esperaba 5`);
  const textoRec = ((await rec.textContent()) || '').trim();
  R.check(textoRec.includes('5'), `el overlay REC cuenta 5 fotogramas («${textoRec}»)`, `el overlay REC no refleja los 5 fotogramas: «${textoRec}»`);

  // 6. Mover el cuerpo con el GIZMO («Flechas XYZ») en la ventana frontal
  //    (otra ventana): al soltar captura un kf (t = 6 s) y la ventana
  //    grabadora lo sigue.
  // La casilla «Flechas XYZ» vive en la cabecera de la ventana, FUERA del
  // viewer-container; la primera en el DOM es la de la ventana frontal.
  const casilla = page
    .locator('label[title*="Flechas de los ejes"]')
    .first()
    .locator('input');
  await casilla.check();
  await esperar(700);
  await page.locator('[data-testid="scene-object-1"]').click();
  await esperar(900);
  const gizmoBusca = await pixeles(0, [['morado', 250, 300, 0.15, 0.2], RANGO_FLECHA_X, RANGO_FLECHA_Y, RANGO_FLECHA_Z]);
  console.log(`  · ventana frontal: morado=${gizmoBusca?.morado?.n} flechas X=${gizmoBusca?.rojoVivo?.n} Y=${gizmoBusca?.verde?.n} Z=${gizmoBusca?.azul?.n} (centro morado=(${gizmoBusca?.morado?.cx}, ${gizmoBusca?.morado?.cy}))`);
  R.check((gizmoBusca?.morado?.n ?? 0) > 60,
    'el cuerpo de la cámara se ve en la ventana frontal (para arrastrar su gizmo)',
    'el cuerpo de la cámara no aparece en la ventana frontal');
  if ((gizmoBusca?.morado?.n ?? 0) > 60) {
    const firmaGrabPreGizmo = await firmaVisor3D();
    // Acercar la vista frontal hasta que una flecha del gizmo tenga
    // píxeles suficientes para cogerla con precisión. La búsqueda queda
    // acotada al entorno del cuerpo de la cámara: la figura roja de la
    // escena comparte el matiz de la flecha X y ensuciaría el recuento.
    // (El botón «Acercar» vive en la cabecera, fuera del viewer-container;
    // el primero en el DOM es el de la ventana frontal.)
    const botonZoom = page.locator('button[title="Acercar"]').first();
    let flecha = null;
    for (let i = 0; i < 18 && !flecha; i++) {
      const cuerpo = await pixeles(0, [['morado', 250, 300, 0.15, 0.2]]);
      const c = cuerpo?.morado;
      if (c && c.n > 0) {
        const region = [
          Math.max(0, c.x0 - 60), Math.max(0, c.y0 - 60),
          Math.min(1919, c.x1 + 60), Math.min(1079, c.y1 + 60),
        ];
        const f = await pixeles(0, [RANGO_FLECHA_X, RANGO_FLECHA_Y, RANGO_FLECHA_Z], region);
        for (const [clave, eje] of [['rojoVivo', 'x'], ['verde', 'y'], ['azul', 'z']]) {
          if ((f?.[clave]?.n ?? 0) >= 12) { flecha = { clave, eje: f[clave], ejeMundo: eje }; break; }
        }
      }
      if (!flecha) {
        if ((await botonZoom.count()) === 0) break;
        await botonZoom.click();
        await esperar(450);
      }
    }
    console.log(`  · zooms aplicados, flecha: ${flecha ? flecha.clave + ` n=${flecha.eje.n} bbox x=[${flecha.eje.x0}, ${flecha.eje.x1}] cy=${flecha.eje.cy}` : 'no encontrada'}`);
    if (flecha) {
      const caja0 = await page.locator('[data-testid="viewer-container"]').nth(0).boundingBox();
      // Arrastrar en la dirección del eje: X → derecha, Z → abajo, Y → arriba.
      let sx, sy, dx, dy;
      if (flecha.ejeMundo === 'x') {
        sx = caja0.x + flecha.eje.x1 - 6;
        sy = caja0.y + flecha.eje.cy;
        dx = 90; dy = 0;
      } else if (flecha.ejeMundo === 'z') {
        sx = caja0.x + flecha.eje.cx;
        sy = caja0.y + flecha.eje.y1 - 6;
        dx = 0; dy = 90;
      } else {
        sx = caja0.x + flecha.eje.cx;
        sy = caja0.y + flecha.eje.y0 + 6;
        dx = 0; dy = -90;
      }
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + dx, sy + dy, { steps: 10 });
      await page.mouse.up();
      await esperar(1000);
      const trasGizmo = await volcarEscena();
      const kfsG = trasGizmo?.camara?.keyframes ?? [];
      R.check(kfsG.length === 6 && kfsG[5].time === 6000,
        `soltar el gizmo sobre la cámara grabada captura un kf (total ${kfsG.length}, t=${kfsG[5]?.time ?? '?'})`,
        'el arrastre del gizmo no capturó el fotograma 6');
      if (kfsG.length === 6) {
        const tG = trasGizmo.camara.transform;
        const uG = kfsG[5].position;
        R.check(
          Math.abs(tG.px - uG.x) < 1e-6 && Math.abs(tG.py - uG.y) < 1e-6,
          'el transform quedó en la pose del kf capturado con el gizmo',
          `el transform (${tG.px}, ${tG.py}) no coincide con el kf del gizmo`
        );
      }
      // La ventana grabadora sigue al cuerpo: su encuadre cambió.
      const firmaGrabPostGizmo = await firmaVisor3D();
      R.check(firmaGrabPreGizmo && firmaGrabPostGizmo && firmaGrabPreGizmo.firma !== firmaGrabPostGizmo.firma,
        'la ventana grabadora sigue al cuerpo movido con el gizmo (la grabación se mueve)',
        'la ventana grabadora no siguió al cuerpo tras el arrastre del gizmo');
    } else {
      R.check(false, 'una flecha del gizmo es localizable en la frontal', 'no se encontró ninguna flecha del gizmo ni acercando la vista');
    }
  }

  // 7. Parar la grabación: overlay fuera, la ventana vuelve a manejo con
  //    la pose del último kf (firma estable = sin salto de encuadre).
  await page.click('[data-testid="rec-btn-3d"]');
  await esperar(1200);
  R.check((await page.locator('[data-testid="rec-indicator"]').count()) === 0,
    'al parar la grabación el overlay «REC» desaparece',
    'el overlay REC siguió visible tras parar');
  const firmaA = await firmaVisor3D();
  await esperar(600);
  const firmaB = await firmaVisor3D();
  R.check(firmaA && firmaB && firmaA.firma === firmaB.firma,
    'tras parar, la vista está estable en la pose del último fotograma',
    'la vista saltó tras parar la grabación');

  // 8. Guarda 1: cambiar el selector a «Sin cámara» corta la grabación.
  await page.click('[data-testid="rec-btn-3d"]');
  await esperar(800);
  R.check((await page.locator('[data-testid="rec-indicator"]').count()) === 1,
    'se puede volver a encender la grabación',
    'el botón REC no volvió a encender la grabación');
  await sel.selectOption({ index: 0 });
  await esperar(900);
  R.check((await page.locator('[data-testid="rec-indicator"]').count()) === 0,
    'cambiar la cámara de la ventana a «Sin cámara» corta la grabación',
    'la grabación siguió activa tras quitar la cámara de la ventana');

  // 9. Guarda 2: iniciar la reproducción corta la grabación.
  await sel.selectOption({ index: 1 });
  await esperar(900);
  await page.click('[data-testid="rec-btn-3d"]');
  await esperar(800);
  await page.locator('button', { hasText: 'Editor de animación' }).first().click();
  await esperar(700);
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(900);
  R.check((await page.locator('[data-testid="rec-indicator"]').count()) === 0,
    'iniciar la reproducción corta la grabación',
    'la grabación siguió activa al reproducir');
  await page.locator('[data-testid="play-animation-btn"]').click();
  await esperar(500);

  // 10. Export MP4 limpio: con la CÁMARA seleccionada (gizmo «Flechas XYZ»
  //     encendido en la frontal) y un fotograma del recorrido activo (asa
  //     naranja del foco visible), durante el vídeo no salen ayudas de
  //     edición y al terminar se restauran.
  await page.locator('button', { hasText: 'Exportar MP4' }).last().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const hayMp4 = (await page.locator('button', { hasText: 'Exportar MP4' }).count()) > 0;
  R.check(hayMp4, '«Exportar MP4» aparece con la cámara con recorrido', '«Exportar MP4» no aparece');
  if (hayMp4) {
    await page.click('[data-testid="tab-scene"]');
    await esperar(700);
    await page.locator('[data-testid="scene-object-1"]').click();
    await esperar(800);
    // Activar el último fotograma del recorrido: el asa naranja del foco
    // debe verse en la ventana frontal (sin cámara asignada → recorrido
    // visible) junto al gizmo encendido en la sección 6.
    const filasKf = page.locator('[data-testid="camera-keyframe-list"] [data-testid^="camera-keyframe-"]');
    if ((await filasKf.count()) > 0) {
      await filasKf.last().click();
      await esperar(800);
    }
    const pre = await pixeles(0, [RANGO_ASA]);
    console.log(`  · asas naranjas ANTES del export: ${pre?.asa?.n}`);
    R.check((pre?.asa?.n ?? 0) > 20,
      'control: se ven el asa naranja del foco y/o las bolas del gizmo antes del export',
      'el detector de asas no ve ayudas antes del export (calibración rota)');
    await page.locator('button', { hasText: 'Exportar MP4' }).last().click();
    await esperar(600);
    const muestras = [];
    for (let i = 0; i < 9; i++) {
      await esperar(450);
      const m = await pixeles(0, [RANGO_ASA]);
      if (m) muestras.push({ w: m.width, as: m.asa.n });
    }
    const conExport = muestras.filter((m) => m.w === 1920);
    console.log(`  · muestras durante export (1920): ${conExport.length}/${muestras.length}, asas: ${conExport.map((m) => m.as).join(', ') || '(ninguna)'}`);
    R.check(conExport.length > 0, 'el export MP4 corrió (el canvas pasó a 1920 px de ancho)', 'ninguna muestra captó la exportación en marcha');
    if (conExport.length > 0) {
      R.check(conExport.every((m) => m.as === 0),
        'durante el export NO salen la bola amarilla ni el asa naranja ni el gizmo en el vídeo',
        `el vídeo exportado muestra ayudas de edición (${Math.max(...conExport.map((m) => m.as))} píxeles naranjas)`);
    }
    // Esperar a que termine el export (el canvas deja de estar a 1920).
    for (let i = 0; i < 40; i++) {
      await esperar(500);
      const fin = await pixeles(0, [RANGO_ASA]);
      if (fin && fin.width !== 1920) break;
    }
    const post = await pixeles(0, [RANGO_ASA]);
    console.log(`  · asas tras el export: ${post?.asa?.n}`);
    R.check((post?.asa?.n ?? 0) > 20,
      'al terminar el export, el asa del foco y el gizmo se restauran',
      'las ayudas de edición no volvieron a verse tras el export');
  }
} finally {
  await R.resumen({ browser, errores });
}