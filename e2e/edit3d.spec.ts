import { test, expect, type Page } from '@playwright/test';

/**
 * Pruebas de UI (Playwright) del editor 3D y del puente ZEIA.
 *
 * Cubren el "pegamento" React que no cubren los tests de Node:
 *   1. La app arranca y monta Editor3D (react-three-fiber → <canvas>).
 *   2. El FloatingChatButton está disponible (montado por AIEditorBridgeProvider).
 *   3. El puente aplica los planes ZEIA que devuelve /api/chat: interceptamos
 *      /api/chat con un payload `zeia.plans`, disparamos el envío por la UI real
 *      y comprobamos que el applier del editor (registrado en Editor3D) recibe el
 *      plan y CREA el objeto (el resumen `created` que loguea FloatingChatButton).
 *   4. CONTROL NEGATIVO: con el mismo flujo pero SIN `zeia.plans`, el puente NO
 *      aplica nada. Garantiza que la aserción del test 3 no es un falso positivo.
 */

/** Espera a que el editor esté montado (canvas de three.js presente). */
async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  // Editor3D se carga con next/dynamic (ssr:false): el canvas aparece tras hidratar.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };

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
  // Sin backend: lista de modelos vacía (así MainNavbar NO limpia el selectedModel sembrado).
  await page.route('**/api/modelos*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) }),
  );
}

/** Abre el chat, escribe y envía un mensaje por la UI real. */
async function sendChat(page: Page, text: string) {
  await page.getByRole('button', { name: 'Abrir chat' }).click();
  const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
  await chatForm.locator('textarea').fill(text);
  await chatForm.getByRole('button', { name: 'Enviar' }).click();
  return chatForm;
}

/** Recoge el resumen que devuelve el applier ZEIA (FloatingChatButton lo loguea). */
function captureZeiaApplies(page: Page): unknown[] {
  const applied: unknown[] = [];
  page.on('console', async (msg) => {
    if (msg.text().includes('Planes ZEIA aplicados a la escena')) {
      try {
        applied.push(await msg.args()[1]?.jsonValue());
      } catch {
        applied.push('(no-json)');
      }
    }
  });
  return applied;
}

test.describe('Editor 3D + puente ZEIA', () => {
  test('la página /edit-3d monta el editor sin errores fatales', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await waitForEditor(page);

    expect(await page.locator('canvas').count()).toBeGreaterThan(0);
    expect(pageErrors, `errores de página:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('el chat flotante está disponible (definido por AIEditorBridgeProvider)', async ({ page }) => {
    await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Abrir chat' })).toBeVisible({ timeout: 30_000 });
  });

  test('el puente ZEIA aplica a la escena los planes devueltos por /api/chat', async ({ page }) => {
    // Plan ZEIA (plan+execute) que el "servidor" devolverá.
    const ZEIA_PLAN = {
      plan_id: 'plan-playwright-1',
      status: 'executed',
      steps: [
        {
          action: 'objects.create',
          params: { id: 'zeia-cube-1', primitive: 'cube', type: 'mesh', name: 'CuboPW', transform: { position: [0, 1, 0] } },
        },
        {
          action: 'motions.create',
          params: { object_id: 'zeia-cube-1', type: 'rotate', duration: 5, degrees: 360 },
        },
      ],
      results: [{ object_id: 'zeia-cube-1' }, { motion_id: 'mot-pw-1' }],
    };

    await seedSelectedModel(page);
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: 'He añadido un cubo que gira.',
          conversationId: 'pw-conv',
          zeia: { plans: [ZEIA_PLAN] },
        }),
      });
    });
    const applied = captureZeiaApplies(page);

    await waitForEditor(page);
    await sendChat(page, 'añade un cubo que gira');

    // El puente debió aplicar el plan y crear el objeto (+ su animación).
    await expect.poll(() => applied.length, { timeout: 20_000 }).toBeGreaterThan(0);
    const summary = applied[0] as { applied?: number; created?: number; motions?: number } | undefined;
    expect(summary, `resumen inesperado: ${JSON.stringify(applied)}`).toBeTruthy();
    expect(summary!.created ?? 0).toBeGreaterThanOrEqual(1);
    expect(summary!.motions ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('CONTROL NEGATIVO: sin zeia.plans el puente NO aplica nada', async ({ page }) => {
    await seedSelectedModel(page);
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Solo texto, sin plan.', conversationId: 'pw-conv-2' }),
      });
    });
    const applied = captureZeiaApplies(page);

    await waitForEditor(page);
    await sendChat(page, 'solo dime hola');

    // El envío SÍ ocurrió (aparece la respuesta del asistente)…
    await expect(page.getByText('Solo texto, sin plan.', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    // …pero como no hay planes ZEIA, el applier nunca se invoca.
    expect(applied.length).toBe(0);
  });
});
