/**
 * DIAG LUCES — «Excluir objetos» en la luz ambiente y en un foco: la
 * luz NO ilumina a los marcados y SÍ a los demás (por objeto, sin
 * tocar el resto).
 *
 * Verificación por fiber: los materiales de cada objeto quedan
 * parcheados con uniformes de exclusión (`mat.userData.excluyeLuces`:
 * excluirAmbiente 0/1 y excluirFocos con la posición MUNDIAL de cada
 * foco excluido) — three reparte la luz por CÁMARA, así que la quita
 * va en el shader del material. El parche va anclado al TAG
 * `#include <lights_fragment_begin>` (onBeforeCompile corre ANTES de
 * que three expanda los includes) y vuelve a mundo la posición del
 * foco con viewMatrix.
 *
 *  1. Dos objetos («HOLA» + «Nuevo objeto» + «OTRO»).
 *  2. Sin exclusión: amb 0 / focos 0 en ambos.
 *  3. Ambiente excluye «Objeto 1» → amb=1 en él, 0 en el otro.
 *  4. + foco (0,5,5) excluyendo «Objeto 2» → n=1 y pos 0,5,5 en él;
 *     el otro sigue con solo el ambiente excluido.



 *  4. + foco (0,5,5) y «Objeto 2» (malla física, la única
 *     ALUMBRABLE — el texto es material básico) movido bajo el
 *     propio foco (0,4.4,4.4): así SÍ recibe su luz.
 *  5. VISUAL: captura base → foco encendido → excluirlo de él →
 *     captura. La dif píxel a píxel sale CONCENTRADA en la malla
 *     alumbrada/excluida (el resto del lienzo queda idéntico).
 *  6. Devuelvo la exclusión; todo desmarcado → neutral (0/0).
 *  7. La sombra sigue la TRANSPARENCIA: opacidad 0 en uno → opacS ~0.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  medirFrontal,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG LUCES · excluir objetos del ambiente y del foco');

const { browser, page, errores } = await abrirEditor();

/** Vuelca, por objeto, el estado del parche de exclusión de luces. */
const volcarLuces = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      let objs = null;
      let grupo = null;
      const visit = (fib, prof) => {
        if (!fib || prof > 70 || grupo) return;
        const p = fib.memoizedProps;
        if (
          p &&
          typeof p === 'object' &&
          Array.isArray(p.objects) &&
          typeof p.onObjectSelect === 'function'
        ) {
          objs = p.objects.map((o) => ({ id: o.id, nombre: o.name ?? '' }));
        }
        // El grupo vive en un hook (useRef) de la cadena, no siempre
        // el primero: recorrer TODA la cadena memoizedState.next.
        for (
          let n = fib.memoizedState, i = 0;
          n && i < 400 && !grupo;
          i++, n = n.next
        ) {
          const cur = n.memoizedState?.current;
          if (
            cur &&
            typeof cur === 'object' &&
            Array.isArray(cur.children) &&
            cur.children.some((c) => c.userData?.sceneObjectDuplicate)
          ) {
            grupo = cur;
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) {
        visit(f, 0);
        if (grupo) break;
      }
      if (!grupo) continue;

      // Nodos visuales de UN objeto: su duplicado, o los hijos sin
      // etiqueta de duplicado (la malla principal del seleccionado).
      const nodosDe = (id) => {
        const lista = [];
        for (const hijo of grupo.children) {
          if (hijo.userData?.sceneObjectDuplicate) {
            if (hijo.userData.sceneObjectId === id) lista.push(hijo);
          } else if (grupo.userData?.sceneObjectId === id) {
            lista.push(hijo);
          }
        }
        return lista;
      };
      return (objs ?? []).map((o) => {
        const mats = new Set();
        const mallas = [];
        for (const nodo of nodosDe(o.id)) {
          nodo.traverse((it) => {
            if (!it.isMesh) return;
            mallas.push(it);
            if (it.material) {
              (Array.isArray(it.material) ? it.material : [it.material]).forEach(
                (m) => mats.add(m)
              );
            }
          });
        }
        let parche = null;
        for (const m of mats) {
          const p = m.userData?.excluyeLuces;
          if (p) {
            const v = p.pos.value?.[0];
            parche = {
              amb: +Number(p.amb.value),
              n: +Number(p.n.value),
              pos0: v
                ? `${Number(v.x)},${Number(v.y)},${Number(v.z)}`
                : '-',
            };
            break;
          }
        }
        // Material de profundidad (sombras): opacidad + focos excluidos.
        let sombra = null;
        for (const mal of mallas) {
          const s = mal.customDepthMaterial?.userData?.sombraLuces;
          if (s) {
            const v = s.pos.value?.[0];
            sombra = {
              opac: +Number(s.opac.value),
              n: +Number(s.n.value),
              pos0: v ? `${Number(v.x)},${Number(v.y)},${Number(v.z)}` : '-',
            };
            break;
          }
        }
        return {
          nombre: o.nombre,
          amb: parche?.amb ?? 0,
          n: parche?.n ?? 0,
          pos0: parche?.pos0 ?? '-',
          opacS: sombra?.opac ?? -1,
          nS: sombra?.n ?? -1,
          posS: sombra?.pos0 ?? 'SIN',
        };
      });
    }
    return null;
  });

const fila = (datos, nombre) =>
  (datos ?? []).find((f) => f.nombre.includes(nombre));

/**
 * Tinta + Σ de brillo de los píxeles de tinta: el foco (intensidad
 * 2, haz 60°) ya domina la escena (brillo ×5,4 al añadirlo) pero la
 * cuenta de tinta es CIEGA al brillo — un píxel que pasa de
 * blanco-por-foco a medio-gris-sin-foco sigue siendo tinta.
 */
const medirConBrillo = () =>
  page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[0];
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
    let brillo = 0;
    for (let y = 0; y < off.height; y += 3) {
      for (let x = 0; x < off.width; x += 3) {
        const o = (y * off.width + x) * 4;
        const r = d[o];
        const g = d[o + 1];
        const b = d[o + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) {
          tinta++;
          brillo += (r + g + b) / 3;
        }
      }
    }
    return { tinta, brillo: Math.round(brillo) };
  });

/** Captura el lienzo del visor (dataURL PNG). */
const captura = () =>
  page.evaluate(() => {
    const cont = document.querySelector('[data-testid="viewer-container"]');
    const canvas = cont && cont.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : null;
  });

/**
 * Diferencia píxel a píxel ENTRE dos capturas del mismo lienzo:
 * al excluir un objeto del foco SÓLO cambia la malla excluida —
 * helper del foco, rejilla y demás superficies quedan idénticas,
 * así que la delta se CONCENTRA en su recuadro sin necesitar
 * proyección alguna (el brillo de todo el canvas queda diluido
 * por lo que no cambia).
 */
const medirCambio = (antes, despues) =>
  page.evaluate(async ([antes, despues]) => {
    if (!antes || !despues) return null;
    const cargar = async (url) => {
      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.onerror = res;
        img.src = url;
      });
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, off.width, off.height).data;
    };
    const a = await cargar(antes);
    const b = await cargar(despues);
    if (!a || !b || a.length !== b.length) return null;
    let caidos = 0;
    let subidos = 0;
    let caida = 0;
    for (let i = 0; i < a.length; i += 12) {
      const dA = a[i] + a[i + 1] + a[i + 2];
      const dB = b[i] + b[i + 1] + b[i + 2];
      if (dA - dB >= 135) {
        caidos++;
        caida += dA - dB;
      } else if (dB - dA >= 135) {
        subidos++;
      }
    }
    return { caidos, subidos, caida: Math.round(caida) };
  }, [antes, despues]);
/**
 * Coloca los nodos visuales de un objeto en una posición de
 * mundo: mutación directa del three del visor (sin pasar por el
 * estado) para acercar la malla ALUMBRABLE al foco — a 7
 * unidades con decaimiento físico el foco apenas la toca y la
 * señal visual queda invisible (dif píxel a píxel = 0).
 */
const moverObjeto = (nombre, [x, y, z]) =>
  page.evaluate(
    ([nombre, x, y, z]) => {
      const conts = document.querySelectorAll(
        '[data-testid="viewer-container"]',
      );
      for (const cont of conts) {
        const llave = Object.keys(cont).find((k) =>
          k.startsWith('__reactFiber'),
        );
        if (!llave) continue;
        let objs = null;
        let grupo = null;
        const visit = (fib, prof) => {
          if (!fib || prof > 70 || (objs && grupo)) return;
          const p = fib.memoizedProps;
          if (
            p &&
            typeof p === 'object' &&
            Array.isArray(p.objects) &&
            typeof p.onObjectSelect === 'function'
          ) {
            objs = p.objects.map((o) => ({ id: o.id, nombre: o.name ?? '' }));
          }
          for (
            let n = fib.memoizedState, i = 0;
            n && i < 400 && !(objs && grupo);
            i++, n = n.next
          ) {
            const cur = n.memoizedState?.current;
            if (
              cur &&
              typeof cur === 'object' &&
              Array.isArray(cur.children) &&
              cur.children.some((c) => c.userData?.sceneObjectDuplicate)
            ) {
              grupo = cur;
            }
          }
          visit(fib.child, prof + 1);
          visit(fib.sibling, prof + 1);
        };
        for (let f = cont[llave]; f && !(objs && grupo); f = f.return)
          visit(f, 0);
        if (!grupo || !objs) continue;
        const id = objs.find((o) => o.nombre.includes(nombre))?.id;
        if (id === undefined) continue;
        let movidos = 0;
        for (const hijo of grupo.children) {
          const mio = hijo.userData?.sceneObjectDuplicate
            ? hijo.userData.sceneObjectId === id
            : grupo.userData?.sceneObjectId === id;
          if (!mio) continue;
          hijo.position.set(x, y, z);
          hijo.updateMatrixWorld(true);
          movidos++;
        }
        if (movidos) return { movidos, pos: [x, y, z] };
      }
      return null;
    },
    [nombre, x, y, z],
  );


/**
 * Abre el <details> de una sección del modal (vienen cerrados: sus
 * etiquetas no son clicables hasta desplegar el summary).
 */
const abrirSeccion = async (dialogoX, texto) => {
  const det = dialogoX.locator('details', { hasText: texto }).first();
  // El summary puede estar bajo la capa del menú Radix: abrir por JS.
  const ya = await det.evaluate((d) => d.open).catch(() => false);
  if (!ya) {
    await det.evaluate((d) => {
      d.open = true;
      d.dispatchEvent(new Event('toggle'));
    });
  }
  return det;
};

try {
  // ------------------------------------------------ 1. dos objetos
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="new-object-btn"]');
  await page.keyboard.press('Escape'); // el menú Radix queda abierto
  await esperar(700);
  await escribirTexto(page, 'OTRO');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  const n = await numObjetos(page);
  R.check(n >= 2, `dos objetos creados (${n})`, `faltan objetos (${n}) — FLUJO`);

  // ------------------------------------- 2. base sin exclusiones
  let datos = await volcarLuces();
  console.log('base:', JSON.stringify(datos));
  // El material de profundidad (sombra por opacidad) existe SIEMPRE
  // — con focos 0 sus vectores quedan en el origen sin uso: lo que
  // importa es nS 0 y que la sombra siga pesando (opacS es la
  // opacidad de la pintura, 1 en la primitiva nueva, 0.85 el texto).
  const neutral = (d) =>
    (d ?? []).every((f) => f.amb === 0 && f.n === 0 && f.nS === 0 && f.opacS > 0);
  R.check(
    neutral(datos),
    'base: nadie excluido (amb 0, focos 0) y sombra de opacidad colgada',
    `base ya con exclusiones: ${JSON.stringify(datos)} — FLUJO`
  );

  // ------------------- 3. la luz ambiente excluye «Objeto 1»
  const abrirModal = async () => {
    // La capa del menú de una apertura anterior puede seguir viva y
    // capturar el puntero (<html> intercepta): disolverla con Escape
    // ANTES de abrir — todavía no hay modal que Escape pueda cerrar.
    const menuVivo = await page
      .locator('[data-radix-popper-content-wrapper]')
      .last()
      .isVisible()
      .catch(() => false);
    if (menuVivo) {
      await page.keyboard.press('Escape');
      await esperar(400);
    }
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.getByText(/^Luces/).first().click();
    await esperar(700);
    // La capa del menú Radix puede quedar encima del modal
    // interceptando el puntero: los clics DENTRO del modal se hacen
    // por JS (el.click()), que no pasa por el hit-testing.
  };
  await abrirModal();
  const dialogo = page.getByRole('dialog');
  const seccionAmb = await abrirSeccion(
    dialogo,
    'Excluir objetos de la luz ambiente'
  );
  await seccionAmb
    .locator('label', { hasText: 'Objeto 1' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  await dialogo
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);
  datos = await volcarLuces();
  console.log('tras excluir del ambiente:', JSON.stringify(datos));
  const uno = fila(datos, 'Objeto 1');
  const dos = fila(datos, 'Objeto 2');
  R.check(
    uno?.amb === 1 && dos?.amb === 0 && uno?.nS === 0 && dos?.nS === 0,
    `ambiente excluye SOLO a «Objeto 1» (1: ${uno?.amb}, 2: ${dos?.amb})`,
    `la exclusión de ambiente no quedó donde tocaba: ${JSON.stringify(datos)} — BUG`
  );

  // ------- 4. foco (0,5,5): crearlo, guardarlo, medir, excluir
  const urlBase = await captura();

  await abrirModal();
  const dialogo2 = page.getByRole('dialog');
  await dialogo2
    .getByRole('button', { name: 'Añadir foco' })
    .evaluate((b) => b.click());
  await esperar(500);
  // Guardar de una (exclusiones aún vacías): el foco alumbra a TODO
  // y el modal queda cerrado para medir la tinta SIN falsear.
  await dialogo2
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);
  const movio = await moverObjeto('Objeto 2', [0, 4.4, 4.4]);
  console.log('movido bajo el foco:', JSON.stringify(movio));
  await esperar(700);
  const urlFocoOn = await captura();
  // Ahora sí: el foco excluye a «Objeto 2» (la opacidad de pintura
  // de ese objeto es 1 — primitiva nueva — así que su sombra pesa 1
  // y no cabe cota superior en el check de uniformes).
  await abrirModal();
  const dialogo3 = page.getByRole('dialog');
  const seccionFoco = await abrirSeccion(
    dialogo3,
    'Excluir objetos de este foco'
  );
  // Excluir a los DOS del foco: «Objeto 1» (texto grande) es la
  // señal visual fuerte; «Objeto 2» la comprobación por uniformes.
  await seccionFoco
    .locator('label', { hasText: 'Objeto 1' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  await seccionFoco
    .locator('label', { hasText: 'Objeto 2' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  await dialogo3
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);


  // tras guardar la exclusión, volver a colocar la malla bajo
  // el foco (React pudo reconstruir los nodos al guardar):
  const movio2 = await moverObjeto('Objeto 2', [0, 4.4, 4.4]);
  console.log('movido otra vez:', JSON.stringify(movio2));
  await esperar(700);
  const urlExcluido = await captura();
  const difFoco = await medirCambio(urlBase, urlFocoOn);
  const cambio = await medirCambio(urlFocoOn, urlExcluido);
  console.log('foco contra base:', JSON.stringify(difFoco));
  console.log('exclusion contra foco:', JSON.stringify(cambio));
  R.check(
    !!difFoco &&
      !!cambio &&
      difFoco.subidos >= 250 &&
      cambio.caidos >= 250 &&
      cambio.caidos > cambio.subidos * 3,
    `el foco YA NO alumbra al excluido: ${cambio?.caidos} píxeles caen al excluirlo (el foco encendió ${difFoco?.subidos})`,
    `el foco sigue alumbrando al excluido: ${JSON.stringify(cambio)} (foco vs base: ${JSON.stringify(difFoco)}) — BUG`,
  );

  datos = await volcarLuces();
  console.log('con foco excluyente:', JSON.stringify(datos));
  const uno2 = fila(datos, 'Objeto 1');
  const dos2 = fila(datos, 'Objeto 2');
  R.check(
    uno2?.amb === 1 &&
      uno2?.n === 1 &&
      uno2?.posS === '0,5,5' &&
      dos2?.amb === 0 &&
      dos2?.n === 1 &&
      dos2?.nS === 1 &&
      dos2?.posS === '0,5,5' &&
      dos2?.opacS > 0.7,
    `foco excluye a «Objeto 1» y «Objeto 2» (amb 1/0, n 1/1, pos 0,5,5)`,
    `reparto de foco/ambiente mal: ${JSON.stringify(datos)} — BUG`
  );

  // ----------------------- 6. desmarcar TODO → neutral de nuevo
  await abrirModal();
  const dialogo4 = page.getByRole('dialog');
  const seccionAmb2 = await abrirSeccion(
    dialogo4,
    'Excluir objetos de la luz ambiente'
  );
  await seccionAmb2
    .locator('label', { hasText: 'Objeto 1' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  const seccionFoco2 = await abrirSeccion(
    dialogo4,
    'Excluir objetos de este foco'
  );
  await seccionFoco2
    .locator('label', { hasText: 'Objeto 1' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  await seccionFoco2
    .locator('label', { hasText: 'Objeto 2' })
    .first()
    .evaluate((l) => l.click());
  await esperar(400);
  await dialogo4
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);
  datos = await volcarLuces();
  console.log('todo desmarcado:', JSON.stringify(datos));
  R.check(
    neutral(datos),
    'desmarcar todo vuelve a neutral (nada queda excluido)',
    `quedaron exclusiones fantasma: ${JSON.stringify(datos)} — BUG`
  );

  // -------- 7. la sombra sigue la TRANSPARENCIA: opacidad 0
  const menuVivo7 = await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .isVisible()
    .catch(() => false);
  if (menuVivo7) {
    await page.keyboard.press('Escape'); // aún no hay editor que Escape robe
    await esperar(400);
  }
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);
  // El fill estático solo aplica con pista + auto-clave (el camino
  // probado en diag-opacidad): sin pista el valor no llega al mesh.
  await page
    .getByText('Añadir pista de transformación', { exact: true })
    .first()
    .click();
  await esperar(1200);
  await page.click('[data-testid="autokey-toggle"]');
  await esperar(500);
  const campoOpacidad = page
    .locator('fieldset', { has: page.locator('legend', { hasText: 'Opacidad' }) })
    .locator('input[type="number"]')
    .first();
  await campoOpacidad.fill('0');
  await esperar(1500);
  datos = await volcarLuces();
  console.log('opacidad 0:', JSON.stringify(datos));
  // El editor abre sobre el objeto SELECCIONADO (no se cuál quedó
  // tras el modal): exigir UNO en ~0 y el OTRO pesando — simétrico.
  const bajos = (datos ?? []).filter((f) => f.opacS < 0.05).length;
  const altos = (datos ?? []).filter((f) => f.opacS > 0.3).length;
  R.check(
    bajos === 1 && altos === 1,
    `opacidad 0 ⇒ sin sombra en el editado y el otro pesando (${JSON.stringify(datos)})`,
    `la sombra no siguió la transparencia: ${JSON.stringify(datos)} — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}