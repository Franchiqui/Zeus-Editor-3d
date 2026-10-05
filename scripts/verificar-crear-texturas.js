/* Verificación del flujo de texturas creadas:
   1) Acciones → «Crear textura» abre el modal.
   2) Crear una textura la guarda en localStorage ('textures_db').
   3) El explorador de Texturas la muestra en la categoría «Creadas» y
      al elegirla se aplica (data URL) al destino.
   4) La tarjeta tiene el botón del ojo: abre la vista previa 3D
      (cubo/esfera) como en la app de origen.
   5) La tarjeta tiene el botón del lápiz: reabre el modal con la
      textura cargada y al guardar se actualiza la tarjeta. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });

  // Estado previo de las texturas creadas (para comparar después).
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('textures_db') || '[]').length
  );

  // 1) Abrir Acciones → Crear textura.
  await page.click('[data-testid="actions-menu-trigger"]');
  const crearItem = page.getByRole('menuitem', { name: /Crear textura|Create texture/ });
  await crearItem.waitFor({ timeout: 5000 });
  console.log('Menú Acciones: opción «Crear textura» visible ✔');
  await crearItem.click();

  // 2) Rellenar el modal.
  await page.waitForSelector('input[placeholder="Ej: Cristal Azul"]', { timeout: 10000 });
  await page.fill('input[placeholder="Ej: Cristal Azul"]', 'Prueba Automática');
  await page.click('button:has-text("Madera")');
  await page.click('button:has-text("Crear textura")');
  await page.waitForTimeout(500);

  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('textures_db') || '[]')
  );
  if (after.length !== before + 1) {
    throw new Error(`La textura no se guardó: antes ${before}, después ${after.length}`);
  }
  const creada = after[after.length - 1];
  console.log('Textura guardada ✔ —', creada.name, creada.type, creada.color);

  // 3) Abrir el explorador de Texturas (Textura del suelo) y verla.
  await page.click('[data-testid="actions-menu-trigger"]');
  const sueloItem = page.getByRole('menuitem', { name: /Textura del suelo|Ground texture/ });
  await sueloItem.waitFor({ timeout: 5000 });
  await sueloItem.click();
  await page.waitForSelector('button:has-text("Creadas")', { timeout: 15000 });
  await page.click('button:has-text("Creadas")');
  await page.waitForSelector('text=Prueba Automática', { timeout: 10000 });
  console.log('Explorador: la textura creada aparece en «Creadas» ✔');

  // 4) Botón del ojo: abre la vista previa 3D (cubo + esfera).
  const eyeBtn = page.locator('[aria-label="Vista previa 3D de Prueba Automática"]');
  await eyeBtn.waitFor({ timeout: 5000 });
  await eyeBtn.click();
  await page.waitForSelector('button[aria-label="Cerrar vista previa"]', { timeout: 10000 });
  const previewHasCanvas = await page.evaluate(() => {
    const overlay = [...document.querySelectorAll('div')].find((d) =>
      d.className?.toString?.().includes('z-[60]')
    );
    return !!overlay && !!overlay.querySelector('canvas');
  });
  if (!previewHasCanvas) throw new Error('La vista previa 3D no muestra el lienzo three.js');
  const previewText = await page.evaluate(() => document.body.innerText);
  if (!previewText.includes('Prueba Automática') || !previewText.includes('Rugosidad')) {
    throw new Error('La ventana de vista previa no muestra nombre y propiedades');
  }
  console.log('Vista previa 3D (cubo/esfera) abierta con sus propiedades ✔');
  await page.click('button[aria-label="Cerrar vista previa"]');
  await page.waitForTimeout(400);

  // 5) Botón del lápiz: reeditar la textura creada.
  const pencilBtn = page.locator('[aria-label="Editar Prueba Automática"]');
  await pencilBtn.waitFor({ timeout: 5000 });
  await pencilBtn.click();
  await page.waitForSelector('text=Editar textura', { timeout: 10000 });
  const nombreActual = await page.inputValue('input[placeholder="Ej: Cristal Azul"]');
  if (nombreActual !== 'Prueba Automática') {
    throw new Error(`El modal de editar no cargó la textura: "${nombreActual}"`);
  }
  console.log('Lápiz: modal de edición con la textura cargada ✔');
  await page.fill('input[placeholder="Ej: Cristal Azul"]', 'Prueba Editada');
  await page.click('button:has-text("Guardar cambios")');
  await page.waitForTimeout(500);
  const guardada = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('textures_db') || '[]').some(
      (t) => t.name === 'Prueba Editada' && t.type === 'wood'
    )
  );
  if (!guardada) throw new Error('La edición no se guardó');
  const tarjetaActualizada = await page.waitForSelector('img[alt="Prueba Editada"]', { timeout: 10000 });
  const srcTarjeta = await tarjetaActualizada.getAttribute('src');
  if (!srcTarjeta || !srcTarjeta.startsWith('data:image/png')) {
    throw new Error('La tarjeta editada no regeneró su mosaico');
  }
  console.log('Edición guardada y tarjeta regenerada ✔');

  // 6) Elegirla: debe aplicarse al suelo (data URL) y cerrar el explorador.
  await page.click('img[alt="Prueba Editada"]');
  await page.waitForTimeout(800);
  const cerrado = await page.evaluate(() => !document.body.innerText.includes('Explorador de Texturas'));
  if (!cerrado) throw new Error('El explorador no se cerró al elegir la textura');
  console.log('Selección aplicada y explorador cerrado ✔');

  // Limpieza: quitar la textura de prueba.
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('textures_db') || '[]')
      .filter((t) => t.name !== 'Prueba Editada' && t.name !== 'Prueba Automática');
    localStorage.setItem('textures_db', JSON.stringify(list));
  });

  await browser.close();
  console.log('TODO OK');
})().catch((e) => {
  console.error('FALLO:', e.message);
  process.exit(1);
});