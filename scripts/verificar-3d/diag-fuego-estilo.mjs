/**
 * DIAG FUEGO ESTILO — el slider «Tipo de llama» (fireEstilo 0..1) morfe
 * la llama de partículas sueltas a pluma coherente.
 *
 * Verificación por fiber (la cámara del visor no está en fibra): el
 * runtime de efectos vive en un useRef con un Map (fxObjetosRef) cuyos
 * valores tienen `.fire` (ParticleSystem). Sobre el fire system:
 *  a) material parcheado: onBeforeCompile presente, attribute `aVida`
 *     creado y recién actualizado (needsUpdate true de vida viva).
 *  b) el uniforme sigue al slider: 0.35 por defecto → 0 → 1.
 *  c) MORFEO medible: dispersión lateral (σ en x/z) + vida media de las
 *     partículas vivas. Con estilo 1 (pluma) la dispersión baja (partículas
 *     que convergen al eje) y la vida baja (más rápida y corta).
 *  d) Sin errores de página/shader (el patch GLSL compila).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FUEGO ESTILO · slider fireEstilo morfe la llama');

const { browser, page, errores } = await abrirEditor();
const fallosPagina = [];
page.on('pageerror', (e) => fallosPagina.push(String(e?.message ?? e)));

/**
 * Encuentra el Map de runtimes de efectos (fxObjetosRef) caminando
 * TODA la cadena de hooks de las fibras ancestro del contenedor, y
 * devuelve el estado del fuego de cada objeto: uniforme, attribute,
 * dispersión lateral y vida media de las partículas vivas.
 */
const estadoFuego = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const fires = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 70) return;
        for (let n = fib.memoizedState, i = 0; n && i < 500; i++, n = n.next) {
          const cur = n.memoizedState?.current;
          if (
            cur instanceof Map &&
            cur.size > 0
          ) {
            for (const rt of cur.values()) {
              // Un RuntimeFxObjeto tiene .fire (ParticleSystem o null) y objectId.
              if (rt && typeof rt === 'object' && 'fire' in rt && 'objectId' in rt) {
                const f = rt.fire;
                if (f?.positions && f?.life) {
                  let sx = 0, sz = 0, vivos = 0, vidaMedia = 0;
                  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
                  const count = f.life.length;
                  for (let i = 0; i < count; i++) {
                    if (f.life[i] <= 0) continue;
                    sx += f.positions[i * 3];
                    sz += f.positions[i * 3 + 2];
                    vidaMedia += f.life[i] / (f.maxLife[i] || 1);
                    vivos++;
                    minX = Math.min(minX, f.positions[i * 3]);
                    maxX = Math.max(maxX, f.positions[i * 3]);
                    minY = Math.min(minY, f.positions[i * 3 + 1]);
                    maxY = Math.max(maxY, f.positions[i * 3 + 1]);
                    minZ = Math.min(minZ, f.positions[i * 3 + 2]);
                    maxZ = Math.max(maxZ, f.positions[i * 3 + 2]);
                  }
                  let σx = 0, σz = 0, vidaMax = 0;
                  if (vivos > 0) {
                    const mx = sx / vivos, mz = sz / vivos;
                    sx = 0; sz = 0;
                    for (let i = 0; i < count; i++) {
                      if (f.life[i] <= 0) continue;
                      const dx = f.positions[i * 3] - mx;
                      const dz = f.positions[i * 3 + 2] - mz;
                      sx += dx * dx;
                      sz += dz * dz;
                      vidaMax += f.maxLife[i];
                    }
                    σx = Math.sqrt(sx / vivos);
                    σz = Math.sqrt(sz / vivos);
                    vidaMax /= vivos;
                  }
                  const geo = f.points.geometry;
                  const attr = geo.attributes.aVida;
                  const vidaA = f.vidaA ?? null;
                  fires.push({
                    uniforme: f.uniformesEstilo?.uEstilo?.value ?? null,
                    vivos,
                    σx: +σx.toFixed(4),
                    σz: +σz.toFixed(4),
                    origen: f.origen
                      ? `${f.origen.x.toFixed(2)},${f.origen.y.toFixed(2)},${f.origen.z.toFixed(2)}`
                      : null,
                    rango: `x[${minX.toFixed(2)}..${maxX.toFixed(2)}] y[${minY.toFixed(2)}..${maxY.toFixed(2)}] z[${minZ.toFixed(2)}..${maxZ.toFixed(2)}]`,
                    vidaMedia: +(vivos ? vidaMedia / vivos : 0).toFixed(3),
                    vidaMax: +vidaMax.toFixed(3),
                    aVida: !!attr,
                    vidaAMuestra: vidaA
                      ? Array.from(vidaA.slice(0, 8)).map((v) => +v.toFixed(2))
                      : null,
                    parche: typeof f.points.material.onBeforeCompile === 'function'
                      ? f.points.material.onBeforeCompile.toString().includes('uEstilo')
                      : ('sin-onBeforeCompile'),
                  });
                }
              }
            }
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (fires.length > 0) return fires;
    }
    return null;
  });

const pondrerEstilo = async (valor) => {
  // Modal «Configuración de FX» con solo Llamas activo: los 4 number
  // inputs son Partículas, Tamaño, Intensidad y Tipo de llama.
  const num = page.getByRole('dialog').locator('input[type="number"]').nth(3);
  await num.fill(String(valor));
  await esperar(1500);
};

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');

  // Fuego en el objeto: menú FX → «Llamas» (Radix se cierra al elegir).
  const botonFx = page.locator('button', { hasText: 'FX' }).first();
  await botonFx.click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2000);
  // Modal de configuración: mismo menú → «Configuración de FX».
  await botonFx.click();
  await esperar(500);
  await page.getByText('Configuración de FX', { exact: true }).first().click();
  await esperar(900);

  let estado = (await estadoFuego()) ?? [];
  R.check(estado.length > 0, 'runtime de fuego creado', 'no se encontró el fire runtime — BUG');
  if (estado.length > 0) {
    console.log('estado inicial (por defecto 0.35):', JSON.stringify(estado[0]));
    R.check(
      estado[0].parche === true && estado[0].aVida === true,
      'material parcheado (onBeforeCompile con uEstilo) + attribute aVida',
      `material sin parche: parche=${estado[0].parche} aVida=${estado[0].aVida} — BUG`
    );
    R.check(
      Math.abs((estado[0].uniforme ?? -1) - 0.35) < 0.02,
      `uniforme inicial 0.35 (defecto): ${estado[0].uniforme}`,
      `uniforme inicial no es 0.35: ${estado[0].uniforme} — BUG`
    );
  }

  // Estilo 0: partículas sueltas (comportamiento actual, dispersión alta).
  await pondrerEstilo(0);
  await esperar(5200);
  estado = (await estadoFuego()) ?? [];
  const base0 = estado[0] ?? null;
  console.log('estilo 0:', JSON.stringify(base0));
  R.check(
    !!base0 && Math.abs((base0.uniforme ?? -1)) < 0.02,
    `estilo 0 registrado en el uniforme: ${base0?.uniforme}`,
    `el uniforme no llegó a 0: ${base0?.uniforme} — BUG`
  );
  const vida0 = base0?.vidaAMuestra ?? null;

  // Estilo 1: llama real (pluma convergente, rápida, corta).
  await pondrerEstilo(1);
  await esperar(5200); // deja que respawneen todas con la vida corta del estilo 1
  estado = (await estadoFuego()) ?? [];
  const base1 = estado[0] ?? null;
  console.log('estilo 1:', JSON.stringify(base1));
  R.check(
    !!base1 && Math.abs((base1.uniforme ?? -1) - 1) < 0.02,
    `estilo 1 registrado en el uniforme: ${base1?.uniforme}`,
    `el uniforme no llegó a 1: ${base1?.uniforme} — BUG`
  );

  if (base0 && base1 && base0.vivos > 5 && base1.vivos > 5) {
    // Dispersión combinada (la convergencia actúa en x y en z): exigimos
    // al menos un 25% menos en la pluma.
    const disp0 = Math.max(base0.σx, base0.σz);
    const disp1 = Math.max(base1.σx, base1.σz);
    R.check(
      disp1 < disp0 * 0.75,
      `la pluma converge: dispersión estilo1 ${disp1} < 0.75 × estilo0 ${disp0}`,
      `sin convergencia (σ 0→1: ${disp0} → ${disp1}) — BUG`
    );
    R.check(
      base1.vidaMax < base0.vidaMax,
      `vida de partícula más corta en la pluma (maxLife ${base1.vidaMax} < ${base0.vidaMax})`,
      `la vida no bajó (${base0.vidaMax} → ${base1.vidaMax}) — BUG`
    );
  }
  if (base1 && base1.vidaAMuestra) {
    const rangoOk = base1.vidaAMuestra.every((v) => v >= 0 && v <= 1);
    R.check(
      rangoOk,
      `aVida en [0,1] (${JSON.stringify(base1.vidaAMuestra)})`,
      `aVida fuera de rango: ${JSON.stringify(base1.vidaAMuestra)} — BUG`
    );
    const vida1 = base1.vidaAMuestra;
    R.check(
      !!vida0 && JSON.stringify(vida0) !== JSON.stringify(vida1),
      'vidaA se actualiza por frame (muestra distinta entre estado 0 y 1)',
      'vidaA nunca varía — la punta no se está afinando — BUG'
    );
  }
  R.check(
    fallosPagina.length === 0,
    'sin errores de página (el shader parcheado compila)',
    `errores de página: ${fallosPagina.slice(0, 3).join(' | ')} — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}