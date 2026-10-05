/* Verificación por PÍXELES del canvas WebGL: la bola amarilla del foco
   (posHandle 0xffff00) debe desaparecer al desconectar el foco. */
const { chromium } = require('playwright');

async function contarPixelesAmarillos(page) {
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
      // Amarillo puro con opacidad ~0.85 sobre fondo oscuro: r alto, g alto, b bajo
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 200 && g > 200 && b < 120) n++;
      }
      if (n > mejor) mejor = n;
    }
    return mejor;
  });
}

(async () => {
  const clickSinteticos = function (el) {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });
  await page.waitForTimeout(2500);

  // Crear un foco: modal de luces → añadir foco → guardar.
  // El menú se maneja con teclado; ArrowDown salta los ítems
  // deshabilitados, así que avanzamos hasta que el foco esté en «Luces».
  await page.focus('[data-testid="actions-menu-trigger"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let enLuces = false;
  for (let i = 0; i < 12; i++) {
    const texto = await page.evaluate(
      () => document.activeElement?.textContent?.trim() ?? ''
    );
    if (texto.startsWith('Luces')) { enLuces = true; break; }
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  if (!enLuces) throw new Error('No se pudo enfocar el ítem Luces');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  // Confirmar que el modal de luces abrió.
  await page.waitForSelector('text=Configuración de luces', { timeout: 8000 });
  const addSpot = await page.$('[role="dialog"] button:has-text("Añadir foco")');
  if (!addSpot) throw new Error('No se encontró el botón de añadir foco');
  const clickSintetico = (el) => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  };
  await addSpot.evaluate(clickSinteticos);
  await page.waitForTimeout(300);
  // Colocar el foco donde la ventana 3D lo vea: (0, 2, 4).
  const campos = await page.$$('[role="dialog"] input[type="number"]');
  // Los 3 primeros campos numéricos son X, Y, Z de la posición.
  if (campos.length >= 3) {
    await campos[0].fill('0');
    await campos[1].fill('2');
    await campos[2].fill('4');
    await page.waitForTimeout(300);
  }
  const saveBtn = await page.$('[role="dialog"] button:has-text("Guardar")');
  await saveBtn.evaluate(clickSinteticos);
  await page.waitForTimeout(1500);

  const amarillosAntes = await contarPixelesAmarillos(page);
  console.log('Píxeles amarillos con el foco conectado:', amarillosAntes);

  // Desconectar el foco desde la lista de objetos.
  await page.waitForSelector('[data-testid="scene-spotlight-0"]', { timeout: 10000 });
  await page.click('[data-testid="scene-spotlight-toggle-0"]');
  await page.waitForTimeout(1500);
  const amarillosDespues = await contarPixelesAmarillos(page);
  console.log('Píxeles amarillos con el foco desconectado:', amarillosDespues);
  if (amarillosAntes > 50 && amarillosDespues > 50) {
    console.log('FALLO: la bola amarilla sigue en el visor con el foco apagado');
  } else if (amarillosAntes <= 50) {
    console.log('AVISO: no se detectó la bola con el foco conectado (¿posición del foco fuera de cámara?)');
  } else {
    console.log('OK: la bola desaparece al desconectar');
  }
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });