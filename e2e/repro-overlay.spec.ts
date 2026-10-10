import { test, expect, type Page } from '@playwright/test';

/** ¿ Qué pinta el cuadrado blanco de la ventana 2D tras salir del modo caras ?
 *  En e5 evaluamos elementFromPoint en el centro del lienzo Frente (2D) y
 *  del 3D, listando TODO lo que hay en ese punto (candidatos: overlay HTML).
 */

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };

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

test('repro: qué elemento pinta el blanco en la ventana 2D', async ({ page }) => {
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

  await page.locator('[data-testid="scene-figure-color"]').fill('#ff0000');
  await page.waitForTimeout(800);

  // Pilar: sondear elementos en el centro del lienzo c0 (Frente) y c3 (3D).
  const sondearVariasVentanas = async (etiqueta: string) => {
    const respuesta = await page.evaluate((_) => {
      const sondeo = (rect: { x: number; y: number; w: number; h: number }) => {
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        const apilados: string[] = [];
        // elementsFromPoint da TODO lo apilado en ese punto.
        for (const el of document.elementsFromPoint(cx, cy)) {
          const e = el as HTMLElement;
          const clase = (e.className && typeof e.className === 'string') ? e.className.slice(0, 70) : (e.constructor?.name ?? '');
          const testid = (e as HTMLElement).dataset?.testid ?? (e.parentElement as HTMLElement | null)?.dataset?.testid ?? '';
          const fondo = e instanceof HTMLElement ? getComputedStyle(e).backgroundColor : '';
          apilados.push(`${e.tagName.toLowerCase()}${testid ? `[${testid}]` : ''} ${clase} bg=${fondo}`);
        }
        return { cx, cy, apilados };
      };
      const lienzos = [...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }).filter((r) => r.w > 100 && r.h > 100);
      return { frente: lienzos[0] ? sondeo(lienzos[0]) : null, tresd: lienzos[3] ? sondeo(lienzos[3]) : null };
    });
    console.log(`[repro][${etiqueta}] frente:`, JSON.stringify(respuesta.frente, null, 1));
  };

  await sondearVariasVentanas('cargado');

  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(995 + 597 / 2, 648 + 244 / 2);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-select-bar')).toContainText(/1 caras seleccionadas/, { timeout: 8_000 });

  await sondearVariasVentanas('seleccionada');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(900);

  await sondearVariasVentanas('salida');
});