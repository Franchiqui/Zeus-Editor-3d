import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: botón SELECCIONAR (zona) + desplegable Borrar/Copiar/Pegar/Crear.
 *
 * 1. Crear un cubo y activar el botón Seleccionar (barra face-select-bar).
 * 2. Rectángulo arrastrado sobre el cubo → contador combinado > 0.
 * 3. Polígono con 3 clics + doble clic → contador combinado > 0.
 * 4. Copiar la zona y Pegar → +1 objeto en la escena.
 * 5. Crear nuevo objeto (corte) → +1 objeto y la selección se limpia.
 * 6. Re-pulsar el botón sale del modo (la barra desaparece).
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

async function canvasCentro(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
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
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
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

/** Clic con mouse puro sobre un elemento por testid. locator.click() se
    cuelga contra ítems de Radix (control de hit-target), el mouse directo
    funciona igual que un humano. */
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

async function crearCuboSiFalta(page: Page): Promise<void> {
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

/** Contador combinado de la barra (>0 = zona cogida). */
async function contadorZona(page: Page): Promise<{ nf: number; nv: number; ne: number } | null> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="face-select-bar"] .text-cyan-300');
    const texto = bar?.textContent ?? '';
    const m = texto.match(/(\d+)\D+caras\D+(\d+)\D+v\w+\D+(\d+)\D+aristas/i)
      ?? texto.match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (!m) return null;
    return { nf: Number(m[1]), nv: Number(m[2]), ne: Number(m[3]) };
  });
}

/** Menú presente en el DOM (abierto). */
async function esperaMenu(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => !!document.querySelector('[role="menu"]')), { timeout: 8_000 })
    .toBe(true);
}

test('botón Seleccionar: zona rectángulo+polígono, Copiar/Pegar y Crear', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-subsel',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: { id: 'zeia-cubo-seleccionar', primitive: 'cube', type: 'mesh', name: 'Cubo', transform: { position: [0, 0, 0] } },
    }],
    results: [{ object_id: 'zeia-cubo-seleccionar' }],
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
  await crearCuboSiFalta(page);
  await seleccionarFila(page);

  // 1) Activar el botón Seleccionar: data-activo=1 y la barra aparece.
  await clickBoton(page, 'boton-seleccionar');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() =>
      document.querySelector('[data-testid="boton-seleccionar"]')?.getAttribute('data-activo') === '1'))
    .toBe(true);

  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();
  // El cubo está centrado: el rectángulo debe envolver el cubo completo
  // (una cara del cubo proyectado ocupa ≈ ±100 px; envolvemos ±120 px).
  await page.waitForTimeout(400);
  await page.mouse.move(centro!.x - 120, centro!.y - 120);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(centro!.x - 120 + i * 40, centro!.y - 120 + i * 40);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  const c1 = await contadorZona(page);
  expect(c1).not.toBeNull();
  expect(c1!.nf).toBeGreaterThan(0);

  // Cambiar a herramienta polígono en el desplegable: con modo activo y
  // menú cerrado, la pulsación SOLO reabre el menú (conserva el zona.
  await clickBoton(page, 'boton-seleccionar');
  // El menú está abierto y el modo sigue activo: elegir la herramienta polígono.
  await esperaMenu(page);
  await clicTestid(page, 'seleccionar-tool-poligono');
  await page.keyboard.press('Escape'); // cerrar el menú (limpia selección: normal)

  // 4 clics + doble clic para cerrar: un cuadrado que envuelve el cubo
  // (cada cara debe caer entera para que el contador se llene).
  await page.waitForTimeout(300);
  await page.mouse.click(centro!.x - 120, centro!.y - 130);
  await page.waitForTimeout(120);
  await page.mouse.click(centro!.x + 120, centro!.y - 130);
  await page.waitForTimeout(120);
  await page.mouse.click(centro!.x + 120, centro!.y + 130);
  await page.waitForTimeout(120);
  await page.mouse.click(centro!.x - 120, centro!.y + 130);
  await page.waitForTimeout(120);
  await page.mouse.dblclick(centro!.x - 120, centro!.y + 130);
  const c2 = await contadorZona(page);
  expect(c2).not.toBeNull();
  expect(c2!.nf).toBeGreaterThan(0);

  // 4) Copiar → Crear (corte) → Pegar: cada apertura del menú conserva la
  // zona dibujada. Crear corta la zona del original (+1 objeto y sale del
  // modo); Pegar recrea la copia como objeto nuevo (+1 y sale del modo).
  await clickBoton(page, 'boton-seleccionar'); // abre el menú (zona intacta)
  const copiado = page.getByTestId('seleccionar-accion-copiar');
  await copiado.waitFor({ state: 'visible', timeout: 8_000 });
  const antesZona = await contarObjetosEscena(page);
  await clicTestid(page, 'seleccionar-accion-copiar'); // copia y cierra el menú
  await page.waitForTimeout(400);

  // Crear: corta la zona del original (la selección de polígono sigue viva).
  await clickBoton(page, 'boton-seleccionar');
  await esperaMenu(page);
  await clicTestid(page, 'seleccionar-accion-crear');
  await expect.poll(async () => (await contarObjetosEscena(page)) >= antesZona + 1, { timeout: 15_000 }).toBe(true);
  // Crear sale del modo: la barra desaparece.
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });

  // Pegar: entra de nuevo (el press abre el menú) y pega el portapapeles.
  await clickBoton(page, 'boton-seleccionar');
  await esperaMenu(page);
  const item = page.getByTestId('seleccionar-accion-pegar');
  await expect(item).toBeEnabled({ timeout: 8_000 });
  await clicTestid(page, 'seleccionar-accion-pegar');
  await expect.poll(async () => (await contarObjetosEscena(page)) >= antesZona + 2, { timeout: 15_000 }).toBe(true);

  // Pegar también sale del modo: barra fuera al final.
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });

  await page.screenshot({ path: 'out-seleccionar-final.png', fullPage: false });
});