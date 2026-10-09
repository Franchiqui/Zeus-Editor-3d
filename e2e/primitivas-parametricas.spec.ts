import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: panel de propiedades de primitiva (pestaña Escena).
 *
 * 1. Cargar «Cubo» desde el modal «Objeto 3D» (galería public/Obj-3D).
 * 2. El objeto llega seleccionado y con `primitiveParams` → aparece el
 *    panel `object-primitive-panel` bajo el de transformación.
 * 3. Editar «Segmentos X» a 4: el valor persiste (la malla se regenera
 *    con cada commit del NumberInput) y la consola no registra errores.
 *
 * La corrección geométrica de los 10 builders (radios por nivel, bbox,
 * triángulos, winding, idempotencia, argolla del disco) la valida
 * numéricamente scripts/verificar-3d/verificar-primitivas-parametricas.mjs
 * — este e2e solo comprueba el cableado del panel en el navegador real.
 */

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };

async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

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

test('propiedades de primitiva: cargar Cubo de la galería y editar segmentos', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const erroresConsola: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') erroresConsola.push(msg.text());
  });
  page.on('pageerror', (err) => erroresConsola.push(String(err)));

  await waitForEditor(page);

  // Abrir el modal «Objeto 3D»: primero el menú «Acciones» y dentro el
  // ítem que abre el modal (es un DropdownMenuItem de Radix).
  const abrirMenu = page.getByTestId('actions-menu-trigger');
  await expect(abrirMenu).toBeVisible({ timeout: 30_000 });
  await abrirMenu.click();
  const abrirModal = page.getByTestId('open-obj3d-modal');
  await expect(abrirModal).toBeVisible({ timeout: 10_000 });
  await abrirModal.click();
  const tarjetaCubo = page
    .locator('[data-testid="obj3d-card-public"]', { hasText: 'Cubo' })
    .first();
  await expect(tarjetaCubo).toBeVisible({ timeout: 20_000 });
  await tarjetaCubo.click();

  // La escena recibe el objeto y, por tener `primitiveParams`, aparece
  // el panel de propiedades de la primitiva.
  const panel = page.getByTestId('object-primitive-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toContainText('Segmentos X');

  // Editar «Segmentos X» a 4. La malla se regenera con cada commit.
  const campoSegX = page.getByTestId('primitive-param-segX');
  await expect(campoSegX).toBeVisible({ timeout: 10_000 });
  await campoSegX.fill('4');
  await campoSegX.blur();
  await expect(campoSegX).toHaveValue(/^4/, { timeout: 10_000 });

  // El panel sigue ahí tras la regeneración (el objeto no se rompió)
  await expect(panel).toBeVisible();

  // Sin errores de consola durante todo el flujo (se toleran avisos del
  // propio stack, no errores).
  expect(
    erroresConsola.filter((e) => !/favicon|ResizeObserver|Download the React DevTools/i.test(e)),
    `errores de consola: ${erroresConsola.join(' | ')}`
  ).toEqual([]);
});