import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/** REPRO acortado: hasta la etapa «tras salir del modo», capturando TODOS los lienzos. */

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

async function descargarZeus(page: Page): Promise<Record<string, unknown>> {
  await page.keyboard.press('Escape');
  await page.getByTestId('actions-menu-trigger').click();
  const abrirGuardar = page.getByTestId('open-save-modal');
  await expect(abrirGuardar).toBeVisible({ timeout: 10_000 });
  await abrirGuardar.click();
  const input = page.getByTestId('save-name-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByTestId('save-confirm-btn').click();
  const download = await downloadPromise;
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(await download.path()!);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  return JSON.parse(bytes.toString('utf-8'));
}

test('repro corto: identificar qué lienzo sale blanco', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);
  mkdirSync(DIR, { recursive: true });

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

  await page.locator('[data-testid="scene-figure-color"]').fill('#ff0000');
  await page.waitForTimeout(800);

  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  // Clic en el centro del LIENZO 3D (el segundo canvas de la lista: la ventana Frente es la que muestra los cuadrados 2D).
  const rects = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, y: r.y, id: c.id, cls: c.className.slice(0, 40), padre: (c.parentElement?.className ?? '').slice(0, 60) };
    }).filter((r) => r.w > 100 && r.h > 100);
  });
  console.log('[canvas] lista:', JSON.stringify(rects));
  // Clic en el centro del canvas 3D Libre (el último normalmente).
  const tresd = rects[rects.length - 1] ?? rects[0];
  await page.mouse.move(tresd.x + tresd.w / 2, tresd.y + tresd.h / 2);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-select-bar')).toContainText(/1 caras seleccionadas/, { timeout: 8_000 });
  await page.getByTestId('face-move-y').fill('0.2');
  await clickTestId(page, 'face-move-apply');
  await page.waitForTimeout(500);

  const guardadoConSel = await descargarZeus(page);
  console.log('[repro] con cara seleccionada (malla):', JSON.stringify({
    caras: ((guardadoConSel.sceneObjects as any[])[0].mesh.faces as unknown[]).length,
    faceColors: (guardadoConSel.sceneObjects as any[])[0].mesh.faceColors ?? undefined,
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(900);

  // Capturar TODOS los lienzos con etiqueta.
  const rects2 = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')].map((c, i) => {
      const r = c.getBoundingClientRect();
      return { i, w: r.width, h: r.height, x: r.x, y: r.y };
    }).filter((r) => r.w > 100 && r.h > 100);
  });
  for (const r of rects2) {
    const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
    writeFileSync(`${DIR}/todo-${r.i}-${Math.round(r.w)}x${Math.round(r.h)}.png`, buf);
  }
  console.log('[repro] lienzos totales:', rects2.length);
});