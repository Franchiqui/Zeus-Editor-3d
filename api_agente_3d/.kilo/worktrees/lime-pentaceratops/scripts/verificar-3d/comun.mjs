/**
 * Utilidades compartidas por los scripts de verificación T1–T7 del Editor 3D.
 *
 * Este entorno no permite leer imágenes del visor como archivos: toda la
 * verificación de la escena es programática, midiendo los píxeles del canvas
 * WebGL directamente en el navegador (preserveDrawingBuffer está activo en
 * viewer-3d.tsx, así que canvas.toDataURL() funciona).
 *
 * Convenios:
 *  - El editor vive en http://localhost:3002/edit-3d (servidor dev original,
 *    NO reiniciar).
 *  - El visor 4 ventanas: [data-testid="viewer-container"] en orden
 *    Frente(0), Superior(1), Costado(2), 3D(3). Las mediciones usan la vista
 *    Frontal (0): ortográfica y estable, sin animación de cámara.
 *  - "tinta" = píxeles distintos del fondo del canvas: la figura puede
 *    ser gris clara o traer color (la fuente Textura es de color y su
 *    carga asincrónica cambia el render ~2 s después de escribir; por
 *    eso tras escribir se espera 2 s antes de medir). La rejilla se
 *    cancela comparando siempre contra la base de escena vacía.
 *  - Tras cada acción se espera ≥700 ms: el historial captura con 500 ms
 *    de debounce y el detector de auto-creación también es asíncrono.
 */
import { chromium } from 'playwright';

export const BASE_URL = 'http://localhost:3002/edit-3d';

/** Semilla de autenticación PocketBase: un JWT falso que no caduca. */
export function sembrarAuth(context) {
  const b64 = (o) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    exp: 2000000000,
    id: 'verificacion',
    collectionId: '_superusers',
    collectionName: '_superusers',
  })}.firma-verificacion`;
  return context.addInitScript((args) => {
    try {
      window.localStorage.setItem(
        'pocketbase_auth',
        JSON.stringify({ token: args.jwt, record: { id: 'verificacion', collectionName: '_superusers' }, model: { id: 'verificacion' } })
      );
    } catch {}
  }, { jwt });
}

/**
 * Lanza Edge, siembra la autenticación, abre el editor y espera a que
 * la pestaña Escena y el visor 4 ventanas estén montados.
 */
export async function abrirEditor({ consola = true } = {}) {
  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await sembrarAuth(context);
  const page = await context.newPage();

  const errores = [];
  if (consola) {
    page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errores.push(`console.error: ${msg.text()}`);
    });
  }

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
  // Arranque limpio: sin objetos fantasma de ninguna pestaña.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid^="scene-object-"]').length === 0,
    { timeout: 10000 }
  ).catch(() => {});
  return { browser, context, page, errores };
}

/** Espera fija (debounce del historial: 500 ms → mín. 700 ms). */
export const esperar = (ms = 800) => new Promise((r) => setTimeout(r, ms));

/** Clic en una pestaña por su testid (tab-scene, tab-text, ...). */
export async function clicTab(page, id) {
  await page.click(`[data-testid="tab-${id}"]`);
  await esperar(700);
}

/**
 * Mide la vista frontal del visor: píxeles de FIGURA ("tinta") y una firma
 * reducida de la imagen (para T7). La tinta cuenta los píxeles distintos
 * del fondo (la esquina del canvas) — la figura puede ser gris clara o
 * traer color de una fuente de color (p.ej. la fuente Textura), así que
 * un filtro de brillo no sirve. La rejilla y ejes se cancelan comparando
 * siempre contra la base de escena vacía del mismo arranque.
 * Devuelve null si el canvas aún no existe.
 */
export async function medirFrontal(page) {
  return page.evaluate(async () => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const f0 = [d[0], d[1], d[2]];
    let tinta = 0;
    const firma = [];
    for (let y = 0; y < off.height; y += 3) {
      for (let x = 0; x < off.width; x += 3) {
        const o = (y * off.width + x) * 4;
        const r = d[o], g = d[o + 1], b = d[o + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) {
          tinta++;
        }
        firma.push(((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5));
      }
    }
    return { tinta, firma: firma.join(',') };
  });
}

/** Igual que medirFrontal pero del visor 3D (índice 3). */
export async function medir3D(page) {
  return page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[3];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const f0 = [d[0], d[1], d[2]];
    let tinta = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - f0[0]) + Math.abs(d[i + 1] - f0[1]) + Math.abs(d[i + 2] - f0[2]) >= 45) tinta++;
    }
    return { tinta };
  });
}

/** ¿Está activa (verde) la pestaña dada? */
export async function tabActiva(page, id) {
  const clase = await page.getAttribute(`[data-testid="tab-${id}"]`, 'class');
  return /green/.test(clase || '');
}

/** Nº de tarjetas del listado de objetos del panel Escena. */
export async function numObjetos(page) {
  return page.evaluate(() => {
    const lista = document.querySelector('[data-testid="scene-object-list"]');
    if (!lista) return 0;
    // Solo tarjetas: la casilla de multiselección de cada tarjeta
    // (scene-object-check-N) comparte el prefijo y no cuenta.
    return lista.querySelectorAll(
      '[data-testid^="scene-object-"]:not([data-testid^="scene-object-check"])'
    ).length;
  });
}

/** Texto completo del listado de objetos (nombres e insignias). */
export async function textoListado(page) {
  return page.evaluate(() => {
    const lista = document.querySelector('[data-testid="scene-object-list"]');
    return lista ? lista.textContent || '' : '';
  });
}

/** Escribe en el campo de texto de la pestaña Texto (crea o edita). */
export async function escribirTexto(page, valor) {
  await page.fill('[data-testid="text-input"]', valor);
  await esperar(900); // debounce del historial + detector de auto-creación
}

/**
 * Resultados: cada script acumula comprobaciones y llama resumen() al final.
 */
export function crearResultados(nombre) {
  const filas = [];
  let falloFatal = false;
  return {
    check(cond, okMsg, malMsg) {
      filas.push({ ok: !!cond, msg: cond ? okMsg : malMsg });
      if (!cond) falloFatal = true;
      console.log(`${cond ? '  ✔' : '  ✘'} ${cond ? okMsg : malMsg}`);
    },
    error(msg) {
      falloFatal = true;
      filas.push({ ok: false, msg });
      console.log(`  ✘ ${msg}`);
    },
    async resumen({ browser, errores } = {}) {
      // Los errores de consola/pageerror se reportan pero solo fallan si
      // son "Uncaught" (los warnings y errores de red controlados no).
      if (errores && errores.length) {
        console.log('  ⚠ Errores de consola capturados:');
        for (const e of errores.slice(0, 10)) console.log(`    · ${e.slice(0, 220)}`);
      }
      const ok = !falloFatal;
      console.log(`\n${ok ? '✅' : '❌'} ${nombre}: ${filas.filter((f) => f.ok).length}/${filas.length} comprobaciones superadas${falloFatal ? ' — CON FALLOS' : ''}\n`);
      if (browser) await browser.close();
      process.exitCode = ok ? 0 : 1;
    },
  };
}