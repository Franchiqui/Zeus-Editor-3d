import { test, expect, type Page } from '@playwright/test';

/**
 * Pruebas del modal «Copias calculadas» (menú Acciones del editor 3D).
 *
 * 1. Se crea un objeto ligero (cubo) en la escena vía el puente ZEIA.
 * 2. Se abre el modal desde el menú y se crean 5 copias en línea recta.
 * 3. Se abren de nuevo copias en círculo (4) y se comprueba el total.
 * 4. El undo deshace el último lote.
 */

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };

/** Espera a que el editor esté montado (canvas de three.js presente). */
async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

/**
 * Clic real por coordenadas. El visor 3D renderiza en bucle continuo y el
 * re-render frecuente de la lista de escena desincroniza la maquinaria de
 * locators de Playwright (cajas que "nunca estabilizan"): medimos el rect
 * en el main thread con querySelector y enviamos el clic por CDP.
 */
async function clicSel(
  page: Page,
  selector: string,
  opts: { nth?: number; espera?: number } = {}
) {
  const pos = await page.evaluate(
    ({ selector, nth }) => {
      const items = document.querySelectorAll(selector);
      const el = (nth === -1 ? items[items.length - 1] : items[nth]) as
        | HTMLElement
        | undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, nth: opts.nth ?? -1 }
  );
  if (!pos) throw new Error(`sin elemento: ${selector}`);
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.up();
  if (opts.espera) await page.waitForTimeout(opts.espera);
}

/** Sin modelo seleccionado el chat no llama a /api/chat: lo sembramos antes de cargar la app. */
async function seedSelectedModel(page: Page) {
  await page.addInitScript((model) => {
    window.localStorage.setItem(
      'main-store',
      JSON.stringify({
        state: { user: null, selectedModel: model, selectedVisionModel: null, systemPrompt: '' },
        version: 0,
      }),
    );
  }, MODEL);
  await page.route('**/api/modelos*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) }),
  );
}

/**
 * Crea un objeto ligero (cubo) en la escena devolviendo un plan ZEIA fijo
 * desde /api/chat: la malla del cubo es mínima y no satura el render
 * headless como sí haría el terreno de montañas.
 */
async function crearObjetoSemilla(page: Page): Promise<number> {
  // El plan se aplica en cuanto llega la respuesta: contar ANTES de enviar.
  const countBefore = await page.locator('[data-testid^="scene-object-"]').count();
  const ZEIA_PLAN = {
    plan_id: 'plan-copias-semilla',
    status: 'executed',
    steps: [
      {
        action: 'objects.create',
        params: { id: 'zeia-cubo', primitive: 'cube', type: 'mesh', name: 'CuboPW', transform: { position: [0, 1, 0] } },
      },
    ],
    results: [{ object_id: 'zeia-cubo' }],
  };
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: 'He añadido un cubo.',
        conversationId: 'pw-conv',
        zeia: { plans: [ZEIA_PLAN] },
      }),
    });
  });

  await page.getByRole('button', { name: 'Abrir chat' }).click();
  const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
  await chatForm.locator('textarea').fill('añade un cubo');
  await chatForm.getByRole('button', { name: 'Enviar' }).click();

  await expect
    .poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 20_000 })
    .toBe(countBefore + 1);

  // El objeto creado por el plan no queda seleccionado: se elige en la
  // lista de la escena (el modal de copias opera sobre el seleccionado).
  await clicSel(page, '[data-testid^="scene-object-"]');

  // Cierra el chat flotante para liberar la vista.
  await page.keyboard.press('Escape');
  return countBefore;
}

/** Abre el menú de Acciones y dentro el modal de copias calculadas. */
async function abrirModalCopias(page: Page) {
  // El menú de Radix abre con el primer clic; el ítem pertenece al menú.
  for (let intento = 0; intento < 4; intento++) {
    await clicSel(page, '[data-testid="actions-menu-trigger"]');
    await page.waitForTimeout(600);
    if ((await page.getByTestId('open-calculated-copies-modal').count()) > 0) break;
  }
  await clicSel(page, '[data-testid="open-calculated-copies-modal"]', { espera: 600 });
  await expect(page.getByTestId('calc-copies-create')).toBeVisible();
}

test.describe('Copias calculadas', () => {
  test.beforeEach(({ page }) => {
    seedSelectedModel(page);
  });

  test('el modal abre desde el menú de Acciones y crea copias en línea y en círculo', async ({
    page,
  }) => {
    await waitForEditor(page);
    const countBefore = await crearObjetoSemilla(page);

    // Por defecto: 5 copias en línea recta. Crearlas.
    await abrirModalCopias(page);
    await clicSel(page, '[data-testid="calc-copies-create"]', { espera: 1500 });
    await expect(page.getByTestId('calc-copies-create')).toBeHidden();
    await expect
      .poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 15_000 })
      .toBe(countBefore + 5 + 1);

    // Las copias quedan seleccionadas y aparecen en la lista de escena.
    await expect(page.getByText(/Copia 1 de /i).first()).toBeVisible({ timeout: 10_000 });

    // Nuevo lote en círculo: reabrir, elegir círculo, 4 copias.
    await abrirModalCopias(page);
    await clicSel(page, '[data-testid="calc-copies-layout-circulo"]');
    const countInput = page.getByLabel(/Cantidad de copias|Number of copies/i);
    await countInput.fill('4');
    await clicSel(page, '[data-testid="calc-copies-create"]', { espera: 1500 });
    await expect(page.getByTestId('calc-copies-create')).toBeHidden();
    await expect
      .poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 15_000 })
      .toBe(countBefore + 9 + 1);
  });

  test('el undo deshace el último lote de copias', async ({ page }) => {
    await waitForEditor(page);
    const countBefore = await crearObjetoSemilla(page);

    await abrirModalCopias(page);
    await clicSel(page, '[data-testid="calc-copies-create"]', { espera: 1500 });
    await expect
      .poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 15_000 })
      .toBe(countBefore + 6);

    const undoBtn = page.getByTestId('undo-btn');
    await expect(undoBtn).toBeEnabled({ timeout: 5_000 });
    await undoBtn.click();
    await expect
      .poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 15_000 })
      .toBe(countBefore + 1);
  });
});