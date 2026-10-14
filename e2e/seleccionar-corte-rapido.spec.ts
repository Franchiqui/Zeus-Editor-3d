import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: CORTE RÁPIDO del desplegable del botón SELECCIONAR (para mallas
 * enormes): checkbox «Corte rápido» activo → dibujar zona → el corte sale
 * DIRECTO (sin selección ni overlays) y la pieza desaparece del objeto.
 *
 * 1. Crear una ESFERA de alta resolución (segments:160 ≈ 13.7k caras).
 * 2. Entrar al modo Seleccionar y marcar «Corte rápido».
 * 3. Rectángulo sobre la esfera: la cabecera baja de caras al instante
 *    (el barrido del corte es una pasada O(N)), sale el toast y el modo
 *    SIGUE activo para cortar varias zonas en serie.
 *
 * NOTA: el flujo total puede rondar el minuto aunque el corte sea
 * instantáneo — el resto del modo Seleccionar sigue con su coste por
 * frame preexistente en mallas grandes (no del corte rápido).
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

/** El mayor «N caras» de las cabeceras de las ventanas del visor
    (texto DOM «X vért · Y caras» en viewer-3d). */
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
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/** locator.click() se cuelga contra ítems de Radix: mouse directo. */
async function clicTestid(page: Page, id: string) {
  const pos = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  expect(pos, `no existe [data-testid="${id}"] en el DOM`).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function esperaMenu(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector('[role="menu"]')), { timeout: 8_000 })
    .toBe(true);
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

test('Corte rápido: zona rectángulo corta directo una esfera de 13.7k caras', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-corte-rapido',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: {
        id: 'zeia-esfera-grande',
        primitive: 'sphere',
        type: 'mesh',
        name: 'Esfera grande',
        radio: 1.5,
        segments: 160, // esfera ≈ 13.7k triángulos, 13.6k vértices
        transform: { position: [0, 0, 0] },
      },
    }],
    results: [{ object_id: 'zeia-esfera-grande' }],
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

  // Crear la esfera grande (la respuesta del chat viene enrutada).
  if ((await contarObjetosEscena(page)) < 1) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Abrir chat' }).click();
    const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
    await chatForm.locator('textarea').fill('crea una esfera');
    await chatForm.getByRole('button', { name: 'Enviar' }).click();
    await expect
      .poll(async () => (await contarObjetosEscena(page)) >= 1, { timeout: 60_000 })
      .toBe(true);
    await page.keyboard.press('Escape');
  }
  await seleccionarFila(page);

  const antes = await contadorCaras(page);
  expect(antes).not.toBeNull();
  expect(antes!).toBeGreaterThan(5000);

  // Entrar al modo Seleccionar (la 1.ª pulsación TAMBIÉN abre el menú:
  // cerrarlo con Escape — el modo sigue) y reabrir el desplegable.
  await clickBoton(page, 'boton-seleccionar');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="boton-seleccionar"]')?.getAttribute('data-activo') === '1'))
    .toBe(true);
  await clickBoton(page, 'boton-seleccionar'); // (menú cerrado) SOLO reabre el menú
  await esperaMenu(page);

  // Marcar «Corte rápido» (checkbox; el menú NO se cierra).
  await clicTestid(page, 'seleccionar-accion-rapido');
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="seleccionar-accion-rapido"]')?.getAttribute('aria-checked')))
    .toBe('true');
  await page.keyboard.press('Escape'); // cerrar el menú (el modo sigue)

  // Dibujar un rectángulo sobre la mitad de la esfera: corta DIRECTO.
  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();
  await page.waitForTimeout(400);
  await page.mouse.move(centro!.x - 90, centro!.y - 90);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(centro!.x - 90 + i * 30, centro!.y - 90 + i * 30);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();

  // El corte (un barrido + 1 setSceneObjects): la cabecera baja de caras.
  // Con el hilo lento del modo Seleccionar los evaluate pesan ~3 s; el
  // corte REAL se aplica en el primer segundo (verificado con sondas).
  await expect
    .poll(async () => (await contadorCaras(page)) ?? Number.MAX_SAFE_INTEGER, { timeout: 120_000, intervals: [500] })
    .toBeLessThan(antes!);
  await expect(page.getByText(/Corte rápido/)).toBeVisible({ timeout: 30_000 });

  // El modo sigue activo para cortar varias zonas en serie.
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: 'out-corte-rapido-final.png', fullPage: false });
});