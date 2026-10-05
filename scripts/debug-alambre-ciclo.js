// Prueba el ciclo del modo caras: activar (alambre ON) y desactivar (alambre OFF).
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const estadoAlambre = async () => {
    return page.evaluate(() => {
      const btn = document.querySelector('button[title*="Vista de alambre"]');
      if (!btn) return null;
      // ToggleButton activo: comprobar la clase (active suele cambiar fondo).
      return { clase: btn.className, ariaPressed: btn.getAttribute('aria-pressed') };
    });
  };
  const activo = (e) => e ? /bg-green|active|bg-\[|emerald|cyan/.test(e.clase) || e.ariaPressed === 'true' : null;

  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  const e1 = await estadoAlambre();
  console.log('Modo caras ACTIVADO  -> alambre:', JSON.stringify(e1), 'activo:', activo(e1));

  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  const e2 = await estadoAlambre();
  console.log('Modo caras APAGADO   -> alambre:', JSON.stringify(e2), 'activo:', activo(e2));

  // Y reactivar para comprobar que vuelve a encenderse.
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(1500);
  const e3 = await estadoAlambre();
  console.log('Modo caras REACTIVADO-> alambre:', JSON.stringify(e3), 'activo:', activo(e3));

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });