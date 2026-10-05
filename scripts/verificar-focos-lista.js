/* Verificación DOM: los focos viven en la lista de objetos, con
   conmutador de conexión; la barra superior ya no tiene ni la lista
   «Foco activo» ni el botón «Aro de foco». */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });

  // 1) La barra superior ya no trae la lista de focos ni el aro.
  const topControls = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')].map((s) => s.textContent || '');
    return {
      selectFocos: selects.some((txt) => txt.includes('Foco') && txt.includes('Spotlight') === false),
      textoBarra: (document.querySelector('select')?.textContent ?? ''),
    };
  });
  console.log('Selects de la barra (debe estar vacío de focos):', JSON.stringify(topControls));

  // 2) Crear un foco desde el modal de luces (Acciones → Luces).
  // Abrir el menú con teclado (evita bloqueos del clic por overlays).
  await page.focus('[data-testid="actions-menu-trigger"]');
  await page.keyboard.press('Enter');
  const lucesItem = page.getByRole('menuitem', { name: /Luces|Lights/ });
  await lucesItem.waitFor({ timeout: 5000 });
  await lucesItem.click();
  await page.waitForTimeout(500);
  // Botón de añadir foco dentro del modal.
  const addSpot = await page.$('button:has-text("Añadir foco"), button:has-text("Add spotlight")');
  if (!addSpot) throw new Error('No se encontró el botón de añadir foco');
  await addSpot.click();
  await page.waitForTimeout(300);
  const saveBtn = await page.$('button:has-text("Guardar")');
  if (saveBtn) await saveBtn.click();
  await page.waitForTimeout(500);

  // 3) La fila del foco aparece en la lista de objetos.
  await page.waitForSelector('[data-testid="scene-spotlight-0"]', { timeout: 10000 });
  const filaTexto = (await page.textContent('[data-testid="scene-spotlight-0"]')).trim();
  console.log('Fila del foco:', filaTexto.replace(/\s+/g, ' '));
  const puntoVerde = await page.$('[data-testid="scene-spotlight-0"] .bg-green-400');
  console.log('Punto verde (conectado):', puntoVerde ? 'SÍ' : 'NO');

  // 4) Desconectar: el punto pasa a rojo.
  await page.click('[data-testid="scene-spotlight-toggle-0"]');
  await page.waitForTimeout(300);
  const puntoRojo = await page.$('[data-testid="scene-spotlight-0"] .bg-red-400');
  console.log('Tras desconectar, punto rojo:', puntoRojo ? 'SÍ' : 'NO');
  // Reconectar para dejar el estado limpio.
  await page.click('[data-testid="scene-spotlight-toggle-0"]');
  await page.waitForTimeout(300);

  // 5) Clic en la fila abre el modal de luces.
  await page.click('[data-testid="scene-spotlight-0"]');
  await page.waitForTimeout(500);
  const modal = await page.$('text=Configuración de luces');
  console.log('Clic en fila abre el modal de luces:', modal ? 'SÍ' : 'NO');

  console.log('OK');
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });