import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: botón CORTE (cuchillo por trazado dibujado).
 *
 * 1. Crear un CUBO por ZEIA (chat) y seleccionarlo.
 * 2. Pulsar el botón «Corte» (data-activo=1) y dibujar un lazo cuadrado
 *    con 4 clics sobre la cara frontal → Enter CIERRA:
 *    la malla se corta (el contador de caras sube), sale el toast y el
 *    interior queda seleccionado al instante (barra de selección visible).
 * 3. Trazado ABIERTO (2 clics + Enter): corta la línea, sin nuevo toast de
 *    error (el contador vuelve a subir; el modo sigue activo).
 * 4. Clic DERECHO: cancela el trazo en curso (sin toast ni corte).
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

/** El mayor «N caras» de las cabeceras de las ventanas del visor. */
async function contadorCaras(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('span.font-mono')) as HTMLElement[];
    let mejor: number | null = null;
    for (const s of span) {
      const m = (s.textContent ?? '').match(/(\d+)\s*caras/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (mejor === null || n > mejor) mejor = n;
    }
    return mejor;
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
    const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function seleccionarFila(page: Page): Promise<void> {
  const botonesActivos = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const btn = document.querySelector('[data-testid="subselect-cara"]') as HTMLButtonElement | null;
      return !!btn && !btn.disabled;
    });
  };
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
}

test('Corte: lazo cerrado corta la malla y selecciona el interior', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-corte-trazado',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: {
        id: 'zeia-cubo-corte',
        primitive: 'cube',
        type: 'mesh',
        name: 'Cubo corte',
        ancho: 2,
        alto: 2,
        profundo: 2,
        transform: { position: [0, 0, 0] },
      },
    }],
    results: [{ object_id: 'zeia-cubo-corte' }],
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

  if ((await contarObjetosEscena(page)) < 1) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir chat' }).click();
    const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
    await chatForm.locator('textarea').fill('crea un cubo');
    await chatForm.getByRole('button', { name: 'Enviar' }).click();
    await expect
      .poll(async () => (await contarObjetosEscena(page)) >= 1, { timeout: 60_000 })
      .toBe(true);
    await page.keyboard.press('Escape');
  }
  await seleccionarFila(page);

  const antes = await contadorCaras(page);
  expect(antes).not.toBeNull();
  expect(antes!).toBeGreaterThan(0);

  // Entrar al modo Corte (el botón NO es desplegable: onClick simple).
  await clickBoton(page, 'boton-corte');
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="boton-corte"]')?.getAttribute('data-activo') === '1'))
    .toBe(true);

  // Lazo cuadrado de 4 clics sobre la cara frontal (centro del lienzo).
  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();
  await page.waitForTimeout(400);
  const d = 60;
  for (const [dx, dy] of [[-d, -d], [d, -d], [d, d], [-d, d]] as const) {
    await page.mouse.click(centro!.x + dx, centro!.y + dy);
    await page.waitForTimeout(120);
  }
  // Cierre con INTRO: corta + selecciona el interior. El toast vive pocos
  // segundos: mirado ANTES de cualquier poll del contador (que puede
  // comerse ese lapso con el repintado de los overlays).
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByText(/Corte aplicado/)).toBeVisible({ timeout: 15_000 });
  } catch (e) {
    const dump = await page.evaluate(() => {
      const cand = Array.from(document.querySelectorAll('[data-sonner-toast], [data-sonner-toast-wrapper], [role="status"], [data-testid="boton-corte"]'));
      return JSON.stringify({
        toasts: cand.map((el) => el.outerHTML.slice(0, 400)),
        activo: document.querySelector('[data-testid="boton-corte"]')?.getAttribute('data-activo') ?? 'NO',
        fragmentos: (document.body.innerText.match(/Corte[^\n]{0,60}/g) ?? []).slice(0, 5),
      });
    });
    console.log('DUMPTOAST>>>', dump);
    throw e;
  };

  await expect
    .poll(async () => (await contadorCaras(page)) ?? 0, { timeout: 60_000, intervals: [500] })
    .toBeGreaterThan(antes!);
  // Interior seleccionado: la barra de la sub-selección aparece.
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 15_000 });
  // El modo queda activo (cortar en serie).
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="boton-corte"]')?.getAttribute('data-activo') === '1'))
    .toBe(true);
});

test('Corte: trazado abierto corta la línea; clic derecho cancela', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-corte-trazado-2',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: {
        id: 'zeia-cubo-corte-2',
        primitive: 'cube',
        type: 'mesh',
        name: 'Cubo corte 2',
        ancho: 2,
        alto: 2,
        profundo: 2,
        transform: { position: [0, 0, 0] },
      },
    }],
    results: [{ object_id: 'zeia-cubo-corte-2' }],
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

  if ((await contarObjetosEscena(page)) < 1) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir chat' }).click();
    const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
    await chatForm.locator('textarea').fill('crea un cubo');
    await chatForm.getByRole('button', { name: 'Enviar' }).click();
    await expect
      .poll(async () => (await contarObjetosEscena(page)) >= 1, { timeout: 60_000 })
      .toBe(true);
    await page.keyboard.press('Escape');
  }
  await seleccionarFila(page);

  const antes = await contadorCaras(page);
  expect(antes).not.toBeNull();

  await clickBoton(page, 'boton-corte');
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="boton-corte"]')?.getAttribute('data-activo') === '1'))
    .toBe(true);

  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();
  await page.waitForTimeout(400);

  // 2 clics → trazado ABIERTO (solo la línea, sin selección interior).
  await page.mouse.click(centro!.x - 50, centro!.y - 20);
  await page.waitForTimeout(120);
  await page.mouse.click(centro!.x + 50, centro!.y - 20);
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Corte aplicado/)).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => (await contadorCaras(page)) ?? 0, { timeout: 60_000, intervals: [500] })
    .toBeGreaterThan(antes!);

  // Clic derecho CANCELA el trazo en curso: sin corte (el contador de
  // caras no cambia).
  const trasAbierto = await contadorCaras(page);
  await page.waitForTimeout(8_000); // que el toast anterior muera
  await page.mouse.click(centro!.x - 40, centro!.y + 30);
  await page.waitForTimeout(120);
  await page.mouse.click(centro!.x + 40, centro!.y + 30, { button: 'right' });
  await page.waitForTimeout(600);
  expect(await contadorCaras(page)).toEqual(trasAbierto);
});