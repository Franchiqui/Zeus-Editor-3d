/* Prueba del material de una textura CREADA aplicada (cristal):
   1) Importa una esfera (esfera.zeus, modal «Objeto 3D») para tener un
      objeto en escena y seleccionado.
   2) Con la textura creada «Cristal Azul» (glass, opacidad 0.45):
      - captura la vista previa 3D (preview.png)
      - la aplica al OBJETO por el panel de texturas (objeto.png)
      - la aplica al SUELO (suelo-cristal.png)
   Las capturas quedan en scripts/salidas/. */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

/* Clic crudo de ratón (page.click a veces se queda colgado en
   «performing click action» con el lienzo 3D animándose debajo). */
async function clicCrudo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Elemento sin caja: no se puede cliquear');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
}

/* El explorador SE CIERRA SOLO al elegir una textura (handleSelectTexture
   llama a onClose); este cierre es solo una red de seguridad. */
async function cerrarModalSiAbierto(page) {
  const closeBtn = page.locator('[aria-label="Close modal"]').first();
  if ((await closeBtn.count()) === 0) {
    console.log('Modal ya cerrado (se cierra solo al elegir)');
    return;
  }
  const box = await closeBtn.boundingBox({ timeout: 3000 }).catch(() => null);
  if (!box) return;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}

(async () => {
  const outDir = path.join(__dirname, 'salidas');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  globalThis.__pagina = page;
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });

  // Limpieza: solo nuestra textura de prueba en 'textures_db'.
  await page.evaluate(() => {
    localStorage.setItem('textures_db', JSON.stringify([
      { id: 'prueba-cristal', name: 'Cristal Azul', type: 'glass', color: '#6aa9ff', opacity: 0.45, roughness: 0.1 }
    ]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });

  // 0) Objeto en escena: modal «Objeto 3D» → subir esfera.zeus.
  await page.click('[data-testid="actions-menu-trigger"]');
  const obj3dItem = page.locator('[data-testid="open-obj3d-modal"]');
  await obj3dItem.waitFor({ timeout: 5000 });
  await obj3dItem.click();
  const zeusInput = page.locator('[data-testid="zeus-file-input"]');
  await zeusInput.waitFor({ timeout: 15000, state: 'attached' });
  // El input está oculto (class hidden): usar el botón que lo abre con
  // un FileChooser real.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Seleccionar archivo .zeus")'),
  ]);
  await chooser.setFiles(path.join(__dirname, 'esfera.zeus'));
  await page.waitForTimeout(1500);

  // Diagnóstico: ¿quién intercepta los clics en el disparador del menú?
  const diagnostico = await page.evaluate(() => {
    const trigger = document.querySelector('[data-testid="actions-menu-trigger"]');
    const r = trigger?.getBoundingClientRect();
    const centro = r
      ? [r.left + r.width / 2, r.top + r.height / 2]
      : [0, 0];
    const who = document.elementFromPoint(centro[0], centro[1]);
    return {
      bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
      triggerVisible: !!r && r.width > 0,
      intercepta: who
        ? {
            tag: who.tagName,
            texto: (who.textContent || '').slice(0, 60),
            pe: getComputedStyle(who).pointerEvents,
          }
        : null,
      modalesAbiertos: [...document.querySelectorAll('[data-state="open"], [role="dialog"]')].map(
        (d) => d.tagName + '.' + String(d.className).slice(0, 40)
      ),
    };
  });
  console.log('Diagnóstico tras importar:', JSON.stringify(diagnostico, null, 2));
  if (diagnostico.intercepta && diagnostico.intercepta.tag !== 'BUTTON') {
    console.log('El disparador está bloqueado — clic fuera y reintento');
    await page.mouse.click(20, 450);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(outDir, 'base.png') });

  // Reutilizable: abrir un explorador y aplicar «Cristal Azul».
  async function aplicarCristal(comoAbrir) {
    await comoAbrir();
    const dialogoX = page.locator('[role="dialog"]:has-text("Explorador de Texturas")');
    await dialogoX.first().waitFor({ timeout: 10000 });
    await clicCrudo(page, page.locator('img[alt="Cristal Azul"]').first());
    await page.waitForTimeout(2500);
    await cerrarModalSiAbierto(page);
    await page.waitForTimeout(1500);
  }

  // 1) Al OBJETO: explorador del panel (la esfera quedó seleccionada).
  await aplicarCristal(async () => {
    const browseBtn = page.locator('[data-testid="scene-texture-browse"]');
    await browseBtn.waitFor({ timeout: 8000 });
    await clicCrudo(page, browseBtn);
    await page.waitForTimeout(1200);
  });
  await page.screenshot({ path: path.join(outDir, 'objeto.png') });
  console.log('Captura objeto.png');

  // 2) Al SUELO: menú Acciones → «Textura del suelo». El clic con
  //    page.click se queda colgado en «performing click action» tras la
  //    importación: clic de ratón crudo en el centro del menúitem.
  await aplicarCristal(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const triggerBox = await page
      .locator('[data-testid="actions-menu-trigger"]')
      .boundingBox();
    if (!triggerBox) throw new Error('No hay disparador del menú Acciones');
    await page.mouse.click(
      triggerBox.x + triggerBox.width / 2,
      triggerBox.y + triggerBox.height / 2
    );
    await page.waitForTimeout(600);
    const sueloItem = page.getByRole('menuitem', { name: /Textura del suelo|Ground texture/ });
    await sueloItem.waitFor({ timeout: 8000 });
    // A veces el clic crudo no dispara onSelect del menú Radix: reintentar.
    const dialogo2 = page.locator('[role="dialog"]:has-text("Explorador de Texturas")');
    for (let intento = 0; intento < 4; intento++) {
      await clicCrudo(page, sueloItem);
      await page.waitForTimeout(1500);
      if ((await dialogo2.count()) > 0) break;
      await page.mouse.click(20, 450);
      await page.waitForTimeout(600);
      const tb2 = await page.locator('[data-testid="actions-menu-trigger"]').boundingBox();
      if (tb2) {
        await page.mouse.click(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2);
        await page.waitForTimeout(800);
      }
    }
  });
  await page.screenshot({ path: path.join(outDir, 'suelo-cristal.png') });
  console.log('Captura suelo-cristal.png');

  // 3) Vista previa 3D (la misma escena que la app de origen), al final
  //    para que una flaqueza de este paso no estropee las capturas clave.
  {
    await page.evaluate(() => window.scrollTo(0, 0));
    const triggerBox = await page
      .locator('[data-testid="actions-menu-trigger"]')
      .boundingBox();
    if (triggerBox) {
      await page.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
      await page.waitForTimeout(600);
    }
    const sueloItem = page.getByRole('menuitem', { name: /Textura del suelo|Ground texture/ });
    await sueloItem.waitFor({ timeout: 8000 });
    await clicCrudo(page, sueloItem);
    await page.waitForTimeout(1500);
    const eyeBtn = page.locator('[aria-label="Vista previa 3D de Cristal Azul"]');
    await eyeBtn.waitFor({ timeout: 8000 });
    await eyeBtn.dispatchEvent('click');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, 'preview.png') });
    console.log('Captura preview.png');
  }

  await browser.close();
  console.log('TODO OK (capturas en scripts/salidas)');
})().catch(async (e) => {
  console.error('FALLO:', e.message);
  try {
    const page_ = globalThis.__pagina;
    if (page_) {
      await page_.screenshot({ path: path.join(__dirname, 'salidas', 'fallo.png') });
      const diagnostico = await page_.evaluate(() => ({
        db: localStorage.getItem('textures_db'),
        dialogos: [...document.querySelectorAll('[role="dialog"]')].map(
          (d) => (d.textContent || '').slice(0, 120)
        ),
      }));
      console.log('Diagnóstico de fallo:', JSON.stringify(diagnostico, null, 2));
    }
  } catch (_) {}
  process.exit(1);
});