/* Reproduce el flujo del usuario: objeto de la escena + selector de
   vértices/segmentos/caras, con CLIC simple y con ARRASTRE. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errores = [];
  page.on('pageerror', (err) => errores.push(String(err).slice(0, 200)));
  page.on('console', (msg) => {
    if (msg.text().includes('[fsel]')) console.log('CONSOLA:', msg.text());
  });
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });
  await page.waitForTimeout(2500);

  const nObjetos = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="scene-object-"]:not([data-testid="scene-object-list"])').length
  );
  console.log('Objetos en la escena:', nObjetos);
  if (nObjetos === 0) {
    // Importar del catálogo (las tarjetas cargan asíncrono).
    await page.focus('[data-testid="actions-menu-trigger"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    for (let i = 0; i < 12; i++) {
      const t = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (t.startsWith('Objeto 3D') || t.startsWith('3D object')) break;
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Enter');
    const nombres = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/objetos-3d', { cache: 'no-store' });
        const d = await r.json();
        return (d.files || []).map((f) => f.name.replace(/\.zeus$/i, ''));
      } catch { return []; }
    });
    let tarjeta = null;
    for (const nombre of nombres) {
      try {
        tarjeta = await page.waitForSelector(`[role="dialog"] :text("${nombre}")`, { timeout: 8000 });
        break;
      } catch { /* siguiente */ }
    }
    if (!tarjeta) throw new Error('Catálogo sin tarjetas');
    await tarjeta.evaluate((el) => {
      let d = el;
      for (let i = 0; i < 6 && d.parentElement; i++) {
        d = d.parentElement;
        if (d.tagName === 'BUTTON' || d.getAttribute('role') === 'button' ||
            (d.className || '').toString().includes('cursor-pointer')) break;
      }
      d.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      d.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      d.click();
    });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 3; i++) {
      if (!(await page.$('[role="dialog"]'))) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const c = await page.$('[role="dialog"] button:has-text("Cancelar")');
      if (c) { await c.evaluate((el) => el.click()); await page.waitForTimeout(600); }
    }
  }

  // Seleccionar el primer objeto (como hace el usuario).
  const fila = await page.$('[data-testid^="scene-object-"]:not([data-testid="scene-object-list"])');
  const filaTexto = await fila.evaluate((el) => el.innerText.replace(/\s+/g, ' ').slice(0, 80));
  console.log('Fila 1:', filaTexto);
  await fila.evaluate((el) => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  });
  await page.waitForTimeout(800);
  const estado = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('[data-testid^="scene-object-"]:not([data-testid="scene-object-list"])')].map((f) => ({
      texto: f.innerText.replace(/\s+/g, ' ').slice(0, 60),
      seleccionada: f.className.includes('green'),
    }));
    return {
      filas,
      barras: document.querySelectorAll('[data-testid="face-select-bar"]').length,
      desplegables: document.querySelectorAll('select[title*="Qué seleccionar"]').length,
    };
  });
  console.log('Estado:', JSON.stringify(estado, null, 1));

  // Activar el selector de caras.
  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  if (!toggleSel) throw new Error('No se encontró el botón del selector');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(500);

  const paneles = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > r.height * 1.4)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  });
  console.log('Paneles 3D:', paneles.length);

  const contarBarra = async (etiqueta) => {
    let texto = '';
    try { texto = await page.textContent('[data-testid="face-select-bar"]'); } catch { /* sin barra */ }
    const n = Number((texto.match(/^(\d+)/) || [])[1] || 0);
    console.log(etiqueta, n);
    return n;
  };

  for (const objetivo of ['cara', 'vertice', 'segmento']) {
    const sel = await page.$('select[title*="Qué seleccionar"]');
    await sel.selectOption(objetivo);
    await page.waitForTimeout(300);
    // Clic simple en el centro de cada panel.
    for (const p of paneles) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
      const n = await contarBarra(`[${objetivo}] CLIC panel(${Math.round(p.x)},${Math.round(p.y)}):`);
      if (n > 0) break;
    }
    // Arrastre pequeño en cada panel (limpia antes cambiando de objetivo no;
    // el toggle añade: probamos también deselect→select con el mismo gesto).
    for (const p of paneles) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      await page.mouse.move(cx - 60, cy - 50);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy + 50, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const n = await contarBarra(`[${objetivo}] ARRASTRE panel(${Math.round(p.x)},${Math.round(p.y)}):`);
      if (n > 0) break;
    }
    // Segundo clic/arrastre idéntico para probar el "toggle" (debería vaciar).
  }

  console.log('Errores de página:', errores.length ? errores.slice(0, 4) : 'ninguno');
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });