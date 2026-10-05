import { abrirEditor, esperar, clicTab, escribirTexto, medirFrontal } from './comun.mjs';

const { browser, page, errores } = await abrirEditor();
try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);
  await page.click('[data-testid="scene-object-1"]');
  await esperar(900);
  await page.fill('[data-testid="object-pos-x"]', '2.5');
  await esperar(900);
  await page.click('[data-testid="scene-object-0"]');
  await esperar(1200);
  const medir = async (et) => {
    const m = await medirFrontal(page);
    console.log(et + ': tinta=' + (m ? m.tinta : null));
    return m ? m.tinta : 0;
  };
  await medir('base');
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(600);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(800);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2200);
  const ambos = await medir('ambos con fuego (antes de guardar)');

  // Guardar y REABRIR.
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag-fx-visible');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) { console.log('sin descarga'); } else {
  await dl.saveAs('diag-fx-visible.zeus');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
  await esperar(1500);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles('[data-testid="zeus-file-input"]', 'diag-fx-visible.zeus');
  await esperar(4500);
  for (let i = 0; i < 6; i++) {
    await medir('reabierto t=' + (i * 2) + 's');
    await esperar(2000);
  }
  }
} finally {
  await browser.close();
}
