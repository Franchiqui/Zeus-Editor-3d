import { test, expect, type Page } from '@playwright/test';

async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

test('explorar controles disponibles', async ({ page }) => {
  await waitForEditor(page);
  // Buscar inputs de texto, sliders, botones y dropdowns visibles.
  const text = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input, button, [role="slider"], select'));
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      const style = window.getComputedStyle(e);
      return {
        tag: e.tagName,
        type: (e as HTMLInputElement).type ?? '',
        text: (e.textContent || '').slice(0, 40).trim(),
        id: e.id || '',
        dataTestId: e.getAttribute('data-testid') || '',
        visible: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    }).filter((e) => e.visible);
  });
  // Solo mostrar inputs y sliders y los botones de deshacer/rehacer/reset
  const interesting = text.filter((e) =>
    e.dataTestId.includes('undo') || e.dataTestId.includes('redo') ||
    e.type === 'range' || e.type === 'text' || e.type === 'number' ||
    e.text.toLowerCase().includes('deshacer') || e.text.toLowerCase().includes('rehacer') ||
    e.text.toLowerCase().includes('reset') || e.text.toLowerCase().includes('escal')
  );
  console.log(JSON.stringify(interesting, null, 2));
  expect(interesting.length).toBeGreaterThan(0);
});