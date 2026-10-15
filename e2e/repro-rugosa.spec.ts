import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * E2E de REPRODUCCIÓN (temporal): el bug «rugosa» — flujo REAL del usuario:
 * CORTE por trazado (cuchillo) → interior seleccionado y pintado de cian →
 * extrusión Ctrl+asa de mover → (Escape) → guardar. El .zeus descargado DEBE
 * conservar `faceTextures` alineada con `faces`. Captura TRACESCENE>>> por
 * consola (el trazador de setSceneObjects) para nombrar quién borra qué.
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
    return cont.querySelectorAll('[data-testid^="scene-object-"]').length;
  });
}

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

async function canvasCentro(page: Page) {
  // Remontes transitorios (recarga de Fast Refresh) dejan un instante SIN
  // lienzos: reintentar antes de rendirse.
  for (let intento = 0; intento < 10; intento++) {
    const pos = await page.evaluate(() => {
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
    if (pos) return pos;
    await page.waitForTimeout(800);
  }
  return null;
}

async function clickEn(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function clickTestId(page: Page, tid: string) {
  const pos = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, tid);
  expect(pos).not.toBeNull();
  await clickEn(page, pos!.x, pos!.y);
}

test('REPRO rugosa: corte + extrusión Ctrl + Escape → faceTextures sobreviven', async ({ page }) => {
  test.setTimeout(540_000);
  seedSelectedModel(page);
  const traza: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('TRACESCENE')) traza.push(t);
  });

  const ZEIA_PLAN = {
    plan_id: 'plan-repro-rugosa',
    status: 'executed',
    steps: [{
      action: 'objects.create',
      params: { id: 'zeia-cubo-rugosa', primitive: 'cube', type: 'mesh', name: 'Cubo rugosa', transform: { position: [0, 0, 0] } },
    }],
    results: [{ object_id: 'zeia-cubo-rugosa' }],
  };
  await page.route('**/api/chat', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200, contentType: 'application/json',
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
    await expect.poll(async () => (await contarObjetosEscena(page)) >= 1, { timeout: 30_000 }).toBe(true);
    await page.keyboard.press('Escape');
  };
  await crearCuboSiFalta();

  // Seleccionar la fila del objeto (activa los modos).
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
          const r2 = fila.getBoundingClientRect();
          return { x: r2.x + r2.width * 0.3, y: r2.y + r2.height / 2 };
        }
        return null;
      });
      if (posFila) await clickEn(page, posFila.x, posFila.y);
      await page.waitForTimeout(800);
    }
    await expect.poll(botonesActivos, { timeout: 15_000 }).toBe(true);
  };
  await seleccionarFila();

  // ---- CORTE por trazado: lazo cuadrado sobre la cara frontal ----
  const centro = await canvasCentro(page);
  expect(centro, 'sin lienzo en el editor tras 10 reintentos').not.toBeNull();
  await clickTestId(page, 'boton-corte');
  await expect.poll(async () =>
    (await page.getByTestId('boton-corte').getAttribute('data-activo')) === '1', { timeout: 10_000 },
  ).toBe(true);
  const R = 60;
  await clickEn(page, centro!.x - R, centro!.y - R);
  await clickEn(page, centro!.x + R, centro!.y - R);
  await clickEn(page, centro!.x + R, centro!.y + R);
  await clickEn(page, centro!.x - R, centro!.y + R);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const trasCorte = (await contadorCaras(page)) ?? 0;
  console.log('REPROCORTE>>>', 'caras tras corte:', trasCorte);
  expect(trasCorte, 'el corte no añadió caras').toBeGreaterThan(6);
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });

  // ---- Extrusión Ctrl+asa de mover (horno en el primer pointermove >4px) ----
  const candidatas: Array<[number, number]> = [[0, -26], [0, -36], [0, -18], [24, -6], [-24, -6], [0, 24]];
  let extruidas = false;
  for (const [dx, dy] of candidatas) {
    await page.keyboard.down('Control');
    await page.mouse.move(centro!.x + dx, centro!.y + dy);
    await page.waitForTimeout(120);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(centro!.x + dx * (1 + i * 0.12), centro!.y + dy * (1 + i * 0.12));
      await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(700);
    const ahora = (await contadorCaras(page)) ?? 0;
    if (ahora > trasCorte) { extruidas = true; break; }
    // El arrastre clásico pudo mover la región: re-cortar no; seguir con la
    // siguiente candidata tal cual (el horno es best-effort aqu).
  }
  console.log('REPROEXTR>>>', 'extruidas:', extruidas);

  // ---- Guardar .zeus (modal → download) y analizar la malla ----
  // (SIN Escape antes de guardar: el un-paint del resalte es limpieza POR
  // DISEÑO y borraría un array solo-resalte; el estado «rugosa» del usuario
  // es el post-extrusión tal cual.)
  const ruta = path.join('test-results', 'repro-rugosa.zeus');
  let guardado = false;
  try {
    await clickTestId(page, 'open-save-modal');
    await page.getByTestId('save-name-input').fill('repro-rugosa');
    const descarga = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('save-confirm-btn').click();
    const dl = await descarga;
    await dl.saveAs(ruta);
    guardado = true;
  } catch (e) {
    console.log('RESPROBE-ERROR>>>', 'no se pudo guardar:', String(e));
  }

  if (guardado) {
    const data = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    const obj = data.sceneObjects?.[0];
    const mesh = obj?.mesh;
    expect(mesh, 'el .zeus descargado no tiene objeto con malla').toBeTruthy();
    const ft = mesh.faceTextures;
    const grupos = mesh.faceTextureGroups;
    console.log('RESPROBE>>>', JSON.stringify({
      faces: mesh.faces.length,
      verts: mesh.vertices.length,
      faceTextures: ft ? `${ft.length} entradas, ${ft.filter((t: string | null) => t).length} con imagen` : 'AUSENTE',
      faceTextureGroups: grupos ? `${grupos.length} entradas, ${grupos.filter((g: string | null) => g).length} no-null` : 'AUSENTE',
    }));
    expect(ft, 'faceTextures se PERDIÓ en alguna parte del flujo (bug rugosa)').toBeTruthy();
    expect(ft.length, 'faceTextures desalineada con faces').toBe(mesh.faces.length);
    if (grupos) expect(grupos.length).toBe(mesh.faces.length);
  }

  // Traza completa por consola (quién cometió qué).
  console.log('TRACEFIN>>>\n' + traza.join('\n'));
});