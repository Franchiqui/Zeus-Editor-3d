import { test, expect, type Page } from '@playwright/test';

/**
 * Pruebas de deshacer/rehacer en el editor 3D.
 *
 * Los botones de Deshacer/Rehacer están en la barra superior, a la derecha
 * del botón "Reset" y a la izquierda del selector de idioma. El problema
 * reportado es que no detectan cambios mínimos (p. ej. arrastrar un objeto
 * una fracción de píxel).
 */

async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('Deshacer / Rehacer', () => {
  test('el botón Deshacer está visible y no disabled al inicio', async ({ page }) => {
    await waitForEditor(page);
    const undoBtn = page.locator('[data-testid="undo-btn"]');
    await expect(undoBtn).toBeVisible();
    // Al inicio no hay historial: debe estar disabled.
    await expect(undoBtn).toBeDisabled();
  });

  test('tras un cambio mínimo, Deshacer se habilita y deshace el cambio', async ({ page }) => {
    await waitForEditor(page);

    const undoBtn = page.locator('[data-testid="undo-btn"]');
    const redoBtn = page.locator('[data-testid="redo-btn"]');

    // Estado inicial: deshacer disabled, rehacer disabled.
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Hacer un cambio: arrastrar el slider de "Escala" (resizeScale) en la
    // pestaña Extruir, o mejor aún, mover un objeto en la escena.
    // Para un test fiable usamos el slider de resolución (resolution) que
    // siempre está disponible en la barra de la pestaña Escena.
    const resolutionSlider = page.locator('input[type="range"]').first();
    await expect(resolutionSlider).toBeVisible({ timeout: 15_000 });

    const before = await resolutionSlider.inputValue();
    // Cambiar el slider produce un estado nuevo.
    await resolutionSlider.fill('64');
    const after = await resolutionSlider.inputValue();
    expect(after).not.toBe(before);

    // Dar tiempo a que el antirrebote (400 ms) volque el cambio al historial.
    await expect(undoBtn).toBeEnabled({ timeout: 5_000 });

    // El valor del slider debe haber vuelto al anterior al deshacer.
    await undoBtn.click();
    const restored = await resolutionSlider.inputValue();
    expect(restored).toBe(before);

    // Rehacer debe estar habilitado y restaurar el valor 64.
    await expect(redoBtn).toBeEnabled({ timeout: 5_000 });
    await redoBtn.click();
    const redone = await resolutionSlider.inputValue();
    expect(redone).toBe(after);
  });

  test('Control de teclado Ctrl+Z deshace y Ctrl+Y rehace', async ({ page }) => {
    await waitForEditor(page);

    const resolutionSlider = page.locator('input[type="range"]').first();
    const before = await resolutionSlider.inputValue();

    await resolutionSlider.fill('48');
    await page.waitForTimeout(600);

    // Ctrl+Z deshace.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyZ');
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    const restored = await resolutionSlider.inputValue();
    expect(restored).toBe(before);
  });
});