/* Verificación DOM/píxeles del selector de vértices/segmentos/caras:
   - objetivo (Cara/Vértice/Segmento) y herramientas Rectángulo/Círculo/Línea (sin Polígono);
   - seleccionar vértices, segmentos y caras con rectángulo (probando TODOS los paneles 3D);
   - mover la selección arrastrando (la figura cambia de sitio);
   - asignar textura a las caras seleccionadas (píxeles rojizos). */
const { chromium } = require('playwright');

async function contarRojizos(page) {
  return page.evaluate(() => {
    let mejor = -1;
    for (const canvas of document.querySelectorAll('canvas')) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) continue;
      const ctx = document.createElement('canvas');
      ctx.width = w; ctx.height = h;
      const c2 = ctx.getContext('2d');
      c2.drawImage(canvas, 0, 0);
      const data = c2.getImageData(0, 0, w, h).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // Rojizo: rojo claramente dominante (la textura de prueba es roja)
        if (r > 80 && r > g * 1.5 && r > b * 1.5) n++;
      }
      if (n > mejor) mejor = n;
    }
    return mejor;
  });
}

// Instantánea de TODOS los canvas apaisados (para detectar movimiento).
function instantaneasPaneles(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('canvas')]
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(({ r }) => r.width > r.height * 1.4)
      .map(({ c }) => {
        const t = document.createElement('canvas');
        t.width = c.width; t.height = c.height;
        t.getContext('2d').drawImage(c, 0, 0);
        return t.toDataURL('image/png');
      });
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errores = [];
  page.on('pageerror', (err) => errores.push(String(err).slice(0, 200)));
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });
  await page.waitForTimeout(2000);

  // 1) Objeto real: Acciones → Objeto 3D → tarjeta del catálogo.
  //    (reintentos: el menú a veces no abre o el modal tarda)
  const abrirCatalogo = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.focus('[data-testid="actions-menu-trigger"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    for (let i = 0; i < 12; i++) {
      const texto = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (texto.startsWith('Objeto 3D') || texto.startsWith('3D object')) return true;
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
    }
    return false;
  };

  let tarjeta = null;
  for (let intento = 0; intento < 3 && !tarjeta; intento++) {
    if (!(await abrirCatalogo())) continue;
    await page.keyboard.press('Enter');
    // Los nombres reales vienen de la API; las tarjetas cargan asíncrono.
    const nombres = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/objetos-3d', { cache: 'no-store' });
        const d = await r.json();
        return (d.files || []).map((f) => f.name.replace(/\.zeus$/i, ''));
      } catch { return []; }
    });
    for (const nombre of nombres) {
      try {
        tarjeta = await page.waitForSelector(
          `[role="dialog"] :text("${nombre}")`,
          { timeout: 8000 }
        );
        break;
      } catch { /* siguiente nombre */ }
    }
  }
  if (!tarjeta) {
    const texto = await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.innerText?.slice(0, 300) ?? 'SIN DIÁLOGO'
    );
    throw new Error('No apareció ninguna tarjeta de objeto en el catálogo: ' + texto);
  }
  // Subir hasta el ancestro clicable (la tarjeta puede no ser <button>).
  await tarjeta.evaluate((el) => {
    let destino = el;
    for (let i = 0; i < 6; i++) {
      if (!destino.parentElement) break;
      destino = destino.parentElement;
      if (
        destino.tagName === 'BUTTON' ||
        destino.getAttribute('role') === 'button' ||
        (destino.className || '').toString().includes('cursor-pointer')
      ) break;
    }
    destino.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    destino.click();
  });
  await page.waitForTimeout(2000);
  const nObjetos = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="scene-object-"]:not([data-testid="scene-object-list"])').length
  );
  console.log('Objetos en la escena:', nObjetos);
  if (nObjetos === 0) throw new Error('El objeto del catálogo no se creó');

  // Si el catálogo sigue abierto, cerrarlo a la fuerza (bloquea los clics del visor).
  for (let intento = 0; intento < 3; intento++) {
    const abierto = await page.$('[role="dialog"]');
    if (!abierto) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const cancelar = await page.$('[role="dialog"] button:has-text("Cancelar")');
    if (cancelar) {
      await cancelar.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      });
      await page.waitForTimeout(800);
    }
  }
  const dialogos = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  console.log('Diálogos abiertos tras cierre:', dialogos);

  // 2) Activar el selector de caras (botón en la toolbar del visor).
  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  if (!toggleSel) throw new Error('No se encontró el botón del selector');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(400);

  // 3) Desplegables: objetivo y herramientas.
  const objetivo = await page.$('select[title*="Qué seleccionar"]');
  if (!objetivo) throw new Error('Falta el desplegable de objetivo');
  const opcionesObjetivo = await objetivo.$$eval('option', (os) => os.map((o) => o.value));
  console.log('Opciones de objetivo:', opcionesObjetivo.join(','));
  if (opcionesObjetivo.join(',') !== 'cara,vertice,segmento') {
    throw new Error('El objetivo no tiene las tres opciones');
  }
  const herramientas = await page.$$eval('select:not([title]) option', (os) => os.map((o) => o.value));
  if (!herramientas.includes('line') || herramientas.includes('polygon')) {
    throw new Error('La herramienta Línea no sustituyó a Polígono');
  }
  console.log('Herramientas rectángulo/círculo/línea: OK');

  // Paneles 3D: TODOS los canvas apaisados (los lienzos 2D son cuadrados).
  const paneles3d = async () => page.evaluate(() => {
    return [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > r.height * 1.4)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  });
  const paneles = await paneles3d();
  console.log('Paneles 3D encontrados:', paneles.length);

  const contarBarra = async (etiqueta) => {
    let texto = '';
    try { texto = await page.textContent('[data-testid="face-select-bar"]'); } catch { /* sin barra */ }
    const n = Number((texto.match(/^(\d+)/) || [])[1] || 0);
    console.log(etiqueta, n);
    return n;
  };

  // Rectángulo en un panel concreto; devuelve la cuenta de la barra.
  const rectEnPanel = async (panel, dx1, dy1, dx2, dy2) => {
    const cx = panel.x + panel.w / 2;
    const cy = panel.y + panel.h / 2;
    await page.mouse.move(cx + dx1, cy + dy1);
    await page.mouse.down();
    await page.mouse.move(cx + dx2, cy + dy2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };

  // Selecciona con rectángulo probando panel por panel hasta que la barra > 0.
  const seleccionarEnAlgunPanel = async (etiqueta, dx1 = -150, dy1 = -120, dx2 = 150, dy2 = 120) => {
    const lista = await paneles3d();
    for (const panel of lista) {
      await rectEnPanel(panel, dx1, dy1, dx2, dy2);
      const n = await contarBarra(etiqueta + ' panel(' + Math.round(panel.x) + ',' + Math.round(panel.y) + '):');
      if (n > 0) return { n, panel };
    }
    return { n: 0, panel: null };
  };

  // Cambia el objetivo en TODOS los desplegables visibles con el método
  // nativo (setter + change): selectOption de Playwright exige estabilidad
  // entre fotogramas y con malla grande el headless va a ~1 FPS.
  const elegirObjetivo = async (valor) => {
    await page.$$eval(
      'select[title*="Qué seleccionar"]',
      (sels, v) => {
        for (const s of sels) {
          if (s.offsetParent === null) continue;
          const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
          proto.set.call(s, v);
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      valor
    );
    await page.waitForTimeout(800);
  };

  // 4) VÉRTICES: rectángulo mediano (subconjunto; 3880 vértices enteros
  //    colapsan la página al mover).
  await elegirObjetivo('vertice');
  await page.waitForTimeout(300);
  const resVerts = await seleccionarEnAlgunPanel('Vértices seleccionados', -80, -60, 80, 60);
  const nVerts = resVerts.n;

  // 5) MOVER la selección: arrastrar dentro del panel donde se seleccionó
  //    (rejilla corta de intentos; el contenido del canvas cambia cuando la
  //    figura se desplaza).
  let movio = false;
  if (resVerts.panel) {
    const panel = resVerts.panel;
    const antes = await instantaneasPaneles(page);
    exterior:
    for (const gx of [-40, 0, 40]) {
      for (const gy of [-40, 0, 40]) {
        await rectEnPanel(panel, gx, gy, gx + 40, gy + 30);
        const ahora = await instantaneasPaneles(page);
        if (ahora.join('|') !== antes.join('|')) { movio = true; break exterior; }
      }
    }
  }
  console.log('Mover la selección de vértices desplaza la figura:', movio ? 'SÍ' : 'NO');

  // 6) SEGMENTOS: rectángulo (selección nueva tras cambiar objetivo).
  await elegirObjetivo('segmento');
  await page.waitForTimeout(300);
  const resSegs = await seleccionarEnAlgunPanel('Segmentos seleccionados', -80, -60, 80, 60);
  const nSegs = resSegs.n;

  // 7) CARAS: rectángulo y textura roja por caras.
  await elegirObjetivo('cara');
  await page.waitForTimeout(300);
  const resCaras = await seleccionarEnAlgunPanel('Caras seleccionadas', -80, -60, 80, 60);
  const nCaras = resCaras.n;
  const btnAsignar = await page.$('[data-testid="face-texture-assign"]');
  const deshabilitado = await btnAsignar.evaluate((el) => el.disabled);
  console.log('Botón Asignar textura habilitado:', deshabilitado ? 'NO' : 'SÍ');
  if (deshabilitado) throw new Error('Asignar textura deshabilitado con caras seleccionadas');

  const rojosAntes = await contarRojizos(page);
  // Imagen roja de prueba por el input oculto de la barra.
  const pngRojo1px = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const inputTextura = await page.$('[data-testid="face-select-bar"] input[type="file"]');
  await inputTextura.setInputFiles({
    name: 'rojo.png',
    mimeType: 'image/png',
    buffer: pngRojo1px,
  });
  await page.waitForTimeout(2500);
  const rojosDespues = await contarRojizos(page);
  console.log('Píxeles rojizos antes/después de asignar textura:', rojosAntes, '/', rojosDespues);

  // 8) Quitar textura: vuelve a no tener rojizos extra.
  const btnQuitar = await page.$('[data-testid="face-texture-clear"]');
  await btnQuitar.evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  const rojosTrasQuitar = await contarRojizos(page);
  console.log('Píxeles rojizos tras quitar textura:', rojosTrasQuitar);

  console.log('Errores de página:', errores.length ? errores.slice(0, 4) : 'ninguno');

  let fallos = 0;
  if (nVerts === 0) { console.log('FALLO: no se seleccionaron vértices'); fallos++; }
  if (!movio) { console.log('FALLO: mover la selección no desplazó la figura'); fallos++; }
  if (nSegs === 0) { console.log('FALLO: no se seleccionaron segmentos'); fallos++; }
  if (nCaras === 0) { console.log('FALLO: no se seleccionaron caras'); fallos++; }
  if (rojosDespues <= rojosAntes + 50) { console.log('FALLO: la textura por caras no se pintó'); fallos++; }
  if (rojosTrasQuitar > 50) { console.log('AVISO: siguen quedando píxeles rojizos tras quitar'); }
  if (fallos > 0) process.exit(1);
  console.log('OK');
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });