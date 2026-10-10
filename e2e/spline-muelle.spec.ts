import { test, expect, type Page } from '@playwright/test';

/**
 * E2E: botón «Spline» (trazado 3D con plantillas) y botón «Muelle»
 * (Spline Rosca, primitiva paramétrica).
 *
 * 1. Spline: activar el modo, 3 clics en la ventana Frente, Aplicar →
 *    objeto en la lista de la escena.
 * 2. Reabrir el modo (el objeto seleccionado trae su `spline`), arrastrar
 *    un marcador dentro de Frente y borrarlo con doble clic (el contador
 *    de vértices baja).
 * 3. Rosca: el botón entra en el MISMO modo spline con la hélice
 *    precargada (97 vértices); Aplicar hornea el objeto spline.
 *
 * La geometría (manifold, tangentes de esquina, hélice, sanitización) la
 * verifica numéricamente scripts/verificar-3d/verificar-spline-3d.mjs —
 * este e2e solo comprueba el cableado en el navegador real.
 *
 * Nota: e2e contra el servidor live es inestable por experiencia del
 * proyecto, así que los pasos son tolerantes (timeouts largos, sin
 * coordenadas externas al propio lienzo).
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

/** Centro del lienzo de una ventana (data-view: front/side/top/3d). */
async function centroDeVentana(page: Page, view: string) {
  const canvas = page.locator(`[data-view="${view}"] canvas`).first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`sin caja para la ventana ${view}`);
  return { canvas, cx: box.x + box.width / 2, cy: box.y + box.height / 2, W: box.width, H: box.height };
}

test('spline: dibujar en Frente, aplicar, reabrir, mover y borrar vértice + muelle', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  const erroresConsola: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') erroresConsola.push(msg.text());
  });
  page.on('pageerror', (err) => erroresConsola.push(String(err)));

  await waitForEditor(page);

  // ── 0. El modo de visualización (Textura/Alambre/Gris con aristas)
  //     aparece ahora TAMBIÉN en las ventanas 2D: conmutar los tres
  //     modos en Frente no debe romper nada y debe restaurar la
  //     textura al volver.
  const selVista = page.getByTestId('vista-modo-front');
  await expect(selVista).toBeVisible({ timeout: 30_000 });
  await selVista.selectOption('gris');
  // Modo INDIVIDUAL por ventana: elegir Gris en Frente NO cambia Arriba.
  await expect(page.getByTestId('vista-modo-top')).toHaveValue('textura');
  await page.waitForTimeout(400);
  await selVista.selectOption('alambre');
  await page.waitForTimeout(400);
  await selVista.selectOption('textura');

  // ── 1. Botón Spline: el panel del trazado aparece ──────────────────
  const botonSpline = page.getByTestId('boton-spline');
  await expect(botonSpline).toBeVisible({ timeout: 30_000 });
  await botonSpline.click({ noWaitAfter: true });

  const panel = page.getByTestId('spline-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // ── 2. Tres clics en la ventana Frente = tres vértices ─────────────
  const frente = await centroDeVentana(page, 'front');
  const p1 = { x: frente.cx - frente.W * 0.15, y: frente.cy - frente.H * 0.15 };
  const p2 = { x: frente.cx + frente.W * 0.1, y: frente.cy - frente.H * 0.2 };
  const p3 = { x: frente.cx + frente.W * 0.15, y: frente.cy + frente.H * 0.15 };
  for (const p of [p1, p2, p3]) {
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByTestId('spline-vertex-0')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('spline-vertex-1')).toBeVisible();
  await expect(page.getByTestId('spline-vertex-2')).toBeVisible();
  await expect(page.getByTestId('spline-aplicar')).toBeEnabled();

  // ── 3. Aplicar → objeto «Spline» en la lista de la escena ──────────
  await page.getByTestId('spline-aplicar').click({ noWaitAfter: true });
  const lista = page.locator('[data-testid="scene-object-list"]');
  await expect(lista).toBeVisible({ timeout: 10_000 });
  await expect(lista).toContainText('Spline');
  await expect(panel).not.toBeVisible();

  // ── 4. Reabrir el modo: el objeto seleccionado trae su trazado ─────
  await botonSpline.click({ noWaitAfter: true });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('spline-vertex-2')).toBeVisible();

  // Seleccionar un vértice: aparece SU plantilla con el lienzo de dibujo
  // (el SVG debe tener altura real — sin celda fija colapsa a 0px).
  // noWaitAfter: tras los refrescos del modo de vista Playwright llega a
  // interpretar la re-renderización como «navegación programada» y se
  // queda esperándola (mismo patrón que el botón Volver al visor).
  await page.getByTestId('spline-vertex-1').click({ noWaitAfter: true });
  const lienzo = page.locator('[data-testid="spline-panel"] svg[viewBox="0 0 100 100"]');
  await expect(lienzo).toBeVisible({ timeout: 10_000 });
  const caja = await lienzo.boundingBox();
  if (!caja || caja.height < 120) {
    throw new Error(`lienzo de plantilla sin altura: ${caja?.height ?? 'null'}px`);
  }

  // Arrastrar el marcador 2 (mismo punto de pantalla que su clic): el
  // pointerdown sobre el marcador lo selecciona y lo mueve, no añade.
  await page.mouse.move(p2.x, p2.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('spline-vertex-0')).toBeVisible();
  await expect(page.getByTestId('spline-vertex-2')).toBeVisible();

  // El vértice movido está activo → doble clic sobre él lo borra (3→2).
  await page.mouse.dblclick(p1.x, p1.y);
  await expect(page.getByTestId('spline-vertex-2')).not.toBeVisible({ timeout: 10_000 });

  // ── Maximizar la plantilla: ocupa el sitio de las 4 ventanas ───────
  await page.getByTestId('spline-vertex-0').click({ noWaitAfter: true });
  await page.getByTestId('canvas-maximize').click({ noWaitAfter: true });
  await expect(page.locator('[data-view="front"] canvas')).not.toBeVisible({ timeout: 10_000 });
  // El lienzo grande (EditorCanvas: viewBox dinámico, clase block/touch-none).
  const svgs = page.locator('svg[class*="touch-none"]');
  let cajaGrande: { x: number; y: number; width: number; height: number } | null = null;
  const totalSvg = await svgs.count();
  for (let i = 0; i < totalSvg; i++) {
    const b = await svgs.nth(i).boundingBox();
    if (b && b.width > 400 && b.height > 300) {
      cajaGrande = b;
      break;
    }
  }
  if (!cajaGrande) throw new Error('no hay lienzo maximizado (>300px) tras Maximizar');

  // Volver a la rejilla de ventanas: el visor vuelve a estar. (noWaitAfter:
  // el clic provoca un re-render a la rejilla y Playwright se queda
  // esperando «navegaciones programadas» que nunca terminan).
  await page.locator('button[title*="Volver al visor"]').first().click({ noWaitAfter: true });
  await expect(page.locator('[data-view="front"] canvas')).toBeVisible({ timeout: 10_000 });

  // La plantilla del vértice activo puede propagarse a TODOS de golpe:
  // elegir una forma distinta (cambia SOLO el vértice activo) y aplicar
  // la copia global (el trazado quedará con esa plantilla en todo).
  // noWaitAfter en ambos: el clic SÍ se ejecuta, pero Playwright a veces
  // se queda esperando «navegaciones programadas» del hot-reload.
  await page.getByTestId('spline-shape-cuadrado').click({ noWaitAfter: true });
  await page.getByTestId('spline-plantilla-todos').click({ noWaitAfter: true });

  // Cancelar: descarta el borrador y no crea un segundo objeto.
  await page.getByTestId('spline-cancelar').click({ noWaitAfter: true });
  await expect(panel).not.toBeVisible({ timeout: 10_000 });

  // ── 5. Botón Rosca: el MISMO modo spline con el muelle precargado ──
  const botonRosca = page.getByTestId('boton-rosca');
  await expect(botonRosca).toBeVisible();
  await botonRosca.click({ noWaitAfter: true });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  // La hélice por defecto: 6 vueltas × 16 vértices + 1.
  const filas = page.locator('[data-testid^="spline-vertex-"]');
  await expect
    .poll(async () => await filas.count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(95);
  // El muelle nace con el marco RADIAL (tornillo): el interruptor está y
  // conmuta (deja el estado alternado, ambas orientaciones se hornean).
  await expect(page.getByTestId('spline-radial')).toBeVisible();
  await page.getByTestId('spline-radial').click({ noWaitAfter: true });

  // Las propiedades del MUELLE siguen dentro del panel (vueltas, radios…):
  // subir a 8 vueltas rehace la hélice → 97 (6·16+1) pasa a 129 vértices.
  const vueltas = page.getByTestId('primitive-param-vueltas');
  await expect(vueltas).toBeVisible({ timeout: 10_000 });
  const vueltasActual = await vueltas.inputValue();
  if (!/^6/.test(vueltasActual)) throw new Error(`vueltas inicial ${vueltasActual} ≠ 6`);
  await vueltas.fill('8');
  await vueltas.blur();
  await expect
    .poll(async () => await filas.count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(128);
  // Aplicar: hornea el objeto spline con el muelle (nombre del spline).
  await page.getByTestId('spline-aplicar').click({ noWaitAfter: true });
  await expect(lista).toContainText('Spline', { timeout: 10_000 });
  await expect(panel).not.toBeVisible();
  // (espejado = seleccionado el objeto del muelle: espejo-y lo volteará.)

  // ── 6. Espejo: desplegable con los 3 ejes; espeja el seleccionado ──
  const botonEspejo = page.getByTestId('boton-espejo');
  await expect(botonEspejo).toBeVisible({ timeout: 10_000 });
  await botonEspejo.click({ noWaitAfter: true });
  await expect(page.getByTestId('espejo-x')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('espejo-y')).toBeVisible();
  await expect(page.getByTestId('espejo-z')).toBeVisible();
  // Espejar según Y: la malla cambia (el horneado pasa por el estado).
  await page.getByTestId('espejo-y').click({ noWaitAfter: true });
  await expect(lista).toBeVisible({ timeout: 10_000 });

  // ── Sin errores de consola (avisos del stack tolerados) ────────────
  // Los 404 de /icons/Spline.png y /icons/Muelle.png se toleran: los
  // iconos los colocará el diseñador (mientras, fallback de letra).
  expect(
    erroresConsola.filter(
      (e) =>
        !/favicon|ResizeObserver|Download the React DevTools|404 \(Not Found\)/i.test(e)
    ),
    `errores de consola: ${erroresConsola.join(' | ')}`
  ).toEqual([]);
});