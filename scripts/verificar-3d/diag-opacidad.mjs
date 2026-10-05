/**
 * DIAG OPACIDAD — animar la opacidad de UN objeto en el editor de
 * movimiento NO debe bajar la opacidad de los demás. Antes: la opacidad
 * animada se aplicaba recorriendo TODO el meshGroup → la escena entera
 * se desvanecía. Ahora: solo el duplicado del objeto animado.
 *
 *  1. Se crean DOS objetos («HOLA» + «Nuevo objeto» + «OTRO»).
 *  2. En el editor de movimiento: pista de transformación + Auto-clave
 *     + opacidad del campo a 0 → fotograma en t=0 con o=0.
 *  3. Vuelco de opacidades de materiales por objeto: UN objeto ~0 y el
 *     OTRO sigue ~1. Si los dos están a 0 → BUG (opacidad global).
 *  4. Scrub a 1.6 s → el reparto se mantiene.
 *  5. Vista frontal: el objeto no animado siga pintando tinta.
 *  6. «Detener» → restauración: las dos vuelven a ~1.
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

const R = crearResultados('DIAG OPACIDAD · animada solo al objeto animado');

const { browser, page, errores } = await abrirEditor();

/**
 * Vuelco de opacidades via React fiber: busca el grupo de mallas (tiene
 * hijos con userData.sceneObjectDuplicate) y, por objeto, las opacidades
 * distintas de sus THREE.Mesh.
 */
const volcarOpacidades = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const res = { objetos: null, selId: null };
      const esSel = (p) =>
        p &&
        typeof p.selectedObjectId !== 'undefined' &&
        typeof p.onObjectSelect === 'function' &&
        Array.isArray(p.objects);
      const visit = (fib, prof) => {
        if (!fib || prof > 70) return;
        const p = fib.memoizedProps;
        if (esSel(p)) {
          res.selId = p.selectedObjectId ?? null;
          const listaObj = p.objects ?? [];
          let n = fib.memoizedState;
          for (let i = 0; i < 400 && n; i++, n = n.next) {
            const cur = n.memoizedState?.current;
            if (
              cur &&
              typeof cur === 'object' &&
              Array.isArray(cur.children) &&
              cur.children.some((c) => c.userData?.sceneObjectDuplicate)
            ) {
              const filas = [];
              // El objeto ACTIVO se dibuja en la malla PRINCIPAL (hijos
              // sin etiqueta de duplicado, viewer-3d ~8036) — capturarlo.
              const opsPrincipales = new Set();
              for (const child of cur.children) {
                if (child.userData?.sceneObjectDuplicate) continue;
                child.traverse((it) => {
                  if (it.isMesh && it.material) {
                    const mats = Array.isArray(it.material) ? it.material : [it.material];
                    for (const m of mats) opsPrincipales.add(+Number(m.opacity).toFixed(3));
                  }
                });
              }
              if (opsPrincipales.size > 0) {
                filas.push({
                  id: (p.selectedObjectId ?? 'main').slice(-6),
                  anim: true,
                  ops: [...opsPrincipales],
                  nombre: 'PRINCIPAL (seleccionado)',
                });
              }
              for (const dup of cur.children) {
                const oid = dup.userData?.sceneObjectId;
                if (!oid) continue;
                const ops = new Set();
                dup.traverse((it) => {
                  if (it.isMesh && it.material) {
                    const mats = Array.isArray(it.material) ? it.material : [it.material];
                    for (const m of mats) ops.add(+Number(m.opacity).toFixed(3));
                  }
                });
                const obj = listaObj.find((o) => o.id === oid);
                filas.push({
                  id: oid.slice(-6),
                  anim: false,
                  ops: [...ops],
                  nombre: obj?.name ?? '',
                });
              }
              res.objetos = filas;
            }
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (res.objetos && res.objetos.length > 0) return res;
    }
    return null;
  });

/** ¿Un objeto a ~0 y los RESTOS se quedan como su base (por id)? */
const repartoCorrecto = (datos, basePorId) => {
  if (!datos || datos.objetos.length < 2) return false;
  const animada = datos.objetos.find((o) => o.anim);
  if (!animada || !animada.ops.every((x) => x < 0.05)) return false;
  return datos.objetos
    .filter((o) => !o.anim)
    .every((o) => {
      const base = basePorId.get(o.id);
      return (
        base &&
        o.ops.length === base.length &&
        o.ops.every((v, i) => Math.abs(v - base[i]) < 0.05)
      );
    });
};

try {
  // ------------------------------------------------ 1. dos objetos
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="new-object-btn"]');
  // Su onSelect hace preventDefault: Radix DEJA el menú abierto y su
  // capa capta los punteros → cerrarlo con Escape.
  await page.keyboard.press('Escape');
  await esperar(700);
  // El menú Radix se cierra al elegir; «OTRO» crea el segundo objeto.
  await escribirTexto(page, 'OTRO');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  const n = await numObjetos(page);
  R.check(n >= 2, `dos objetos creados (${n})`, `faltan objetos (${n}) — FLUJO`);
  const baseTinta = (await medirFrontal(page))?.tinta ?? 0;
  R.check(baseTinta > 500, `tinta base con 2 objetos (${baseTinta})`, `tinta base baja (${baseTinta}) — FLUJO`);

  // --------------------- 2. editor de movimiento + pista + auto-clave
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);
  await page.getByText('Añadir pista de transformación', { exact: true }).first().click();
  await esperar(1200);

  // Base SIN animar: opacidades por objeto antes de tocar nada (el por
  // defecto del mesh es 0.85, no 1).
  const antes = await volcarOpacidades();
  const basePorId = new Map(
    (antes?.objetos ?? []).map((o) => [o.id, o.ops])
  );

  await page.click('[data-testid="autokey-toggle"]');
  await esperar(500);
  const campoOpacidad = page
    .locator('fieldset', { has: page.locator('legend', { hasText: 'Opacidad' }) })
    .locator('input[type="number"]')
    .first();
  await campoOpacidad.fill('0');
  await esperar(1200); // fotograma con o=0 en t=0 + onApplyOpacity

  // ------------------------------------------ 3. reparto de opacidades
  let datos = await volcarOpacidades();
  console.log('t=0:', JSON.stringify(datos));
  R.check(
    repartoCorrecto(datos, basePorId),
    `t=0: el objeto animado a ~0 y el OTRO se queda como su base (${JSON.stringify(datos?.objetos)})`,
    `t=0 opacidades MAL repartidas: ${JSON.stringify(datos?.objetos)} — BUG (¿globales?)`
  );

  // --------------------------------------------------- 4. scrub a 1.6s
  const zona = page.locator('[data-testid=motion-timeline-area]').first();
  const zbox = await zona.boundingBox();
  if (zbox) {
    await page.mouse.click(zbox.x + 128, zbox.y + 14);
    await esperar(600);
  }
  datos = await volcarOpacidades();
  console.log('t≈1.6:', JSON.stringify(datos));
  R.check(
    repartoCorrecto(datos, basePorId),
    'tras scrub a 1.6 s el reparto se mantiene (un ~0, otro como su base)',
    `tras scrub el reparto se pierde: ${JSON.stringify(datos?.objetos)} — BUG`
  );

  // ------------------------------------------------ 5. tinta frontaL
  const tintaTras = (await medirFrontal(page))?.tinta ?? 0;
  R.check(
    tintaTras >= baseTinta * 0.35,
    `el objeto NO animado sigue pintando en pantalla (${tintaTras} de ${baseTinta})`,
    `la escena quedó DESVANECIDA (${tintaTras} de ${baseTinta}) — BUG`
  );

  // -------------------- 6. cerrar el editor → nada queda global
  // (fijar la opacidad con Auto-clave TAMBIÉN cambia la opacidad estática
  // del objeto animado — onApplyOpacity —: quedarse en 0 es correcto. Lo
  // que hay que asegurar es que los DEMÁS sigan en su base).
  await page.locator('[title="Cerrar editor de movimiento"]').first().click();
  await esperar(1200);
  datos = await volcarOpacidades();
  console.log('tras cerrar:', JSON.stringify(datos));
  const restosEnBase =
    datos?.objetos?.length > 0 &&
    datos.objetos
      .filter((o) => !o.anim)
      .every((o) => {
        const base = basePorId.get(o.id);
        return (
          base &&
          o.ops.length === base.length &&
          o.ops.every((v, i) => Math.abs(v - base[i]) < 0.05)
        );
      });
  R.check(
    restosEnBase,
    'al cerrar el editor los objetos NO animados sigan en su base (nada global)',
    `al cerrar el editor quedaron opacidades cambiadas fuera del animado: ${JSON.stringify(datos?.objetos)} — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}