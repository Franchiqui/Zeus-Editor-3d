import { test, expect, type Page } from '@playwright/test';

/**
 * REPRO temporal: al activar «Seleccionar caras, vértices o segmentos» se
 * elimina todo lo de la escena y aparece un cubo. No es una prueba
 * permanente: solo diagnostica el comportamiento.
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

async function nombresEscena(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cont = document.querySelector('[data-testid="scene-object-list"]');
    if (!cont) return [];
    return Array.from(cont.querySelectorAll('[data-testid^="scene-object-"]'))
      .map((e) => e.textContent?.trim() || '')
      .filter(Boolean);
  });
}

async function snapshotCanvas(page: Page, label: string) {
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c2 = document.createElement('canvas');
    c2.width = 160; c2.height = 90;
    const ctx = c2.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 160, 90);
    const data = ctx.getImageData(0, 0, 160, 90).data;
    const colores = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      colores.set(key, (colores.get(key) ?? 0) + 1);
    }
    // colores con más de 40 píxeles (2.8%): fondo(s) y objetos grandes
    const top = [...colores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return top.map(([c, n]) => `${c}×${n}`).join(' | ');
  });
  console.log(`CANVAS ${label}:`, stats ?? 'sin canvas');
}

test('repro: activar selección de caras borra la escena', async ({ page }) => {
  test.setTimeout(240_000);
  seedSelectedModel(page);
  waitForEditor;

  const ZEIA_PLAN = {
    plan_id: 'plan-repro-faces',
    status: 'executed',
    steps: (['a', 'b', 'c'] as const).map((k, i) => ({
      action: 'objects.create',
      params: { id: `zeia-cubo-${k}`, primitive: 'cube', type: 'mesh', name: `Cubo ${i + 1}`, transform: { position: [i * 3, 0, 0] } },
    })),
    results: (['a', 'b', 'c'] as const).map((k) => ({ object_id: `zeia-cubo-${k}` })),
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

  // Abrir el chat flotante y pedir los cubos
  await page.getByRole('button', { name: 'Abrir chat' }).click();
  const chatForm = page.locator('form:has(button[aria-label="Enviar"])');
  await chatForm.locator('textarea').fill('crea tres cubos');
  await chatForm.getByRole('button', { name: 'Enviar' }).click();

  await expect
    .poll(async () => (await contarObjetosEscena(page)) >= 3, { timeout: 30_000 })
    .toBe(true);
  test.expect;
  const antes = await nombresEscena(page);
  console.log('ANTES de pulsar el botón:', JSON.stringify(antes));

  await page.keyboard.press('Escape');
  await snapshotCanvas(page, 'ANTES (escena sembrada)');

  // Seleccionar el primer objeto de la escena (estado del usuario: objeto
  // activo) y LUEGO pulsar el botón de caras.
  const posFila = await page.evaluate(() => {
    const cont = document.querySelector('[data-testid="scene-object-list"]');
    if (!cont) return null;
    const filas = Array.from(cont.querySelectorAll('[data-testid^="scene-object-"]')) as HTMLElement[];
    // Coger la primera fila REALMENTE visible (puede haber paneles ocultos
    // con el mismo testid; un rect de tamaño 0 delata el oculto).
    for (const fila of filas) {
      const r = fila.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      fila.scrollIntoView({ block: 'center' });
      const r2 = fila.getBoundingClientRect();
      // Se clica al 30% del ancho: a la derecha están los botones «Vistas»,
      // candado, etc., que hacen stopPropagation del clic de selección.
      return { x: r2.x + r2.width * 0.3, y: r2.y + r2.height / 2 };
    }
    return null;
  });
  console.log('pos fila:', JSON.stringify(posFila));
  if (posFila) {
    await page.mouse.move(posFila.x, posFila.y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    // Esperar a que la fila se marque como seleccionada (borde verde)
    const selFila = await page
      .waitForFunction(
        () => {
          const fila = document.querySelector('[data-testid="scene-object-list"] [data-testid^="scene-object-"]');
          return !!fila && /bg-green-500/.test(fila.className);
        },
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    console.log('selección de fila registrada:', selFila);
    if (!selFila) {
      // Reintento con clic de Playwright sobre el texto del nombre
      const filaTxt = page
        .locator('[data-testid="scene-object-list"] [data-testid^="scene-object-"]')
        .first();
      const box = await filaTxt.boundingBox().catch(() => null);
      console.log('boundingBox fila:', JSON.stringify(box));
    }
  }

  // Pulsar «Seleccionar caras, vértices o segmentos» en la barra del visor.
  // Locator normal no estabiliza (render continuo): clic por coordenadas.
  const posBtn = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).title?.includes('Seleccionar caras'),
    ) as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('pos botón caras:', JSON.stringify(posBtn));
  if (!posBtn) {
    console.log('SIN botón de caras: no hay figura activa con geometría (¿seleccionó el objeto?)');
    console.log('DESPUÉS (sin pulsar):', JSON.stringify(await nombresEscena(page)));
    await snapshotCanvas(page, 'SIN botón caras');
    return;
  }
  await page.mouse.move(posBtn.x, posBtn.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await snapshotCanvas(page, 'DESPUÉS de activar caras');

  const despues = await nombresEscena(page);
  console.log('DESPUÉS de pulsar:', JSON.stringify(despues));
  console.log('barra face-select presente:', await page.getByTestId('face-select-bar').count());

  // Volver a desactivarlo y ver qué queda
  const posOff = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button')).find(
      (b) => (b as HTMLButtonElement).title?.includes('Seleccionar caras'),
    ) as HTMLElement | undefined;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (posOff) {
    await page.mouse.move(posOff.x, posOff.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(2000);
    await snapshotCanvas(page, 'DESPUÉS de desactivar cars');
    console.log('DESPUÉS de desactivar:', JSON.stringify(await nombresEscena(page)));
  }
});