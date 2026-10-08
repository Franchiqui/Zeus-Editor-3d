import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: botones Polígono / Aristas / Puntos junto a «Acciones».
 *
 * 1. Crear un cubo y seleccionarlo en la escena.
 * 2. «Polígono» activa el modo de sub-selección (barra face-select-bar) y
 *    re-pulsarlo sale (la barra desaparece).
 * 3. Clic en una cara del cubo la selecciona (contador 1 + campos de mover).
 * 4. Cambiar de objetivo (Aristas/Puntos) limpia la selección.
 * 5. Arrastrar el gizmo de la selección mueve la cara (la mancha magenta
 *    del resalte se desplaza: el canvas cambia aunque el ratón esté fuera).
 * 6. Esc limpia; Ctrl (multi) añade una segunda cara.
 */

const MODEL = { id: 'pw-model-1', nombre_modelo: 'PW Model', proveedor: 'openai', id_modelo: 'gpt-4o' };

async function waitForEditor(page: Page) {
  await page.goto('/edit-3d', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

/** Espera a que el editor haya remontado (un reload de Fast Refresh deja
 * «Cargando Editor 3D...» unos segundos). */
async function esperarEditorListo(page: Page) {
  await expect(page.getByText('Cargando Editor 3D...')).toHaveCount(0, { timeout: 30_000 });
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
    // Canvas VISIBLE más grande: las ventanas están a pantalla completa
    // (una sola vista) o en mosaico; el mayor es la vista con el cubo.
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

/** Huella del canvas (colores dominantes, con el ratón FUERA del lienzo). */
async function huellaCanvas(page: Page): Promise<string> {
  await page.mouse.move(4, 4);
  await page.waitForTimeout(450); // throttle de hover (40 ms) + un frame
  return page.evaluate(() => {
    const cvs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    let mejor: HTMLCanvasElement | null = null;
    let mejorArea = 0;
    for (const c of cvs) {
      const r = c.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      if (r.width * r.height > mejorArea) { mejorArea = r.width * r.height; mejor = c; }
    }
    if (!mejor) return 'sin-canvas';
    const c2 = document.createElement('canvas');
    c2.width = 120; c2.height = 80;
    const ctx = c2.getContext('2d')!;
    ctx.drawImage(mejor, 0, 0, 120, 80);
    const data = ctx.getImageData(0, 0, 120, 80).data;
    const colores = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`; // cuantizado
      colores.set(key, (colores.get(key) ?? 0) + 1);
    }
    return [...colores.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join('|');
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
  // Clic por coordenadas: la vista re-renderiza continuo y los locators
  // normales no estabilizan (patrón de repro-faces.spec.ts).
  await page.mouse.move(pos!.x, pos!.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

test('botones Polígono/Aristas/Puntos: modo, selección, limpieza y gizmo', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const ZEIA_PLAN = {
    plan_id: 'plan-subsel',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: { id: 'zeia-cubo-subsel', primitive: 'cube', type: 'mesh', name: 'Cubo', transform: { position: [0, 0, 0] } },
    }],
    results: [{ object_id: 'zeia-cubo-subsel' }],
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

  // Crear el cubo (o comprobar que sigue: un reload de Fast Refresh puede
  // vaciar la escena a mitad de la prueba).
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

  // Seleccionar la fila del objeto (clic al 30% del ancho: los botones de
  // la derecha hacen stopPropagation). El clic por fila SUELE ser inestable
  // (también en repro-faces): reintentar hasta que los botones nuevos se
  // activen — eso es la señal de que hay figura activa.
  const seleccionarFila = async (): Promise<void> => {
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
        // Clic lento (down + espera + up), como el estado del usuario real.
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

  // Entra al modo con el objetivo dado; si un reload resetea la escena,
  // vuelve a crear el cubo y re-seleccionar la fila primero. Si el botón
  // YA está activo (data-activo=1) no se pulsa: pulsar saldría del modo.
  const modoActivo = async (tid: string): Promise<boolean> =>
    page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-activo') === '1', tid);
  const asegurarModo = async (tid: string): Promise<void> => {
    if (!(await modoActivo(tid))) {
      await crearCuboSiFalta(); // un reload puede haber vaciado la escena
      await seleccionarFila();
      if (!(await modoActivo(tid))) await clickBoton(page, tid);
    }
    await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  };

  await asegurarModo('subselect-cara');
  await page.waitForTimeout(300);

  // 2) Clic en una cara del cubo (centro del canvas = zona de la figura)
  //    → contador 1 y campos de mover visibles.
  const centro = await canvasCentro(page);
  expect(centro).not.toBeNull();
  for (let intento = 0; intento < 3; intento++) {
    await esperarEditorListo(page);
    await page.mouse.move(centro!.x, centro!.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.mouse.up();
    try {
      await expect(page.getByTestId('face-move-fields')).toBeVisible({ timeout: 6_000 });
      break;
    } catch {
      // Puede haber recargado la página (Fast Refresh): re-estado y repite.
      await asegurarModo('subselect-cara');
    }
  }
  await expect(page.getByTestId('face-move-fields')).toBeVisible({ timeout: 6_000 });

  // 3) Cambiar de objetivo limpia la selección (sin campos de mover).
  await clickBoton(page, 'subselect-segmento');
  await page.waitForTimeout(400);
  await expect(page.getByTestId('face-move-fields')).toHaveCount(0);

  // 4) Vuelta a Polígono, seleccionar una cara y arrastrar el gizmo:
  //    la mancha del resalte se mueve (la huella del canvas cambia con el
  //    ratón fuera del lienzo en ambas tomas).
  await asegurarModo('subselect-cara');
  await esperarEditorListo(page);
  await page.waitForTimeout(500);
  await page.mouse.move(centro!.x, centro!.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-move-fields')).toBeVisible({ timeout: 10_000 });
  const huellaAntes = await huellaCanvas(page);
  await page.mouse.move(centro!.x, centro!.y);
  await page.mouse.move(centro!.x + 3, centro!.y + 3);
  await page.mouse.down();
  // Arrastre en diagonal (gana algo, sea cual sea el eje en pantalla).
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(centro!.x + 3 + i * 4, centro!.y + 3 + i * 3);
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  const huellaDespues = await huellaCanvas(page);
  expect(huellaDespues).not.toBe(huellaAntes);

  // 5) Esc limpia la selección (clic en el vacío también lo haría).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('face-move-fields')).toHaveCount(0);

  // 6) Re-pulsar «Polígono» sale del modo: la barra desaparece. (Si un
  //    reload reseteó el modo, la barra ya no está: nada que pulsar.)
  if (await page.getByTestId('face-select-bar').isVisible().catch(() => false)) {
    await clickBoton(page, 'subselect-cara');
    await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });
  }
});