import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: modo ANILLOS (botón «Anillos» en la face-select-bar, junto a
 * Mover/Extrudir).
 *
 * 1. Crear un cubo y seleccionarlo en la escena.
 * 2. «Polígono» entra al modo de sub-selección (objetivo caras).
 * 3. Con Anillos activo, clic en la cara del cubo selecciona el ANILLO
 *    COMPLETO: en el cubo vivo (6 caras quad) el cinturón = 4 caras
 *    (contador «4 caras seleccionadas»).
 * 4. Con Anillos apagado, la misma cara selecciona solo ella (1 quad =
 *    «1 caras seleccionadas») — el comportamiento clásico.
 *
 * La topología de TRIÁNGULOS pareados (objetos .zeus: esfera, toroide…)
 * se valida numéricamente en scripts/verificar-3d/probar-anillos.mjs;
 * las primitivas vivas llegan cuadranguladas y cada quad es una celda.
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

async function contarObjetosEscena(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cont = document.querySelector('[data-testid="scene-object-list"]');
    if (!cont) return -1;
    const rows = cont.querySelectorAll('[data-testid^="scene-object-"]');
    return rows.length;
  });
}

async function canvasCentro(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const cvs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    let mejor: HTMLCanvasElement | null = null;
    let mejorArea = 0;
    for (const c of cvs) {
      const r = c.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      if (r.width * r.height > mejorArea) { mejorArea = r.width * r.height; mejor = c; }
    }
    if (!mejor) return null;
    const r = mejor.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

async function clickBoton(page: Page, id: string) {
  const pos = await page.evaluate((tid) => {
    const el = (document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null) ??
      Array.from(document.querySelectorAll(`[data-testid="${tid}"]`)).find((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }) as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

test('modo anillos: la cara se agrupa en anillo completo al clic', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-anillos',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: { id: 'zeia-cubo-anillos', primitive: 'cube', type: 'mesh', name: 'Cubo', transform: { position: [0, 0, 0] } },
    }],
    results: [{ object_id: 'zeia-cubo-anillos' }],
  };
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'ok', conversationId: 'pw-conv', zeia: { plans: [ZEIA_PLAN] } }),
    });
  });

  await waitForEditor(page);

  const crearCuboSiFalta = async (): Promise<void> => {
    if ((await contarObjetosEscena(page)) >= 1) return;
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir chat' }).click();
    const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
    await chatForm.locator('textarea').fill('crea un cubo');
    await chatForm.getByRole('button', { name: 'Enviar' }).click();
    await expect
      .poll(async () => (await contarObjetosEscena(page)) >= 1, { timeout: 30_000 })
      .toBe(true);
    await page.keyboard.press('Escape');
  };
  await crearCuboSiFalta();

  const seleccionarFila = async (): Promise<void> => {
    const botonesActivos = async (): Promise<boolean> =>
      page.evaluate(() => {
        const btn = document.querySelector('[data-testid="subselect-cara"]') as HTMLButtonElement | null;
        return !!btn && !btn.disabled;
      });
    for (let intento = 0; (await botonesActivos()) !== true && intento < 4; intento++) {
      const posFila = await page.evaluate(() => {
        const cont = document.querySelector('[data-testid="scene-object-list"]');
        if (!cont) return null;
        const filas = Array.from(cont.querySelectorAll('[data-testid^="scene-object-"]')) as HTMLElement[];
        for (const fila of filas) {
          const r = fila.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          fila.scrollIntoView({ block: 'center' });
          return {
            x: fila.getBoundingClientRect().x + fila.getBoundingClientRect().width * 0.3,
            y: fila.getBoundingClientRect().y + fila.getBoundingClientRect().height / 2,
          };
        }
        return null;
      });
      if (posFila) {
        await page.mouse.move(posFila.x, posFila.y);
        await page.mouse.down();
        await page.waitForTimeout(120);
        await page.mouse.up();
      }
      await page.waitForTimeout(800);
    }
    await expect.poll(botonesActivos, { timeout: 15_000 }).toBe(true);
  };
  await seleccionarFila();

  const modoActivo = async (tid: string): Promise<boolean> =>
    page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-activo') === '1', tid);
  const asegurarModo = async (tid: string): Promise<void> => {
    if (!(await modoActivo(tid))) {
      await crearCuboSiFalta();
      await seleccionarFila();
      if (!(await modoActivo(tid))) await clickBoton(page, tid);
    }
    await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  };

  await asegurarModo('subselect-cara');
  await page.waitForTimeout(300);

  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();

  // Con ANILLOS ACTIVO: la cara del cubo se agrupa en el anillo completo
  // (el cinturón del cubo = 4 caras quad).
  await clickBoton(page, 'sel-anillos-btn');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelector('[data-testid="sel-anillos-btn"]')?.getAttribute('class') ?? ''
        ),
      { timeout: 5_000 }
    )
    .toContain('bg-cyan-500/20');
  await page.waitForTimeout(300);
  for (let intento = 0; intento < 3; intento++) {
    await page.mouse.move(centro!.x, centro!.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.mouse.up();
    try {
      await expect(page.getByTestId('face-select-bar')).toContainText(/4 caras seleccionadas/, {
        timeout: 6_000,
      });
      break;
    } catch {
      // Reintento (la vista puede haber recargado por Fast Refresh).
    }
  }
  // Si hubo intento fallido, el último check decide:
  await expect(page.getByTestId('face-select-bar')).toContainText(/4 caras seleccionadas/, {
    timeout: 6_000,
  });

  // Limpiar y APAGAR anillos: la misma cara vuelve a seleccionarse sola
  // (1 quad).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickBoton(page, 'sel-anillos-btn');
  await page.waitForTimeout(300);
  await page.mouse.move(centro!.x, centro!.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-select-bar')).toContainText(/1 caras seleccionadas/, {
    timeout: 6_000,
  });
});