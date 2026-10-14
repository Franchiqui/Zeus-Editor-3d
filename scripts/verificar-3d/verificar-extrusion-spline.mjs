// verificar-extrusion-spline.mjs: checks numéricos del MODO EXTRUSIÓN
// SPLINE. La captura de una ventana entra como plantilla; el trazo calcado
// se vuelve objeto con mapeaColocacionExtrusion. Aquí se comprueba, con
// metas sintéticas (front/side/top/3d + plantilla a escala), que:
// - el objeto acaba en el sitio exacto del trazo dentro de la vista,
// - su tamaño de mundo es el del calcado (escala POR EJE: la malla extraída
//   normaliza su bbox a −1..1),
// - la rotación mapea la tapa de la malla hacia la ventana capturada,
// - y la malla extraída colocada reproduce el trazo (bbox mundo).
import { mapeaColocacionExtrusion, buildExtrudeMesh } from './.extrusion-spline-bundle.mjs';
import * as THREE from 'three';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// Metas sintéticas. VENTANA CUADRADA (aspecto = 1, zoom = 1): half-height
// ALTURA_BASE_PLANO = 2.2779 → el contenido abarca 4.5558 en mundo.
const ALTO = 2.2779 * 2;
const metaBase = (extra = {}) => {
  const base = {
    vista: 'front',
    dataURL: 'data:image/png;base64,x',
    px: 800, pxW: 800, pxH: 800,
    centro: { x: 0, y: 0, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    spanX: ALTO, spanY: ALTO,
    ...extra,
  };
  return { ...base, rotDeg: rotDegDe(base.right, base.up) };
};
const cuadrado = (cx, cy, lado) => {
  const h = lado / 2;
  return [
    { x: cx - h, y: cy - h }, { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h },
  ];
};
const R = (c) => new THREE.Matrix4().makeRotationFromEuler(
  new THREE.Euler(c.rx, c.ry, c.rz, 'XYZ')
);
// rotDeg tal como la calcula Viewer3D para la captura: makeBasis del eje
// pantalla y Euler XYZ de esa matriz.
const rotDegDe = (right, up) => {
  const r = new THREE.Vector3(right.x, right.y, right.z);
  const u = new THREE.Vector3(up.x, up.y, up.z);
  const capN = r.clone().cross(u).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(r, u, capN), 'XYZ'
  );
  return [e.x * 180 / Math.PI, e.y * 180 / Math.PI, e.z * 180 / Math.PI];
};
// Aplica el transform de la colocación a la malla y saca su bbox mundo.
const bboxMundo = (malla, c) => {
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(c.px, c.py, c.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rx, c.ry, c.rz, 'XYZ')),
    new THREE.Vector3(c.sx, c.sy, c.sz)
  );
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const v of malla.vertices) {
    // La malla guardada es Y arriba-abajo invertida (y = 1−2q) YA aplicado;
    // los vértices son xyz directos aquí.
    const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(M);
    mn = [Math.min(mn[0], p.x), Math.min(mn[1], p.y), Math.min(mn[2], p.z)];
    mx = [Math.max(mx[0], p.x), Math.max(mx[1], p.y), Math.max(mx[2], p.z)];
  }
  return { mn, mx };
};

// Vista front, ventana cuadrada: trazo de un cubo de 1×1 centrado.
// En pantalla ocupa media fracción lado/ALTO → el trazo (escala 1 de la
// plantilla) queda en unidades de lienzo u ∈ 0.5 ± 0.5/ALTO.
{
  const lado = 1;
  const trazo = cuadrado(0.5, 0.5, lado / ALTO);
  const c = mapeaColocacionExtrusion(trazo, metaBase());
  revisar(cerca(c.px, 0) && cerca(c.py, 0) && cerca(c.pz, 0), `front · cubo 1×1 centrado → en el origen (${c.px.toFixed(4)}, ${c.py.toFixed(4)}, ${c.pz.toFixed(4)})`);
  revisar(cerca(c.rx, 0) && cerca(c.ry, 0) && cerca(c.rz, 0), 'front · sin giro');
  revisar(cerca(c.sx, 0.5) && cerca(c.sy, 0.5) && cerca(c.sz, 1), `front · escala 0.5/0.5/1 (${c.sx.toFixed(4)}, ${c.sy.toFixed(4)}, ${c.sz})`);
  // Con la malla extraída profundidad 0.6, el bbox mundo debe ser el trazo:
  const malla = buildExtrudeMesh({ front: trazo, side: [], top: [] }, 0.6);
  const bb = bboxMundo(malla, c);
  revisar(cerca(bb.mn[0], -0.5) && cerca(bb.mx[0], 0.5) && cerca(bb.mn[1], -0.5) && cerca(bb.mx[1], 0.5), `front · bbox X/Y = trazo (±0.5, ${bb.mn[0].toFixed(3)}..${bb.mx[0].toFixed(3)})`);
  revisar(cerca(bb.mn[2], -0.6) && cerca(bb.mx[2], 0), `front · profundidad 0.6 desde la tapa (${bb.mn[2].toFixed(3)}..${bb.mx[2].toFixed(3)})`);
}

// Trazo RECTANGULAR 2×1 (mundo): la escala por eje lo coloca sin deformar.
{
  const trazo = cuadrado(0.5, 0.5, 2 / ALTO); // cuadrado del TEST, abajo el real
  const ladoX = 2, ladoY = 1;
  const a = { x: ladoX / 2 / ALTO, y: ladoY / 2 / ALTO };
  trazo.length = 0;
  trazo.push(
    { x: 0.5 - a.x, y: 0.5 - a.y }, { x: 0.5 + a.x, y: 0.5 - a.y },
    { x: 0.5 + a.x, y: 0.5 + a.y }, { x: 0.5 - a.x, y: 0.5 + a.y }
  );
  const c = mapeaColocacionExtrusion(trazo, metaBase());
  revisar(cerca(c.sx, 1) && cerca(c.sy, 0.5), `rect 2×1 → escala 1/0.5 sin deformar (${c.sx.toFixed(4)}, ${c.sy.toFixed(4)})`);
}

// Fuera de centro: trazo pegado a la izquierda de la ventana.
{
  const lado = 1;
  const trazo = cuadrado(0.25, 0.5, lado / ALTO);
  const c = mapeaColocacionExtrusion(trazo, metaBase());
  const esperadoX = (0.25 - 0.5) * ALTO;
  revisar(cerca(c.px, esperadoX), `trazo descentrado → x mundo ${esperadoX.toFixed(4)} (${c.px.toFixed(4)})`);
}

// Plantilla agrandada a escala 2 (el usuario la agranda para calcar más
// cómodo): el MISMO objeto calcado con la mitad de fracciones da lo mismo.
{
  const lado = 1;
  const trazo = cuadrado(0.5, 0.5, lado / ALTO);
  const c1 = mapeaColocacionExtrusion(trazo, metaBase(), { escala: 1, offset: { x: 0, y: 0 } });
  // Con la plantilla a escala 2, la copia del mismo objeto ocupa el doble:
  const trazo2 = cuadrado(0.5, 0.5, (lado / ALTO) * 2);
  const c2 = mapeaColocacionExtrusion(trazo2, metaBase(), { escala: 2, offset: { x: 0, y: 0 } });
  revisar(cerca(c1.px, c2.px) && cerca(c1.py, c2.py) && cerca(c1.sx, c2.sx) && cerca(c1.sy, c2.sy), 'plantilla a escala 2 → misma colocación (trazo proporcional)');
}

// Ventana SIDE (costado derecho): pantalla-derecha = −Z (mundo), arriba = +Y.
// La captura calca el objeto visto de costado; la tapa de la malla debe
// mirar hacia +X (hacia la cámara de esa ventana).
{
  const lado = 1;
  const trazo = cuadrado(0.5, 0.5, lado / ALTO);
  const c = mapeaColocacionExtrusion(trazo, metaBase({
    vista: 'side', right: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 },
  }));
  revisar(cerca(c.ry, Math.PI / 2, 1e-4) && cerca(c.rx, 0, 1e-4) && cerca(c.rz, 0, 1e-4), `side · giro ≈ (0, 90°, 0) (${(c.ry * 180 / Math.PI).toFixed(1)}°)`);
  // La tapa (vértice z=0 de la malla) debe acabar en el plano x=0 (la
  // ventana), y el fondo a la profundidad alejándose de la cámara (−X).
  const malla = buildExtrudeMesh({ front: trazo, side: [], top: [] }, 0.6);
  const bb = bboxMundo(malla, c);
  revisar(cerca(bb.mx[0], 0, 1e-4), `side · tapa en x = 0 (fondo −X) [${bb.mn[0].toFixed(3)}..${bb.mx[0].toFixed(3)}]`);
  revisar(cerca(bb.mn[2], -0.5) && cerca(bb.mx[2], 0.5), `side · el calcado cruza Z (−Z es pantalla-derecha aquí) [${bb.mn[2].toFixed(3)}..${bb.mx[2].toFixed(3)}]`);
}

// Ventana TOP (superior): pantalla-derecha = +X, arriba de pantalla = −Z.
// La tapa debe mirar a +Y (hacia la cámara superior).
{
  const lado = 1;
  const trazo = cuadrado(0.5, 0.5, lado / ALTO);
  const c = mapeaColocacionExtrusion(trazo, metaBase({
    vista: 'top', right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: -1 },
  }));
  const malla = buildExtrudeMesh({ front: trazo, side: [], top: [] }, 0.6);
  const bb = bboxMundo(malla, c);
  revisar(cerca(bb.mx[1], 0, 1e-4), `top · tapa en y = 0 (extruye hacia abajo) [${bb.mn[1].toFixed(3)}..${bb.mx[1].toFixed(3)}]`);
  revisar(cerca(bb.mn[0], -0.5) && cerca(bb.mx[0], 0.5), `top · calcado cruza X [${bb.mn[0].toFixed(3)}..${bb.mx[0].toFixed(3)}]`);
  revisar(cerca(bb.mn[2], -0.5) && cerca(bb.mx[2], 0.5), `top · calcado cruza Z [${bb.mn[2].toFixed(3)}..${bb.mx[2].toFixed(3)}]`);
}

// Vista 3D libre: la rotación sale de las bases de la ventana. Comprueba
// que la tapa de la malla mira (aprox.) hacia la cámara: right×up.
{
  const dir = new THREE.Vector3(0.55, 0.35, -0.75).normalize();
  const ojo = dir.clone().multiplyScalar(6);
  const upRef = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(ojo, new THREE.Vector3(0, 0, 0), upRef);
  const rightV = new THREE.Vector3().setFromMatrixColumn(m, 0);
  const upV = new THREE.Vector3().setFromMatrixColumn(m, 1);
  const c = mapeaColocacionExtrusion(cuadrado(0.5, 0.5, 1 / ALTO), metaBase({
    vista: '3d', right: { x: rightV.x, y: rightV.y, z: rightV.z }, up: { x: upV.x, y: upV.y, z: upV.z },
  }));
  const M = R(c);
  const zLocal = new THREE.Vector3(0, 0, 1).applyMatrix4(M).sub(new THREE.Vector3(0, 0, 0));
  const yLocal = new THREE.Vector3(0, 1, 0).applyMatrix4(M);
  const xLocal = new THREE.Vector3(1, 0, 0).applyMatrix4(M);
  revisar(cerca(zLocal.clone().normalize().dot(rightV.clone().cross(upV).normalize()), 1, 1e-3), '3d · la tapa mira a la ventana (right×up)');
  revisar(cerca(yLocal.clone().normalize().dot(upV), 1, 1e-3) && cerca(xLocal.clone().normalize().dot(rightV), 1, 1e-3), '3d · ejes locales sobre los de pantalla');
}

// Trazo mínimo: sin calco no se coloca (el editor ya lo bloquea; la libra
// devuelve el transform identidad sin petalear).
{
  const c = mapeaColocacionExtrusion([{ x: 0 }, { x: 1, y: 0 }], metaBase());
  revisar(c && isFinite(c.sx) && c.sx > 0, 'trazo degenerado → transform válido sin crash');
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);