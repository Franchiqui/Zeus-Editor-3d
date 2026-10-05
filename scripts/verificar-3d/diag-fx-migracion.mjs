/**
 * DIAG FX MIGRACION — Proyecto v3 (FX global) migrado a efectos por objeto:
 * 1. fxConfig con fuego+humo encendidos y configObjectId → al abrir, el
 *    dueño recibe SUS efectos (fire con fireCount 200, smoke con 180) y
 *    el otro objeto queda sin efectos.
 * 2. El fxConfig queda todo-apagado (el visor ya no lo aplica).
 * 3. La pista de efecto legacy (sin objectId) sigue ahí y apunta a un
 *    objeto válido (o null = activo).
 */
import {
  abrirEditor,
  esperar,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX MIGRACION · v3 global → efectos por objeto');

const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles(
    '[data-testid="zeus-file-input"]',
    'scripts/verificar-3d/fixtures/diag-fx-migracion.zeus'
  );
  await esperar(4000);

  const out = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      let objetos = null;
      let fx = undefined;
      const pistas = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length && !objetos) {
          objetos = p.sceneObjects.map((o) => ({
            id: o.id,
            name: o.name,
            efectos: (o.efectos ?? []).map((e) => ({ tipo: e.tipo, activo: e.activo, params: e.params ?? {} })),
          }));
        }
        if (p && p.fxConfig && typeof p.fxConfig === 'object') fx = p.fxConfig;
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (objetos) return { objetos, fx };
    }
    return { objetos: null, fx: undefined };
  });
  console.log('  · volcado=' + JSON.stringify(out, null, 2));

  const dueño = out.objetos?.[0];
  const otro = out.objetos?.[1];
  R.check(!!out.objetos, 'escena cargada (2 objetos)', 'no se pudo leer la escena — BUG');
  if (out.objetos) {
    const fuego = dueño.efectos.find((e) => e.tipo === 'fire');
    const humo = dueño.efectos.find((e) => e.tipo === 'smoke');
    R.check(
      !!fuego && fuego.activo && fuego.params.fireCount === 200,
      'el dueño hereda fuego del fxConfig global (fireCount 200)',
      'el dueño no heredó el fuego: ' + JSON.stringify(dueño) + ' — BUG'
    );
    R.check(
      !!humo && humo.activo && humo.params.smokeCount === 180,
      'el dueño hereda humo del fxConfig global (smokeCount 180)',
      'el dueño no heredó el humo: ' + JSON.stringify(dueño) + ' — BUG'
    );
    R.check(
      (otro.efectos ?? []).length === 0,
      'el otro objeto NO recibe efectos (solo el dueño)',
      'el otro objeto recibió efectos de más: ' + JSON.stringify(otro) + ' — BUG'
    );
    R.check(
      out.fx && !out.fx.fire && !out.fx.smoke && !out.fx.glow && !out.fx.rain,
      'el fxConfig migrado queda todo-apagado',
      'el fxConfig NO quedó apagado: ' + JSON.stringify(out.fx) + ' — BUG'
    );
  }

  // Pista legacy: sigue existiendo y apunta a un objeto válido o al activo.
  const pistas = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const vistos = new Map();
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.effectTracks)) {
          for (const tr of p.effectTracks) {
            vistos.set(tr.id, { id: tr.id, effectType: tr.effectType, objectId: tr.objectId ?? null });
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (vistos.size > 0) return [...vistos.values()];
    }
    return [];
  });
  console.log('  · pistas=' + JSON.stringify(pistas));
  const legacy = pistas.find((t) => t.id === 'etrack-legacy');
  R.check(
    !!legacy,
    'la pista de efecto legacy sigue cargada',
    'la pista legacy se perdió al abrir — BUG'
  );
  R.check(
    !!legacy && (legacy.objectId === null || out.objetos.some((o) => o.id === legacy.objectId)),
    'la pista legacy apunta a un objeto válido (o al activo): ' + JSON.stringify(legacy),
    'la pista legacy quedó apuntando a un objeto inexistente — BUG'
  );
} finally {
  await R.resumen({ browser, errores });
}