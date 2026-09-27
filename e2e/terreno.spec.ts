import { test, expect, type Page } from '@playwright/test';

/**
 * Prueba del parámetro "Montañas" en el Generador de montañas.
 *
 * 1. Abre el modal de Plugins.
 * 2. Elige "Generador de montañas".
 * 3. Ajusta el slider "Montañas" a 8.
 * 4. Aplica como objeto nuevo.
 * 5. Verifica que el undo se habilita.
 * 6. Deshace y verifica que el objeto desaparece.
 * 7. Rehace y verifica que el objeto vuelve.
 */
async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('Generador de montañas', () => {
  test('el slider Montañas está disponible y responde', async ({ page }) => {
    await waitForEditor(page);

    // Abrir el menú de Acciones y luego el modal de Plugins.
    await page.getByTestId('actions-menu-trigger').click();
    await page.getByTestId('open-plugins-modal').click();
    await expect(page.getByText(/Generador de montañas/i).first()).toBeVisible({ timeout: 10_000 });

    // Elegir el plugin en la lista.
    await page.getByText(/Generador de montañas/i).first().click();

    // El slider "Montañas" debe aparecer (etiqueta + valor).
    const montanasSlider = page.locator('input[type="range"]').filter({
      has: page.locator('..').locator(`text=Montañas`),
    });
    await expect(montanasSlider.first()).toBeVisible({ timeout: 10_000 });

    // Valor inicial 0.
    await expect(montanasSlider.first()).toHaveValue('0');

    // Moverlo a 8.
    await montanasSlider.first().fill('8');
    await expect(montanasSlider.first()).toHaveValue('8');

    // Moverlo a 12.
    await montanasSlider.first().fill('12');
    await expect(montanasSlider.first()).toHaveValue('12');

    // Volver a 0.
    await montanasSlider.first().fill('0');
    await expect(montanasSlider.first()).toHaveValue('0');
  });

  test('aplicar Generador de montañas crea objeto y el undo lo deshace', async ({ page }) => {
    await waitForEditor(page);

    const undoBtn = page.getByTestId('undo-btn');
    const redoBtn = page.getByTestId('redo-btn');

    // Al inicio: sin historial.
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Contar objetos antes.
    const countBefore = await page.locator('[data-testid^="scene-object-"]').count();

    // Abrir Plugins y aplicar Generador de montañas como objeto nuevo.
    await page.getByTestId('actions-menu-trigger').click();
    await page.getByTestId('open-plugins-modal').click();
    await page.getByText(/Generador de montañas/i).first().click();

    // Ajustar Montañas a 8.
    const montanasSlider = page.locator('input[type="range"]').filter({
      has: page.locator('..').locator(`text=Montañas`),
    });
    await expect(montanasSlider.first()).toBeVisible({ timeout: 10_000 });
    await montanasSlider.first().fill('8');

    // Aplicar.
    await page.getByRole('button', { name: /Aplicar|Apply/i }).click();

    // Debe crearse un objeto nuevo.
    await expect.poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 15_000 })
      .toBe(countBefore + 1);

    // El undo debe estar habilitado.
    await expect(undoBtn).toBeEnabled({ timeout: 5_000 });

    // Deshacer: el objeto debe desaparecer.
    await undoBtn.click();
    await expect.poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 10_000 })
      .toBe(countBefore);

    // Rehacer: el objeto vuelve.
    await expect(redoBtn).toBeEnabled({ timeout: 5_000 });
    await redoBtn.click();
    await expect.poll(async () => page.locator('[data-testid^="scene-object-"]').count(), { timeout: 10_000 })
      .toBe(countBefore + 1);
  });
});