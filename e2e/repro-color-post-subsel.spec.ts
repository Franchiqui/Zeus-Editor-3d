import { test, expect, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';

/**
 * REPRO (diagnóstico): color directo tras una modificación con el botón
 * «Polígonos» — el usuario dice: la textura sí se aplica, el color no.
 *
 * Objeto REAL del usuario: Cubo cargado del modal «Objeto 3D».
 *
 * Lecturas: píxel central del lienzo más grande (PNG → zlib) para saber
 * el color REAL mostrado, y el .zeus descargado (Guardar) para el estado
 * interno de la malla (faceColors / faceTextures).
 */

function decodePngCenter(buf: Buffer): [number, number, number] {
  // PNG mínimo: firma + IHDR + IDAT(s) + IEND, sin interlace, 8 bits.
  const esPng = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!esPng) throw new Error('no es PNG');
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idats: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const canales = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || canales === 0) throw new Error(`PNG no soportado: depth=${bitDepth} tipo=${colorType}`);
  const raw = inflateSync(Buffer.concat(idats));
  const bpp = canales;
  const stride = width * bpp;
  // Des-filtrado (filtros 0..4)
  const img = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const filaSrc = y * (stride + 1) + 1;
    const filaDst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[filaDst + x - bpp] : 0;
      const b = y > 0 ? img[filaDst - stride + x] : 0;
      const c = y > 0 && x >= bpp ? img[filaDst - stride + x - bpp] : 0;
      let val = raw[filaSrc + x];
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      img[filaDst + x] = val;
    }
  }
  // Parche 16×16 en (40% ancho, 45% alto): dentro del cubo, fuera del gizmo.
  const mediana = (relX: number, relY: number) => {
    const muestras: [number, number, number][] = [];
    const x0 = Math.floor(width * relX), y0 = Math.floor(height * relY);
    for (let dy = -8; dy <= 8; dy += 4) {
      for (let dx = -8; dx <= 8; dx += 4) {
        const o = (y0 + dy) * stride + (x0 + dx) * bpp;
        muestras.push([img[o], img[o + 1], img[o + 2]]);
      }
    }
    muestras.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    return muestras[muestras.length >> 1];
  };
  // El punto 40/45 cae dentro del cuadrado del cubo en la vista Frente.
  return mediana(0.40, 0.45);
}

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

async function canvasRect(page: Page) {
  return page.evaluate(() => {
    let mejor: HTMLCanvasElement | null = null;
    let mejorArea = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      if (r.width * r.height > mejorArea) { mejorArea = r.width * r.height; mejor = c; }
    }
    if (!mejor) return null;
    const r = mejor.getBoundingClientRect();
    return {
      x: r.x, y: r.y, width: r.width, height: r.height,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
    };
  });
}

const DIR = 'e2e/.repro';
import { mkdirSync, writeFileSync, readFileSync as leerArchivo } from 'node:fs';

/** Captura el lienzo mayor a un archivo PNG y devuelve su píxel central. */
async function pixelCentral(page: Page, nombre: string): Promise<[number, number, number]> {
  const rect = await canvasRect(page);
  expect(rect).not.toBeNull();
  const buf = await page.screenshot({
    clip: { x: rect!.x, y: rect!.y, width: rect!.width, height: rect!.height },
  });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/${nombre}.png`, buf);
  return decodePngCenter(buf);
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
  await page.waitForTimeout(60);
  await page.mouse.up();
}

async function descargarZeus(page: Page): Promise<Record<string, unknown>> {
  await page.keyboard.press('Escape');
  await page.getByTestId('actions-menu-trigger').click();
  const abrirGuardar = page.getByTestId('open-save-modal');
  await expect(abrirGuardar).toBeVisible({ timeout: 10_000 });
  await abrirGuardar.click();
  const input = page.getByTestId('save-name-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByTestId('save-confirm-btn').click();
  const download = await downloadPromise;
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(await download.path()!);
  // Cerrar el modal: su velo bloquea el resto de clics.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  return JSON.parse(bytes.toString('utf-8'));
}

function primeraMalla(guardado: Record<string, unknown>): Record<string, unknown> | undefined {
  return ((guardado.sceneObjects as Array<Record<string, unknown>>)
    .map((o) => o.mesh as Record<string, unknown>).filter(Boolean)[0]);
}

function resumenMalla(mesh: Record<string, unknown> | undefined): string {
  if (!mesh) return '(sin malla)';
  const caraTex = (mesh.faceTextures as (string | null)[] | undefined)?.filter(Boolean).map((t) => String(t).slice(0, 30));
  return JSON.stringify({
    caras: ((mesh.faces as unknown[]) ?? []).length,
    faceColors: mesh.faceColors === undefined ? undefined : Array.from(new Set(mesh.faceColors as string[])),
    texture: mesh.texture === undefined ? undefined : String(mesh.texture).slice(0, 30),
    faceTextures: caraTex,
    faceTextureGroups: mesh.faceTextureGroups === undefined ? undefined : (mesh.faceTextureGroups as unknown[]).length,
  });
}

const esRojo = ([r, g, b]: [number, number, number]) => r > 140 && g < 90 && b < 90;
const esAzul = ([r, g, b]: [number, number, number]) => b > 100 && r < 90 && g < 90;
const esVerde = ([r, g, b]: [number, number, number]) => g > 140 && r < 90 && b < 90;

test('repro: color directo tras editar con polígonos (Cubo de galería)', async ({ page }) => {
  test.setTimeout(480_000);
  seedSelectedModel(page);

  page.on('console', (msg) => {
    if (msg.text().includes('[zeus-debug]')) console.log('  ', msg.text());
  });

  await waitForEditor(page);

  // Cargar Cubo desde el modal «Objeto 3D» (galería).
  await page.keyboard.press('Escape');
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

  // 1. COLOR ROJO DIRECTO — caso base
  const pxBase = await pixelCentral(page, 'base');
  console.log('[repro] píxel base (cubo azul esperado):', pxBase, esAzul(pxBase) ? 'AZUL ✓' : 'no azul');
  const colorInput = page.locator('[data-testid="scene-figure-color"]');
  await expect(colorInput).toBeVisible({ timeout: 15_000 });
  await colorInput.fill('#ff0000');
  await page.waitForTimeout(800);
  const pxRojo = await pixelCentral(page, 'rojo');
  console.log('[repro] píxel tras rojo:', pxRojo, esRojo(pxRojo) ? 'ROJO ✓' : 'NO ROJO ✗');

  let guardado1 = await descargarZeus(page);
  console.log('[repro] tras rojo (malla):', resumenMalla(primeraMalla(guardado1)));

  // 2. MODIFICAR CON POLÍGONOS: cara central → moverla en Y
  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toBeVisible({ timeout: 10_000 });
  const rect = await canvasRect(page);
  await page.mouse.move(rect!.cx, rect!.cy);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('face-select-bar')).toContainText(/1 caras seleccionadas/, { timeout: 8_000 });
  await page.getByTestId('face-move-y').fill('0.2');
  await clickTestId(page, 'face-move-apply');
  await page.waitForTimeout(500);
  // Comprobar que el resalte cian está presente AHORA (mientras hay selección)
  const guardadoConSel = await descargarZeus(page);
  console.log('[repro] con cara seleccionada (malla):', resumenMalla(primeraMalla(guardadoConSel)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await clickTestId(page, 'subselect-cara');
  await expect(page.getByTestId('face-select-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const guardadoSalida = await descargarZeus(page);
  console.log('[repro] tras SALIR del modo (malla):', resumenMalla(primeraMalla(guardadoSalida)));
  const pxTrasEdicion = await pixelCentral(page, 'edicion');
  console.log('[repro] píxel tras la modificación (rojo esperado):', pxTrasEdicion);

  // 3. COLOR VERDE — el caso del bug
  const colorInput2 = page.locator('[data-testid="scene-figure-color"]');
  await colorInput2.fill('#00ff00');
  await page.waitForTimeout(800);
  const pxVerde = await pixelCentral(page, 'verde');
  console.log('[repro] píxel tras verde:', pxVerde, esVerde(pxVerde) ? 'VERDE ✓' : 'NO VERDE ✗');

  const guardado2 = await descargarZeus(page);
  console.log('[repro] tras verde (malla):', resumenMalla(primeraMalla(guardado2)));
});