import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

/** Etapas con captura de los 4 lienzos para localizar cuándo el 2D pierde el color. */

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };
const DIR = 'e2e/.repro';

async function seedSelectedModel(page: Page) {
  await page.addInitScript((model) => {
    window.localStorage.setItem(
      'main-store',
      JSON.stringify({ state: { user: null, selectedModel: model, selectedVisionModel: null, systemPrompt: '' }, version: 0 }),
    );
  }, MODEL);
  await page.route('**/api/modelos*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) }),
  );
}

async function clickTestId(page: Page, id: string) {
  const pos = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function capturarTodo(page: Page, etiqueta: string) {
  await page.waitForTimeout(500);
  const rects = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')].map((c, i) => {
      const r = c.getBoundingClientRect();
      return { i, w: r.width, h: r.height, x: r.x, y: r.y };
    }).filter((r) => r.w > 100 && r.h > 100);
  });
  mkdirSync(DIR, { recursive: true });
  for (const r of rects) {
    const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
    writeFileSync(`${DIR}/e${etiqueta}-c${r.i}.png`, buf);
  }
  console.log(`[repro] captura ${etiqueta} (${rects.length} lienzos)`);
}

test('repro: etapas de los lienzos', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  page.on('console', (msg) => {
    if (msg.text().includes('[zeus-debug]')) console.log('  ', msg.text());
  });

  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('actions-menu-trigger').click();
  const abrirModal = page.getByTestId('open-obj3d-modal');
  await expect(abrirModal).toBeVisible({ timeout: 10_000 });
  await abrirModal.click();
  const tarjetaCubo = page.locator('[data-testid="obj3d-card-public"]', { hasText: 'Cubo' }).first();
  await expect(tarjetaCubo).toBeVisible({ timeout: 20_000 });
  await tarjetaCubo.click();
  await expect(page.getByTestId('object-primitive-panel')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await capturarTodo(page, '1-cargado');

  await page.locator('[data-testid="scene-figure-color"]').fill('#ff0000');
  await page.waitForTimeout(800);
  await capturarTodo(page, '2-rojo');

  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  // El 3D Libre es el cuarto lienzo.
  await page.mouse.move(995 + 597 / 2, 648 + 244 / 2);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-select-bar')).toContainText(/1 caras seleccionadas/, { timeout: 8_000 });
  await capturarTodo(page, '3-seleccionada');

  await page.getByTestId('face-move-y').fill('0.2');
  await clickTestId(page, 'face-move-apply');
  await page.waitForTimeout(600);
  await capturarTodo(page, '4-movida');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(900);
  await capturarTodo(page, '5-salida');

  // Guardar el .zeus final para ver el estado interno.
  await page.getByTestId('actions-menu-trigger').click();
  const abrirGuardar = page.getByTestId('open-save-modal');
  await expect(abrirGuardar).toBeVisible({ timeout: 10_000 });
  await abrirGuardar.click();
  await expect(page.getByTestId('save-name-input')).toBeVisible({ timeout: 10_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByTestId('save-confirm-btn').click();
  const download = await downloadPromise;
  const guardado = JSON.parse(readFileSync(await download.path()!, 'utf-8'));
  await page.keyboard.press('Escape');
  const mallas = (guardado.sceneObjects as Array<{ mesh?: { faceColors?: string[]; faceTextures?: (string | null)[] } }>)
    .map((o) => o.mesh).filter(Boolean);
  console.log('[repro] estado final:', JSON.stringify(mallas.map((m) => ({
    faceColors: m!.faceColors ? [...new Set(m!.faceColors)] : null,
    faceTextures: m!.faceTextures ? m!.faceTextures.filter(Boolean).length : null,
  }))));
});