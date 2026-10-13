import type { Mesh, ObjectTransform, Vertex3D } from '@/lib/geometry';
import { construirAnillos } from '@/lib/geometry';
import { smoothVoxelMesh } from '@/lib/mesh-smooth';
import { DEFORMADORES } from '@/lib/plugins/builtin/deformadores';
import type { PluginParam, PluginParams } from '@/lib/plugins/types';

/**
 * Deformadores directos del editor (botones junto a «Seleccionar
 * polígonos/aristas/puntos»). Igual que los plugins (lib/plugins), cada
 * uno transforma la malla SIN mutarla y conserva caras, colores y
 * texturas por cara. La diferencia es la presentación: botones con icono
 * en la cabecera, vista previa en vivo y panel de campos en la pestaña
 * Escena.
 */

export type DeformadorId =
  | 'doblar'
  | 'enroscar'
  | 'bisel'
  | 'hinchar'
  | 'sesgar'
  | 'suavizado'
  | 'afilar'
  | 'derretir'
  | 'romper'
  | 'bisel-plano';

export interface DeformadorDirecto {
  id: DeformadorId;
  /** Nombre visible (título del botón). */
  nombre: string;
  /** Icono del botón: el usuario lo coloca en /icons/<Nombre>.png. */
  icono: string;
  /** Controles del panel (contrato PluginParam de los plugins). */
  params: PluginParam[];
  /** Devuelve una malla NUEVA; no debe mutar la recibida. */
  aplicar: (mesh: Mesh, params: PluginParams) => Mesh;
}

/* ------------------------------------------------------------------ */
/* Helpers locales (espejo de los de lib/plugins/builtin/deformadores) */
/* ------------------------------------------------------------------ */

type Eje = 'x' | 'y' | 'z';

const EJES: Array<{ valor: Eje; etiqueta: string }> = [
  { valor: 'x', etiqueta: 'X (horizontal)' },
  { valor: 'y', etiqueta: 'Y (vertical)' },
  { valor: 'z', etiqueta: 'Z (profundidad)' },
];

const num = (params: PluginParams, id: string, porDefecto = 0) => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};

const ejeDe = (params: PluginParams, id: string, porDefecto: Eje): Eje => {
  const v = params[id];
  return v === 'x' || v === 'y' || v === 'z' ? v : porDefecto;
};

const leerEje = (v: Vertex3D, e: Eje) =>
  e === 'x' ? v.x : e === 'y' ? v.y : v.z;

function conEje(v: Vertex3D, e: Eje, valor: number): Vertex3D {
  const copia = { ...v };
  if (e === 'x') copia.x = valor;
  else if (e === 'y') copia.y = valor;
  else copia.z = valor;
  return copia;
}

function ejesTransversales(e: Eje): [Eje, Eje] {
  if (e === 'x') return ['y', 'z'];
  if (e === 'y') return ['x', 'z'];
  return ['x', 'y'];
}

function caja(mesh: Mesh, e: Eje) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of mesh.vertices) {
    const a = leerEje(v, e);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return { min, max, centro: (min + max) / 2, extension: max - min };
}

/** Delega en el `aplicar` del plugin integrado del mismo id. */
function pluginAplicar(id: string, mesh: Mesh, params: PluginParams): Mesh {
  const p = DEFORMADORES.find((d) => d.id === id);
  return p ? p.aplicar(mesh, params) : mesh;
}

/**
 * GUÍA (dónde empieza/centra la deformación): el slider `guia` es % de la
 * caja a lo largo del eje. Con 0 (default) devuelve null y cada
 * deformador usa su ancla de siempre (el borde min de la caja) — un
 * guia:0 explícito reproduce EXACTO el comportamiento histórico y los
 * .zeus/pistas viejos no cambian con el relleno de defaults. Con 1..100
 * devuelve la coordenada local del guía.
 */
function guiaDe(mesh: Mesh, params: PluginParams, eje: Eje): number | null {
  const g = num(params, 'guia', 0);
  if (g <= 0) return null;
  const c = caja(mesh, eje);
  return c.min + (g / 100) * (c.max - c.min);
}

/* ------------------------------------------------------------------ */
/* Bisel (chaflán de aristas, como Chamfer/Bevel de 3ds Max)           */
/* ------------------------------------------------------------------ */

/**
 * Chaflán topológico: en cada cara, sus vértices se retraen hacia el
 * interior de la cara (radio = % de la diagonal de la caja), la cara
 * original queda retraída, cada arista gana un quad-puente y cada
 * vértice una cap de triángulos. Usa la topología canon de
 * `construirAnillos` para reconocer aristas compartidas entre caras de
 * mallas .zeus sin índices compartidos.
 */
function bisel(mesh: Mesh, params: PluginParams): Mesh {
  const radioPct = num(params, 'radio', 10);
  if (radioPct <= 0) return mesh;
  if (mesh.vertices.length === 0 || mesh.faces.length === 0) return mesh;

  const topo = construirAnillos(mesh);
  if (!topo) return mesh;
  const { canonDe, canonPos, bordeAFaces } = topo;

  // Radio absoluto: % de la diagonal de la caja envolvente.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of canonPos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const diagonal = Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
  if (!Number.isFinite(diagonal) || diagonal < 1e-9) return mesh;
  const radioAbs = (radioPct / 100) * diagonal * 0.5;
  if (radioAbs < 1e-9) return mesh;

  const nuevaVertices: Vertex3D[] = [...mesh.vertices];
  const nuevaUvs: [number, number][] | undefined = mesh.uvs
    ? [...mesh.uvs]
    : undefined;
  const colorSi = mesh.faceColors ? [...mesh.faceColors] : undefined;
  const opSi = mesh.faceOpacities ? [...mesh.faceOpacities] : undefined;
  const texSi = mesh.faceTextures ? [...mesh.faceTextures] : undefined;

  // Emisión de caras nuevas + arrays paralelos alineados.
  const caras: number[][] = [];
  const coloresFinales: (string | null)[] = [];
  const opacidadesFinales: number[] = [];
  const texturasFinales: (string | null)[] = [];
  const gruposFinales: (string | null)[] = [];
  const emite = (
    face: number[],
    donanteIdx: number
  ) => {
    caras.push(face);
    coloresFinales.push(colorSi ? colorSi[donanteIdx] ?? null : null);
    opacidadesFinales.push(opSi ? opSi[donanteIdx] ?? 1 : 1);
    texturasFinales.push(texSi ? texSi[donanteIdx] ?? null : null);
    if (mesh.faceTextureGroups) gruposFinales.push(mesh.faceTextureGroups[donanteIdx] ?? null);
  };

  /** Índice del vértice insetado de la cara fi en el vértice canon c. */
  const insetDe = new Map<string, number>();
  /** Cara donante de cada vértice insetado (para colorear los quads/caps). */
  const donanteDe = new Map<number, number>();

  // 1) Cara retraída: inserción de sus vértices hacia el centroide en
  //    el plano de la cara (normal por Newell, vale para tris y quads).
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const cara = mesh.faces[fi];
    if (cara.length < 3) continue;

    // Centroide y normal (Newell) sobre posiciones canon deduplicadas.
    const canonUnicos: number[] = [];
    const vistos = new Set<number>();
    for (const vi of cara) {
      const c = canonDe[vi];
      if (!vistos.has(c)) {
        vistos.add(c);
        canonUnicos.push(c);
      }
    }
    if (canonUnicos.length < 3) continue;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < canonUnicos.length; i++) {
      const A = canonPos[canonUnicos[i]];
      const B = canonPos[canonUnicos[(i + 1) % canonUnicos.length]];
      nx += (A.y - B.y) * (A.z + B.z);
      ny += (A.z - B.z) * (A.x + B.x);
      nz += (A.x - B.x) * (A.y + B.y);
      cx += A.x;
      cy += A.y;
      cz += A.z;
    }
    const n = canonUnicos.length;
    const largoNormal = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (largoNormal < 1e-12) continue; // cara degenerada: sin bisel
    const normal = { x: nx / largoNormal, y: ny / largoNormal, z: nz / largoNormal };
    const centro = { x: cx / n, y: cy / n, z: cz / n };

    const insetFace: number[] = [];
    for (const vi of cara) {
      const c = canonDe[vi];
      const clave = `${fi}:${c}`;
      let idx = insetDe.get(clave);
      if (idx === undefined) {
        const pos = canonPos[c];
        let dx = centro.x - pos.x;
        let dy = centro.y - pos.y;
        let dz = centro.z - pos.z;
        // Componente en el plano de la cara (quita la parte normal).
        const dn = dx * normal.x + dy * normal.y + dz * normal.z;
        dx -= normal.x * dn;
        dy -= normal.y * dn;
        dz -= normal.z * dn;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const paso = Math.min(radioAbs, dist * 0.45);
        if (paso < 1e-9 || dist < 1e-12) {
          // No hay hacia dónde retraer: el inset coincide con el original.
          idx = mesh.vertices.length;
          nuevaVertices.push({ x: pos.x, y: pos.y, z: pos.z });
          if (nuevaUvs) nuevaUvs.push([...(mesh.uvs?.[vi] ?? [0, 0])] as [number, number]);
        } else {
          const f = paso / dist;
          idx = nuevaVertices.length;
          nuevaVertices.push({
            x: pos.x + dx * f,
            y: pos.y + dy * f,
            z: pos.z + dz * f,
          });
          if (nuevaUvs) nuevaUvs.push([...(mesh.uvs?.[vi] ?? [0, 0])] as [number, number]);
        }
        insetDe.set(clave, idx);
        donanteDe.set(idx, fi);
      }
      insetFace.push(idx);
    }
    if (insetFace.length === cara.length) emite(insetFace, fi);
  }

  // 2) Quad-puente por arista compartida (2 caras adyacentes).
  for (const [arista, faces] of bordeAFaces) {
    if (faces.length !== 2) continue; // borde abierto o unión en T: sin puente
    const [f1, f2] = faces;
    const guion = arista.indexOf('-');
    const pa = Number(arista.slice(0, guion));
    const qa = Number(arista.slice(guion + 1));
    if (!Number.isFinite(pa) || !Number.isFinite(qa)) continue;
    const ia1 = insetDe.get(`${f1}:${pa}`);
    const ib1 = insetDe.get(`${f1}:${qa}`);
    const ia2 = insetDe.get(`${f2}:${pa}`);
    const ib2 = insetDe.get(`${f2}:${qa}`);
    if (ia1 === undefined || ib1 === undefined || ia2 === undefined || ib2 === undefined) {
      continue;
    }
    // Banda entre las dos caras retraídas. Donante de color: cara f1.
    emite([ia1, ib1, ib2, ia2], f1);
  }

  // 3) Cap por vértice: abanico del vértice original entre sus insets
  //    consecutivos alrededor de la normal del vértice.
  const incidentes = new Map<number, number[]>();
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const cara = mesh.faces[fi];
    for (const vi of cara) {
      const c = canonDe[vi];
      const lista = incidentes.get(c);
      if (lista) {
        if (!lista.includes(fi)) lista.push(fi);
      } else incidentes.set(c, [fi]);
    }
  }
  for (const [c, faces] of incidentes) {
    if (faces.length < 3) {
      // Borde abierto (menos de 3 caras): los insets ya cierran la
      // esquina, no hace falta cap.
      continue;
    }
    const pos = canonPos[c];
    // Normal del vértice = suma de las normales de sus caras.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const puntosInset: Array<{ idx: number; x: number; y: number; z: number; donante: number }> = [];
    for (const fi of faces) {
      const cara = mesh.faces[fi];
      const canon = cara.map((vi) => canonDe[vi]);
      // Normal de la cara (Newell), signo según su enrollado.
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (let i = 0; i < cara.length; i++) {
        const A = canonPos[canon[i]];
        const B = canonPos[canon[(i + 1) % cara.length]];
        fx += (A.y - B.y) * (A.z + B.z);
        fy += (A.z - B.z) * (A.x + B.x);
        fz += (A.x - B.x) * (A.y + B.y);
      }
      nx += fx;
      ny += fy;
      nz += fz;
      const idx = insetDe.get(`${fi}:${c}`);
      if (idx === undefined) continue;
      const pin = nuevaVertices[idx];
      puntosInset.push({
        idx,
        x: pin.x,
        y: pin.y,
        z: pin.z,
        donante: fi,
      });
    }
    const largoV = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (largoV < 1e-12 || puntosInset.length < 3) {
      // Vértice degenerado o sin orientación clara: cap sin ordenar.
      for (let i = 1; i + 1 < puntosInset.length; i++) {
        emite(
          [puntosInset[0].idx, puntosInset[i].idx, puntosInset[i + 1].idx],
          puntosInset[i].donante
        );
      }
      continue;
    }
    const nrm = { x: nx / largoV, y: ny / largoV, z: nz / largoV };
    // Base ortonormal perpendicular a la normal del vértice.
    let ref: Vertex3D;
    if (Math.abs(nrm.x) < 0.9) ref = { x: 1, y: 0, z: 0 };
    else ref = { x: 0, y: 0, z: 1 };
    let ux = ref.y * nrm.z - ref.z * nrm.y;
    let uy = ref.z * nrm.x - ref.x * nrm.z;
    let uz = ref.x * nrm.y - ref.y * nrm.x;
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (lu < 1e-12) continue;
    ux /= lu;
    uy /= lu;
    uz /= lu;
    const vx = nrm.y * uz - nrm.z * uy;
    const vy = nrm.z * ux - nrm.x * uz;
    const vz = nrm.x * uy - nrm.y * ux;
    // Orden radial de las caras alrededor del vértice.
    // Orden radial de los insets alrededor del vértice y CUT-OFF plano:
    // la cap es el polígono cerrado de los insets (se TRUNCA la esquina).
    // Un abanico que conservara el vértice original dejaba las esquinas
    // como puntas de lanza.
    const orden = puntosInset
      .map((p) => {
        const wx = p.x - pos.x;
        const wy = p.y - pos.y;
        const wz = p.z - pos.z;
        const a = wx * ux + wy * uy + wz * uz;
        const b = wx * vx + wy * vy + wz * vz;
        return { p, ang: Math.atan2(b, a) };
      })
      .sort((r1, r2) => r1.ang - r2.ang);
    for (let i = 1; i + 1 < orden.length; i++) {
      emite(
        [orden[0].p.idx, orden[i].p.idx, orden[i + 1].p.idx],
        orden[i].p.donante
      );
    }
  }

  const salida: Mesh = { ...mesh, vertices: nuevaVertices, faces: caras };
  // Guarda: si el chaflán no consiguió retraer NINGUNA cara (malla
  // degenerada), devolver la original tal cual — nunca vaciarla.
  if (caras.length === 0 || caras.length < mesh.faces.length) return mesh;
  if (nuevaUvs) salida.uvs = nuevaUvs;
  if (colorSi) salida.faceColors = coloresFinales;
  if (opSi) salida.faceOpacities = opacidadesFinales;
  if (texSi) salida.faceTextures = texturasFinales;
  if (mesh.faceTextureGroups) salida.faceTextureGroups = gruposFinales;
  return salida;
}

/* ------------------------------------------------------------------ */
/* Bisel plano (marco interior sobre las caras seleccionadas)          */
/* ------------------------------------------------------------------ */

/** Valor del param oculto `carasSel` cuando NO hay caras capturadas. */
export const CARAS_SEL_NINGUNA = '-1';

/** ids de caras → valor del param oculto `carasSel` ('-1' = ninguna). */
export const paramsCarasSel = (ids: Iterable<number>): PluginParams => {
  const lista = [...ids].filter((n) => Number.isInteger(n) && n >= 0);
  return { carasSel: lista.length ? lista.join(',') : CARAS_SEL_NINGUNA };
};

/** Desplaza los ids de caras un offset (pasan de indexar una malla a
 *  indexar otra: la UNIÓN del grupo). Fuera de rango o vacío → '-1'. */
export const desplazarCarasSel = (carasSel: unknown, offset: number): string => {
  if (
    typeof carasSel !== 'string' ||
    carasSel === CARAS_SEL_NINGUNA ||
    !Number.isFinite(offset)
  ) {
    return CARAS_SEL_NINGUNA;
  }
  const ids = carasSel
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (ids.length === 0) return CARAS_SEL_NINGUNA;
  return ids.map((n) => String(n + offset)).join(',');
};

/** Remapa carasSel (que indexa la malla base del miembro dueño) a su
 *  posición DENTRO de la unión del grupo (partes de unirMallasComoGrupo). */
export const carasSelEnUnion = (
  carasSel: unknown,
  partes: Array<{ id: string; finicio: number }>,
  idMiembro: string
): string => {
  if (typeof carasSel !== 'string' || carasSel === CARAS_SEL_NINGUNA) {
    return CARAS_SEL_NINGUNA;
  }
  const parte = partes.find((p) => p.id === idMiembro);
  if (!parte) return CARAS_SEL_NINGUNA;
  return desplazarCarasSel(carasSel, parte.finicio);
};

/**
 * INSET PLANO animable: sobre cada grupo coplanar de las caras
 * seleccionadas (param oculto `carasSel`, capturado por el editor al
 * activar el deformador) emite HACIA ADENTRO:
 *   - un MARCO: banda de quads alrededor del perímetro, a una separación
 *     editable (% de la dimensión menor del polígono en el plano);
 *   - un polígono INTERIOR dentro del marco.
 * Dos profundidades (% de la diagonal de la caja, como el radio del
 * Bisel) animables cada una: profInterior mueve el polígono interior por
 * la normal del plano; profMarco mueve el borde EXTERIOR del marco y las
 * caras vecinas se inclinan para seguir estancas — cada copia del mismo
 * vértice lógico recibe el MISMO delta (mismo criterio que los
 * quad-puentes del chaflán y las normales de Hinchar).
 * Neutro: separacion 0 o sin caras → la malla original sin tocar.
 */
function biselPlano(mesh: Mesh, params: PluginParams): Mesh {
  const separacion = num(params, 'separacion', 0);
  if (separacion <= 0) return mesh;
  if (mesh.vertices.length === 0 || mesh.faces.length === 0) return mesh;

  const bruta = params['carasSel'];
  const seleccionadas =
    typeof bruta === 'string'
      ? [
          ...new Set(
            bruta
              .split(',')
              .map((s) => Number(s.trim()))
              .filter(
                (n) =>
                  Number.isInteger(n) && n >= 0 && n < mesh.faces.length
              )
          ),
        ]
      : [];
  if (seleccionadas.length === 0) return mesh;

  const topo = construirAnillos(mesh);
  if (!topo) return mesh;
  const { canonDe, canonPos, bordeAFaces } = topo;

  // Escala de las profundidades: % de la diagonal de la caja (mismo
  // criterio que el radio del chaflán: comparable entre objetos).
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of canonPos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const diagonal = Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
  if (!Number.isFinite(diagonal) || diagonal < 1e-9) return mesh;
  const profIntAbs = (num(params, 'profInterior', 0) / 100) * diagonal * 0.5;
  const profMarAbs = (num(params, 'profMarco', 0) / 100) * diagonal * 0.5;
  // Interior SUELTO (param oculto que el panel pone al mover Prof.
  // interior con CTRL): el marco NO se inclina — su anillo queda
  // CONGELADO en la posición que ya tenía (profInteriorBase capturado
  // por el panel = valor de profInterior en ese gesto; anillo e interior
  // coinciden ahí, así que NO hay salto al cambiar de modo a mitad) y el
  // polígono interior sigue en solitario según profInterior, con paredes
  // conectándolo al anillo. El gesto queda fijado hasta Cancelar.
  // Sin CTRL: compartido → la banda se inclina con el interior.
  const suelto = num(params, 'interiorSuelto', 0) >= 0.5;
  const profBaseAbs = suelto
    ? (num(params, 'profInteriorBase', 0) / 100) * diagonal * 0.5
    : 0;

  const claveCanon = (a: number, b: number) =>
    a < b ? `${a}-${b}` : `${b}-${a}`;

  /** Normal Newell canónica de una cara (unitaria o null si degenerada). */
  const newellCara = (fi: number): Vertex3D | null => {
    const cara = mesh.faces[fi];
    if (!cara || cara.length < 3) return null;
    const vistos = new Set<number>();
    const ciclo: number[] = [];
    for (const vi of cara) {
      const c = canonDe[vi];
      if (c < 0 || vistos.has(c)) continue;
      vistos.add(c);
      ciclo.push(c);
    }
    if (ciclo.length < 3) return null;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < ciclo.length; i++) {
      const A = canonPos[ciclo[i]];
      const B = canonPos[ciclo[(i + 1) % ciclo.length]];
      nx += (A.y - B.y) * (A.z + B.z);
      ny += (A.z - B.z) * (A.x + B.x);
      nz += (A.x - B.x) * (A.y + B.y);
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) return null;
    return { x: nx / len, y: ny / len, z: nz / len };
  };

  // 1) GRUPOS COPLANARES: union-find de las caras seleccionadas conectadas
  //    por aristas canon cuyas normales coinciden (dot > 0.99). Cada grupo
  //    es un polígono lógico (mallas .zeus trianguladas en abanico).
  const selSet = new Set(seleccionadas);
  const selArista = new Map<string, number[]>();
  const padre = new Map<number, number>();
  const buscar = (x: number): number => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r) as number;
    return r;
  };
  for (const fi of seleccionadas) padre.set(fi, fi);
  for (const fi of seleccionadas) {
    const cara = mesh.faces[fi];
    if (!cara || cara.length < 3) continue;
    for (let j = 0; j < cara.length; j++) {
      const cp = canonDe[cara[j]];
      const cq = canonDe[cara[(j + 1) % cara.length]];
      if (cp < 0 || cq < 0 || cp === cq) continue;
      const key = claveCanon(cp, cq);
      const lista = selArista.get(key);
      if (lista) {
        if (!lista.includes(fi)) lista.push(fi);
      } else selArista.set(key, [fi]);
    }
  }
  for (const lista of selArista.values()) {
    if (lista.length < 2) continue;
    for (let i = 1; i < lista.length; i++) {
      const nA = newellCara(lista[0]);
      const nB = newellCara(lista[i]);
      if (!nA || !nB) continue;
      const dot = nA.x * nB.x + nA.y * nB.y + nA.z * nB.z;
      if (dot > 0.99) padre.set(buscar(lista[i]), buscar(lista[0]));
    }
  }
  const grupos = new Map<number, number[]>();
  for (const fi of seleccionadas) {
    const r = buscar(fi);
    const g = grupos.get(r);
    if (g) g.push(fi);
    else grupos.set(r, [fi]);
  }
  const gruposOrden = [...grupos.values()].sort(
    (g1, g2) => Math.min(...g1) - Math.min(...g2)
  );

  // Salida: mismas bases que el chaflán (nuevaVertices parte de las
  // originales; emite alinea los arrays por cara con su donante).
  const nuevaVertices: Vertex3D[] = [...mesh.vertices];
  const nuevaUvs = mesh.uvs ? ([...mesh.uvs] as [number, number][]) : undefined;
  const colorSi = mesh.faceColors ? [...mesh.faceColors] : undefined;
  const opSi = mesh.faceOpacities ? [...mesh.faceOpacities] : undefined;
  const texSi = mesh.faceTextures ? [...mesh.faceTextures] : undefined;
  const caras: number[][] = [];
  const coloresFinales: (string | null)[] = [];
  const opacidadesFinales: number[] = [];
  const texturasFinales: (string | null)[] = [];
  const gruposFinales: (string | null)[] = [];
  const emite = (face: number[], donanteIdx: number) => {
    caras.push(face);
    coloresFinales.push(colorSi ? colorSi[donanteIdx] ?? null : null);
    opacidadesFinales.push(opSi ? opSi[donanteIdx] ?? 1 : 1);
    texturasFinales.push(texSi ? texSi[donanteIdx] ?? null : null);
    if (mesh.faceTextureGroups) {
      gruposFinales.push(mesh.faceTextureGroups[donanteIdx] ?? null);
    }
  };
  const entraUv = (vi: number) => {
    if (!nuevaUvs) return;
    const uv = mesh.uvs?.[vi];
    nuevaUvs.push(uv ? [uv[0], uv[1]] : [0, 0]);
  };

  // Copias brutas de cada canon: para mover TODAS las copias del mismo
  // vértice lógico a la vez la superficie no se agrieta.
  const copiasCanon = new Map<number, number[]>();
  for (let i = 0; i < mesh.vertices.length; i++) {
    const c = canonDe[i];
    if (c < 0) continue;
    const lista = copiasCanon.get(c);
    if (lista) lista.push(i);
    else copiasCanon.set(c, [i]);
  }

  interface BordeGrupo {
    p: number;
    q: number;
    fi: number;
    viP: number;
    viQ: number;
  }
  interface BucleGrupo {
    /** índices en bordes del grupo, en orden de la cadena dirigida. */
    bordeIdx: number[];
    /** área 2D con signo (proyección al plano del grupo). */
    area2: number;
    /** esquinas insetadas 2D, paralelas a bordeIdx (en el marco U,V). */
    corner: Array<{ ix: number; iy: number }>;
    /** vértice interior nuevo por esquina (m → índice). */
    vertice: Map<number, number>;
    /** TAPA del interior SUELTO: vértices del polígono extruido por
     *  esquina (m → índice), aparte del anillo plano del marco. */
    tapa: Map<number, number>;
  }
  interface DatosGrupo {
    caras: number[];
    normal: Vertex3D;
    centro: Vertex3D;
    u: Vertex3D;
    v: Vertex3D;
    sepAbs: number;
    bordes: BordeGrupo[];
    bucles: BucleGrupo[]; // el de mayor área PRIMERO (interior = bucle 0)
    donanteInterior: number;
  }

  const datosGrupos: DatosGrupo[] = [];
  /** Delta (marco desplazado) por canon de contorno: en coords de mundo. */
  const deltaCanonLocal = new Map<number, Vertex3D>();

  for (const carasGrupo of gruposOrden) {
    // Plano del grupo: Newell acumulado sobre sus caras.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let nCentro = 0;
    const grupoSet = new Set<number>();
    for (const fi of carasGrupo) {
      const cara = mesh.faces[fi];
      if (!cara || cara.length < 3) continue;
      grupoSet.add(fi);
      const n2 = newellCara(fi);
      if (!n2) {
        grupoSet.delete(fi);
        continue;
      }
      nx += n2.x;
      ny += n2.y;
      nz += n2.z;
      const vistos = new Set<number>();
      for (const vi of cara) {
        const c = canonDe[vi];
        if (c < 0 || vistos.has(c)) continue;
        vistos.add(c);
        const pos = canonPos[c];
        cx += pos.x;
        cy += pos.y;
        cz += pos.z;
        nCentro++;
      }
    }
    if (grupoSet.size === 0) continue;

    // Contorno (topología pura, ANTES de fijar el plano): aristas canon
    // con EXACTAMENTE una cara del grupo. Sirve para orientar la normal.
    const bordes: BordeGrupo[] = [];
    for (const fi of carasGrupo) {
      if (!grupoSet.has(fi)) continue;
      const cara = mesh.faces[fi];
      for (let j = 0; j < cara.length; j++) {
        const viP = cara[j];
        const viQ = cara[(j + 1) % cara.length];
        const cp = canonDe[viP];
        const cq = canonDe[viQ];
        if (cp < 0 || cq < 0 || cp === cq) continue;
        const listaF = bordeAFaces.get(claveCanon(cp, cq));
        if (!listaF) continue;
        let delGrupo = 0;
        for (const f2 of listaF) if (grupoSet.has(f2)) delGrupo++;
        if (delGrupo !== 1) continue;
        bordes.push({ p: cp, q: cq, fi: fi as number, viP: viP as number, viQ: viQ as number });
      }
    }
    if (bordes.length === 0) continue;

    const largoN = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (largoN < 1e-12) continue;
    const normal = { x: nx / largoN, y: ny / largoN, z: nz / largoN };
    if (nCentro === 0) continue;
    const centro = { x: cx / nCentro, y: cy / nCentro, z: cz / nCentro };

    // Orientación GLOBAL de la normal: el enrolado de la malla .zeus no
    // es fiable cara a cara (una se mete hacia adentro y la otra sale con
    // el mismo slider). El lado SÓLIDO es el de las caras vecinas al
    // contorno: si su material cae del lado +normal (normal apuntando
    // hacia dentro de la pieza) se INVIERTE, de modo que profInterior/
    // profMarco signifiquen lo mismo en TODAS las caras seleccionadas
    // (positivo = sale, negativo = se mete). Sin vecinos (lámina aislada)
    // se respeta el enrolado.
    {
      let sumaDist = 0;
      let cuenta = 0;
      for (const b of bordes) {
        const listaF = bordeAFaces.get(claveCanon(b.p, b.q));
        if (!listaF) continue;
        for (const f2 of listaF) {
          if (grupoSet.has(f2)) continue;
          const cara2 = mesh.faces[f2];
          if (!cara2) continue;
          const vistos = new Set<number>();
          let fx = 0;
          let fy = 0;
          let fz = 0;
          let nc = 0;
          for (const vi of cara2) {
            const c = canonDe[vi];
            if (c < 0 || vistos.has(c)) continue;
            vistos.add(c);
            const pos = canonPos[c];
            fx += pos.x;
            fy += pos.y;
            fz += pos.z;
            nc++;
          }
          if (nc === 0) continue;
          sumaDist +=
            ((fx / nc - centro.x) * normal.x +
              (fy / nc - centro.y) * normal.y +
              (fz / nc - centro.z) * normal.z);
          cuenta++;
        }
      }
      if (cuenta > 0 && sumaDist > 1e-9) {
        normal.x = -normal.x;
        normal.y = -normal.y;
        normal.z = -normal.z;
      }
    }

    // Base ortonormal (U,V) con U×V = normal (receta del chaflán).
    const ref: Vertex3D =
      Math.abs(normal.x) < 0.9
        ? { x: 1, y: 0, z: 0 }
        : { x: 0, y: 0, z: 1 };
    const ux0 = ref.y * normal.z - ref.z * normal.y;
    const uy0 = ref.z * normal.x - ref.x * normal.z;
    const uz0 = ref.x * normal.y - ref.y * normal.x;
    const lu0 = Math.sqrt(ux0 * ux0 + uy0 * uy0 + uz0 * uz0);
    if (lu0 < 1e-12) continue;
    const u = { x: ux0 / lu0, y: uy0 / lu0, z: uz0 / lu0 };
    const v = {
      x: normal.y * u.z - normal.z * u.y,
      y: normal.z * u.x - normal.x * u.z,
      z: normal.x * u.y - normal.y * u.x,
    };
    const proyecta = (p: Vertex3D): { a: number; b: number } => ({
      a: (p.x - centro.x) * u.x + (p.y - centro.y) * u.y + (p.z - centro.z) * u.z,
      b: (p.x - centro.x) * v.x + (p.y - centro.y) * v.y + (p.z - centro.z) * v.z,
    });

    // Cadena dirigida en bucles (un canon con 2 salidas cierra y abre
    // otro: huecos como bucles separados).
    const salidas = new Map<number, number[]>();
    bordes.forEach((b, i) => {
      const lista = salidas.get(b.p);
      if (lista) lista.push(i);
      else salidas.set(b.p, [i]);
    });
    const usados = new Set<number>();
    const cadenas: number[][] = [];
    for (let i = 0; i < bordes.length; i++) {
      if (usados.has(i)) continue;
      const cadena: number[] = [];
      const inicio = bordes[i].p;
      let cur: number | undefined = i;
      while (cur !== undefined && !usados.has(cur)) {
        usados.add(cur);
        cadena.push(cur);
        const bActual: BordeGrupo | undefined = bordes[cur];
        if (!bActual || bActual.q === inicio) break;
        const outs: number[] | undefined = salidas.get(bActual.q);
        if (!outs) break;
        const sig: number | undefined = (outs).find(
          (k: number) => !usados.has(k)
        );
        cur = sig;
      }
      if (cadena.length >= 3) cadenas.push(cadena);
    }
    if (cadenas.length === 0) continue;

    // Bbox 2D de TODO el contorno: separación = % de la menor dimensión.
    let aMin = Infinity;
    let aMax = -Infinity;
    let bMin = Infinity;
    let bMax = -Infinity;
    const canonesVistos = new Set<number>();
    for (const b of bordes) {
      if (canonesVistos.has(b.p)) continue;
      canonesVistos.add(b.p);
      const pr = proyecta(canonPos[b.p]);
      if (pr.a < aMin) aMin = pr.a;
      if (pr.a > aMax) aMax = pr.a;
      if (pr.b < bMin) bMin = pr.b;
      if (pr.b > bMax) bMax = pr.b;
    }
    const sepAbs =
      (separacion / 100) *
      Math.min(Math.abs(aMax - aMin), Math.abs(bMax - bMin));
    if (sepAbs < 1e-9) continue;

    // Inset 2D por bucle: offset de líneas consecutivas hacia adentro
    // (miter con límite; bisectriz como respaldo) y clamp por esquina a
    // 45% de su distancia al centro del grupo (receta del chaflán).
    const bucles: BucleGrupo[] = [];
    for (const cadena of cadenas) {
      const pts = cadena.map((k) => proyecta(canonPos[bordes[k].p]));
      let area2 = 0;
      for (let m = 0; m < pts.length; m++) {
        const P = pts[m];
        const Q = pts[(m + 1) % pts.length];
        area2 += P.a * Q.b - Q.a * P.b;
      }
      area2 /= 2;
      if (Math.abs(area2) < 1e-9) continue;
      // Normal interior de la arista m→m+1 (izquierda si CCW área>0).
      const dentroDe = (m: number): { x: number; y: number } => {
        const P = pts[m];
        const Q = pts[(m + 1) % pts.length];
        const dx = Q.a - P.a;
        const dy = Q.b - P.b;
        const len = Math.hypot(dx, dy) || 1;
        return area2 > 0
          ? { x: -dy / len, y: dx / len }
          : { x: dy / len, y: -dx / len };
      };
      const corner: Array<{ ix: number; iy: number }> = [];
      for (let m = 0; m < pts.length; m++) {
        const P = pts[m];
        const nA = dentroDe((m - 1 + pts.length) % pts.length);
        const nB = dentroDe(m);
        const dA = pts[(m - 1 + pts.length) % pts.length]; // pts[m-1]
        const dB = pts[(m + 1) % pts.length];
        const OA = { x: dA.a + nA.x * sepAbs, y: dA.b + nA.y * sepAbs };
        const OB = { x: P.a + nB.x * sepAbs, y: P.b + nB.y * sepAbs };
        const dirA = { x: P.a - dA.a, y: P.b - dA.b };
        const dirB = { x: dB.a - P.a, y: dB.b - P.b };
        const den = dirA.x * dirB.y - dirA.y * dirB.x;
        let ix = 0;
        let iy = 0;
        if (Math.abs(den) > 1e-12) {
          const t =
            ((OB.x - OA.x) * dirB.y - (OB.y - OA.y) * dirB.x) / den;
          ix = OA.x + dirA.x * t;
          iy = OA.y + dirA.y * t;
        }
        const mitX = ix - P.a;
        const mitY = iy - P.b;
        const mitLen = Math.hypot(mitX, mitY);
        // Miter desbocado o líneas paralelas: bisectriz de las normales.
        if (
          mitLen < 1e-9 ||
          mitLen > sepAbs * 4 ||
          Math.abs(den) <= 1e-12
        ) {
          const bx = nA.x + nB.x;
          const by = nA.y + nB.y;
          const bl = Math.hypot(bx, by);
          if (bl > 1e-12) {
            ix = P.a + (bx / bl) * sepAbs;
            iy = P.b + (by / bl) * sepAbs;
          } else {
            ix = P.a + nB.x * sepAbs;
            iy = P.b + nB.y * sepAbs;
          }
        }
        // Clamp al 45% de la distancia 2D de la esquina al centro (en
        // este marco U,V el centro está en el origen).
        const dCentro = Math.hypot(P.a, P.b);
        const maxX = dCentro * 0.45;
        const fx = ix - P.a;
        const fy = iy - P.b;
        const fl = Math.hypot(fx, fy);
        if (fl > maxX && maxX > 1e-12) {
          const fAjuste = maxX / fl;
          ix = P.a + fx * fAjuste;
          iy = P.b + fy * fAjuste;
        }
        corner.push({ ix, iy });
      }
      bucles.push({
        bordeIdx: cadena,
        area2,
        corner,
        vertice: new Map<number, number>(),
        tapa: new Map<number, number>(),
      });
    }
    if (bucles.length === 0) continue;
    // El bucle de MAYOR área encabeza: solo él genera el polígono interior.
    bucles.sort((b1, b2) => Math.abs(b2.area2) - Math.abs(b1.area2));

    // Donante del polígono interior: la cara del grupo de mayor área.
    let donanteInterior = -1;
    let areaDonante = -1;
    for (const fi of carasGrupo) {
      if (!grupoSet.has(fi)) continue;
      const cara = mesh.faces[fi];
      const vistos = new Set<number>();
      const ciclo: number[] = [];
      for (const vi of cara) {
        const c = canonDe[vi];
        if (c < 0 || vistos.has(c)) continue;
        vistos.add(c);
        ciclo.push(c);
      }
      if (ciclo.length < 3) continue;
      // |Newell|/2 = área: magnitud del vector acumulado.
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (let i = 0; i < ciclo.length; i++) {
        const A = canonPos[ciclo[i]];
        const B = canonPos[ciclo[(i + 1) % ciclo.length]];
        fx += (A.y - B.y) * (A.z + B.z);
        fy += (A.z - B.z) * (A.x + B.x);
        fz += (A.x - B.x) * (A.y + B.y);
      }
      const mag = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (mag > areaDonante) {
        areaDonante = mag;
        donanteInterior = fi;
      }
    }

    // Delta del contorno por canon: primer grupo que reclama el canon
    // gana (dos grupos en planos distintos comparten arista).
    if (Math.abs(profMarAbs) > 1e-12) {
      for (const bucle of bucles) {
        for (const m of bucle.bordeIdx) {
          const c = bordes[m].p;
          if (!deltaCanonLocal.has(c)) {
            deltaCanonLocal.set(c, {
              x: normal.x * profMarAbs,
              y: normal.y * profMarAbs,
              z: normal.z * profMarAbs,
            });
          }
        }
      }
    }

    datosGrupos.push({
      caras: [...grupoSet],
      normal,
      centro,
      u,
      v,
      sepAbs,
      bordes,
      bucles,
      donanteInterior,
    });
  }
  if (datosGrupos.length === 0) return mesh;

  // 2) REMAP: una copia NUEVA por cada copia bruta de cada canon de
  //    contorno con delta — todas al MISMO punto desplazado (superficie
  //    estanca: las caras vecinas se inclinan con el marco).
  const remap = new Map<number, number>();
  for (const [c, d] of deltaCanonLocal) {
    const pos = canonPos[c];
    for (const vi of copiasCanon.get(c) ?? []) {
      remap.set(vi, nuevaVertices.length);
      nuevaVertices.push({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z });
      entraUv(vi);
    }
  }

  /** Anillo interior del marco (modo SUELTO): esquina insetada +
   *  profInteriorBase — la posición congelada del gesto CTRL. */
  const verticePlanoDe = (
    gd: DatosGrupo,
    bucle: BucleGrupo,
    m: number
  ): number => {
    const ya = bucle.vertice.get(m);
    if (ya !== undefined) return ya;
    const b = gd.bordes[bucle.bordeIdx[m]];
    const c2d = bucle.corner[m];
    const idx = nuevaVertices.length;
    nuevaVertices.push({
      x:
        gd.centro.x +
        gd.u.x * c2d.ix +
        gd.v.x * c2d.iy +
        gd.normal.x * profBaseAbs,
      y:
        gd.centro.y +
        gd.u.y * c2d.ix +
        gd.v.y * c2d.iy +
        gd.normal.y * profBaseAbs,
      z:
        gd.centro.z +
        gd.u.z * c2d.ix +
        gd.v.z * c2d.iy +
        gd.normal.z * profBaseAbs,
    });
    const copias = copiasCanon.get(b.p);
    entraUv(copias ? copias[0] : b.viP);
    bucle.vertice.set(m, idx);
    return idx;
  };

  /** TAPA del polígono interior en modo SUELTO: esquina insetada +
   *  profInterior por la normal (vértices APARTE del anillo del marco). */
  const verticeTapaDe = (
    gd: DatosGrupo,
    bucle: BucleGrupo,
    m: number
  ): number => {
    const ya = bucle.tapa.get(m);
    if (ya !== undefined) return ya;
    const b = gd.bordes[bucle.bordeIdx[m]];
    const c2d = bucle.corner[m];
    const idx = nuevaVertices.length;
    nuevaVertices.push({
      x:
        gd.centro.x +
        gd.u.x * c2d.ix +
        gd.v.x * c2d.iy +
        gd.normal.x * profIntAbs,
      y:
        gd.centro.y +
        gd.u.y * c2d.ix +
        gd.v.y * c2d.iy +
        gd.normal.y * profIntAbs,
      z:
        gd.centro.z +
        gd.u.z * c2d.ix +
        gd.v.z * c2d.iy +
        gd.normal.z * profIntAbs,
    });
    const copias = copiasCanon.get(b.p);
    entraUv(copias ? copias[0] : b.viP);
    bucle.tapa.set(m, idx);
    return idx;
  };

  /** Vértice interior de la esquina m del bucle (creado bajo demanda):
   *  modo COMBINADO (sin CTRL): anillo e interior COMPARTEN el vértice
   *  desplazado — la banda se inclina con el polígono interior. Es la
   *  posición insetada en el plano + profInterior por la normal. */
  const verticeInteriorDe = (
    gd: DatosGrupo,
    bucle: BucleGrupo,
    m: number
  ): number => {
    const ya = bucle.vertice.get(m);
    if (ya !== undefined) return ya;
    const b = gd.bordes[bucle.bordeIdx[m]];
    const c2d = bucle.corner[m];
    const idx = nuevaVertices.length;
    nuevaVertices.push({
      x:
        gd.centro.x +
        gd.u.x * c2d.ix +
        gd.v.x * c2d.iy +
        gd.normal.x * profIntAbs,
      y:
        gd.centro.y +
        gd.u.y * c2d.ix +
        gd.v.y * c2d.iy +
        gd.normal.y * profIntAbs,
      z:
        gd.centro.z +
        gd.u.z * c2d.ix +
        gd.v.z * c2d.iy +
        gd.normal.z * profIntAbs,
    });
    const copias = copiasCanon.get(b.p);
    entraUv(copias ? copias[0] : b.viP);
    bucle.vertice.set(m, idx);
    return idx;
  };

  // 3) EMISIÓN:
  //    3a) caras NO seleccionadas: re-emitir con remap (los vecinos del
  //        marco desplazado se inclinan; las demás quedan igual).
  const carasGrupos = new Set<number>();
  for (const gd of datosGrupos) {
    for (const fi of gd.caras) carasGrupos.add(fi);
  }
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    if (carasGrupos.has(fi)) continue;
    const cara = mesh.faces[fi];
    emite(cara.map((vi) => remap.get(vi) ?? vi), fi);
  }
  //    3b) por grupo: banda del marco (quad por arista de contorno) y
  //        polígono interior del bucle mayor. Orden del quad [out, in,
  //        in, out]: sigue el enrolado de la cara donante (CCW en el
  //        marco U,V) → normal de la banda = normal del grupo.
  for (const gd of datosGrupos) {
    for (const bucle of gd.bucles) {
      for (let m = 0; m < bucle.bordeIdx.length; m++) {
        const b = gd.bordes[bucle.bordeIdx[m]];
        // SUELTO: el anillo del marco queda en el plano (no se inclina).
        const inP = suelto
          ? verticePlanoDe(gd, bucle, m)
          : verticeInteriorDe(gd, bucle, m);
        const inQ = suelto
          ? verticePlanoDe(gd, bucle, (m + 1) % bucle.bordeIdx.length)
          : verticeInteriorDe(gd, bucle, (m + 1) % bucle.bordeIdx.length);
        const outP = remap.get(b.viP) ?? b.viP;
        const outQ = remap.get(b.viQ) ?? b.viQ;
        emite([outP, outQ, inQ, inP], b.fi);
      }
    }
    const principal = gd.bucles[0];
    if (gd.donanteInterior >= 0 && principal.bordeIdx.length >= 3) {
      if (suelto) {
        // Con profInterior sobre la base el anillo y la tapa coinciden
        // (sin paredes ni vértices duplicados): reutiliza el anillo.
        const desplazaTapa =
          Math.abs(profIntAbs - profBaseAbs) > 1e-12;
        const tapaOAnilloDe = (m: number): number =>
          desplazaTapa
            ? verticeTapaDe(gd, principal, m)
            : verticePlanoDe(gd, principal, m);
        // Paredes de la extrusión en solitario: quad anillo→tapa por
        // arista. La normal mira hacia AFUERA si el bucle es CCW (área
        // positiva); en CW (huecos) se invierte el enrolado.
        if (desplazaTapa) {
          for (let m = 0; m < principal.bordeIdx.length; m++) {
            const b = gd.bordes[principal.bordeIdx[m]];
            const pB = verticePlanoDe(gd, principal, m);
            const qB = verticePlanoDe(
              gd,
              principal,
              (m + 1) % principal.bordeIdx.length
            );
            const pT = tapaOAnilloDe(m);
            const qT = tapaOAnilloDe((m + 1) % principal.bordeIdx.length);
            emite(
              principal.area2 > 0
                ? [pB, qB, qT, pT]
                : [pB, pT, qT, qB],
              b.fi
            );
          }
        }
        const interior: number[] = [];
        for (let m = 0; m < principal.bordeIdx.length; m++) {
          interior.push(tapaOAnilloDe(m));
        }
        emite(interior, gd.donanteInterior);
      } else {
        const interior: number[] = [];
        for (let m = 0; m < principal.bordeIdx.length; m++) {
          interior.push(verticeInteriorDe(gd, principal, m));
        }
        emite(interior, gd.donanteInterior);
      }
    }
  }

  if (caras.length === 0) return mesh;
  const salida: Mesh = { ...mesh, vertices: nuevaVertices, faces: caras };
  if (nuevaUvs) salida.uvs = nuevaUvs;
  if (colorSi) salida.faceColors = coloresFinales;
  if (opSi) salida.faceOpacities = opacidadesFinales;
  if (texSi) salida.faceTextures = texturasFinales;
  if (mesh.faceTextureGroups) salida.faceTextureGroups = gruposFinales;
  return salida;
}

/* ------------------------------------------------------------------ */
/* Hinchar (inflar a lo largo de las normales)                         */
/* ------------------------------------------------------------------ */

/**
 * Empuja cada vértice canónico a lo largo de su normal (suma de las
 * normales de las caras que lo comparten) una amplitud = % de la
 * diagonal de la caja. Todas las copias de un mismo vértice (mallas sin
 * índices compartidos) reciben el MISMO desplazamiento: la superficie
 * no se agrieta.
 */
function hinchar(mesh: Mesh, params: PluginParams): Mesh {
  const amplitud = num(params, 'amplitud', 20) / 100;
  if (amplitud === 0 || mesh.vertices.length === 0) return mesh;

  const topo = construirAnillos(mesh);
  if (!topo) return mesh;
  const { canonDe, canonPos } = topo;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of canonPos) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const diagonal = Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
  if (!Number.isFinite(diagonal) || diagonal < 1e-9) return mesh;
  const paso = amplitud * diagonal;

  // Normal por vértice canon = suma de las normales (Newell) de sus caras.
  const normales = new Map<number, [number, number, number]>();
  for (const cara of mesh.faces) {
    if (cara.length < 3) continue;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let i = 0; i < cara.length; i++) {
      const A = canonPos[canonDe[cara[i]]];
      const B = canonPos[canonDe[cara[(i + 1) % cara.length]]];
      fx += (A.y - B.y) * (A.z + B.z);
      fy += (A.z - B.z) * (A.x + B.x);
      fz += (A.x - B.x) * (A.y + B.y);
    }
    for (const vi of cara) {
      const c = canonDe[vi];
      const act = normales.get(c);
      if (act) {
        act[0] += fx;
        act[1] += fy;
        act[2] += fz;
      } else normales.set(c, [fx, fy, fz]);
    }
  }

  const desplaz = new Map<number, Vertex3D>();
  for (const [c, n] of normales) {
    const largo = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (largo < 1e-12) continue;
    const pos = canonPos[c];
    desplaz.set(c, {
      x: pos.x + (n[0] / largo) * paso,
      y: pos.y + (n[1] / largo) * paso,
      z: pos.z + (n[2] / largo) * paso,
    });
  }

  const vertices = mesh.vertices.map((v, i) => {
    const nuevo = desplaz.get(canonDe[i]);
    return nuevo ? { x: nuevo.x, y: nuevo.y, z: nuevo.z } : { ...v };
  });
  return { ...mesh, vertices };
}

/* ------------------------------------------------------------------ */
/* Sesgar (shear lineal)                                              */
/* ------------------------------------------------------------------ */

/**
 * Desplaza las secciones transversales al eje elegido proporcionalmente
 * a su altura (0 en la base, máximo en la cima): desplazamiento = % de
 * la extensión transversal. CON GUÍA: el desplazamiento es CERO donde
 * esté la guía y crece simétrico para los dos lados (la guía es el plano
 * de referencia del sesgado); 0 = automático (la base, como siempre).
 */
function sesgar(mesh: Mesh, params: PluginParams): Mesh {
  const desplazamiento = num(params, 'desplazamiento', 20) / 100;
  const eje = ejeDe(params, 'eje', 'y');
  const cajaEje = caja(mesh, eje);
  if (desplazamiento === 0 || cajaEje.max - cajaEje.min < 1e-9) return mesh;

  const [e1] = ejesTransversales(eje);
  const cajaT = caja(mesh, e1);
  const total = desplazamiento * cajaT.extension;
  if (!Number.isFinite(total)) return mesh;

  const ancla = guiaDe(mesh, params, eje) ?? cajaEje.min;
  const vertices = mesh.vertices.map((v) => {
    const t = (leerEje(v, eje) - ancla) / (cajaEje.max - cajaEje.min);
    return conEje(v, e1, leerEje(v, e1) + total * t);
  });
  return { ...mesh, vertices };
}

/* ------------------------------------------------------------------ */
/* Derretir (derrame hacia la base, como Melt de 3ds Max)             */
/* ------------------------------------------------------------------ */

/**
 * Los vértices altos ceden hacia abajo con caída ∝ t² (t = altura) y la
 * base se ensancha (barril derretido). Determinista. CON GUÍA: la CAÍDA
 * empieza donde esté la guía (por debajo no cede, t=0: sin caída y con
 * el ensanche del barril); 0 = automático (la base, como siempre).
 */
function derretir(mesh: Mesh, params: PluginParams): Mesh {
  const caida = num(params, 'caida', 40) / 100;
  const ensanche = num(params, 'ensanche', 20) / 100;
  const eje = ejeDe(params, 'eje', 'y');
  const cajaEje = caja(mesh, eje);
  if (cajaEje.max - cajaEje.min < 1e-9) return mesh;
  if (caida === 0 && ensanche === 0) return mesh;

  const [e1, e2] = ejesTransversales(eje);
  const c1 = caja(mesh, e1).centro;
  const c2 = caja(mesh, e2).centro;
  const caidaAbs = caida * (cajaEje.max - cajaEje.min);
  const ensancheAbs = Math.max(
    caja(mesh, e1).extension,
    caja(mesh, e2).extension
  ) * ensanche;

  const ancla = guiaDe(mesh, params, eje) ?? cajaEje.min;
  const vertices = mesh.vertices.map((v) => {
    const t = Math.max(
      0,
      (leerEje(v, eje) - ancla) / (cajaEje.max - cajaEje.min)
    );
    const d1 = leerEje(v, e1) - c1;
    const d2 = leerEje(v, e2) - c2;
    let nuevo = conEje(v, eje, leerEje(v, eje) - caidaAbs * t * t);
    if (ensancheAbs !== 0) {
      const dist = Math.sqrt(d1 * d1 + d2 * d2);
      if (dist > 1e-9) {
        const f = (ensancheAbs * (1 - t) * (1 - t)) / dist;
        nuevo = conEje(nuevo, e1, leerEje(nuevo, e1) + d1 * f);
        nuevo = conEje(nuevo, e2, leerEje(nuevo, e2) + d2 * f);
      }
    }
    return nuevo;
  });
  return { ...mesh, vertices };
}

/* ------------------------------------------------------------------ */
/* Romper (pedazos desiguales esparcidos por el suelo)                */
/* ------------------------------------------------------------------ */

/** PRNG determinista con semilla (espejo del de lib/texture-generator). */
function mulberryDeform(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Transformación de un pedazo: escala + giro + aplanado + desplazamiento. */
type PedazoRomper = {
  centro: Vertex3D;
  escala: number;
  // Giro de la explosión (eje y ángulo al azar):
  ax: number;
  ay: number;
  az: number;
  seno: number;
  cos: number;
  // Aplanado de la caída: gira la normal del pedazo hacia +u (el suelo).
  fx: number;
  fy: number;
  fz: number;
  senoF: number;
  cosF: number;
  // Desplazamiento de vuelo (radial XZ, sin compenso vertical).
  dx: number;
  dy: number;
  dz: number;
};

/** Rodrigues de UN vector (p. ej. una normal), sin escala ni traslación. */
const giraVector = (
  v: Vertex3D,
  ax: number,
  ay: number,
  az: number,
  seno: number,
  cos: number
): Vertex3D => {
  if (seno === 0 && cos === 1) return { ...v };
  const cxr = ay * v.z - az * v.y;
  const cyr = az * v.x - ax * v.z;
  const czr = ax * v.y - ay * v.x;
  const k = (1 - cos) * (ax * v.x + ay * v.y + az * v.z);
  return {
    x: v.x * cos + cxr * seno + ax * k,
    y: v.y * cos + cyr * seno + ay * k,
    z: v.z * cos + czr * seno + az * k,
  };
};

/** Aplica escala + giro de Rodrigues alrededor del centro del pedazo. */
const puntoRomper = (
  p: Vertex3D,
  t: PedazoRomper
): Vertex3D => {
  let q: Vertex3D = {
    x: (p.x - t.centro.x) * t.escala,
    y: (p.y - t.centro.y) * t.escala,
    z: (p.z - t.centro.z) * t.escala,
  };
  if (t.seno !== 0 || t.cos !== 1) {
    q = giraVector(q, t.ax, t.ay, t.az, t.seno, t.cos);
  }
  if (t.senoF !== 0 || t.cosF !== 1) {
    q = giraVector(q, t.fx, t.fy, t.fz, t.senoF, t.cosF);
  }
  return {
    x: q.x + t.centro.x + t.dx,
    y: q.y + t.centro.y + t.dy,
    z: q.z + t.centro.z + t.dz,
  };
};

/** Normal media de un pedazo (Newell, ponderada por área) sobre la malla ORIGINAL. */
const normalDeCaras = (mesh: Mesh, lista: number[]): Vertex3D => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const f of lista) {
    const cara = mesh.faces[f];
    for (let i = 0; i < cara.length; i++) {
      const a = mesh.vertices[cara[i]] ?? { x: 0, y: 0, z: 0 };
      const b = mesh.vertices[cara[(i + 1) % cara.length]] ?? { x: 0, y: 0, z: 0 };
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
  }
  return { x: nx, y: ny, z: nz };
};

/**
 * Rompe la malla en N pedazos DESIGUALES (más segmentos ⇒ más pedazos):
 * reparte las caras con un Voronoi de semillas ponderadas al azar,
 * duplica los vértices de cada cara para que los pedazos queden sueltos
 * y esparce cada uno con giro y escala propios, APOYADO sobre el plano
 * de la base original (caída estática: al mover Fuerza ya están en el
 * suelo). No crea caras de corte nuevas: los interiores quedan huecos,
 * como un objeto rasgado. La fuerza 0 deja la malla intacta.
 */
function romper(mesh: Mesh, params: PluginParams): Mesh {
  const fuerza = num(params, 'fuerza', 0);
  if (fuerza <= 0) return mesh;
  const caras = mesh.faces.length;
  if (caras < 3 || mesh.vertices.length === 0) return mesh;

  // Caja original: diagonal para escalar la fuerza y min Y para el suelo.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of mesh.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(diagonal) || diagonal < 1e-9) return mesh;
  const baseY = minY;

  // Suelo REAL (params ocultos que manda el editor): el plano del suelo
  // visible del visor, escrito en coordenadas LOCALES del objeto (u =
  // dirección «arriba» en local, planoD = u·puntoDelSuelo). Sin ellos,
  // el suelo es la base de la malla original con vertical local Y.
  const suX = num(params, 'sueloUx', NaN);
  const suY = num(params, 'sueloUy', NaN);
  const suZ = num(params, 'sueloUz', NaN);
  const sueloD = num(params, 'sueloD', NaN);
  const lonU = Math.hypot(suX, suY, suZ);
  const usaSuelo =
    Number.isFinite(suX) &&
    Number.isFinite(suY) &&
    Number.isFinite(suZ) &&
    Number.isFinite(sueloD) &&
    lonU > 1e-9;
  const uS: Vertex3D = usaSuelo
    ? { x: suX / lonU, y: suY / lonU, z: suZ / lonU }
    : { x: 0, y: 1, z: 0 };
  const planoD = usaSuelo ? sueloD : baseY;
  // Proyección de un punto sobre la vertical del suelo: u·v.
  const altoDe = (v: Vertex3D) => v.x * uS.x + v.y * uS.y + v.z * uS.z;

  const giro = Math.max(0, num(params, 'giroVelocidad', 90));
  const escala = Math.max(0.02, num(params, 'tamanoFinal', 100) / 100);
  const aleat = Math.min(100, Math.max(0, num(params, 'aleatoriedad', 50))) / 100;
  // Caída: 0% flotan donde explotan, 100% todos apoyados en el suelo.
  // (0 por defecto: la fuerza del panel solo DISPERSA — que caigan lo
  // decide este campo, no la fuerza.)
  const caida = Math.min(100, Math.max(0, num(params, 'caida', 0))) / 100;
  const rnd = mulberryDeform(Math.round(num(params, 'semilla', 42)));

  // Centro de cada cara y del objeto entero.
  const centCara: Vertex3D[] = new Array(caras);
  let cxTotal = 0;
  let cyTotal = 0;
  let czTotal = 0;
  for (let f = 0; f < caras; f++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const cara = mesh.faces[f];
    for (const idx of cara) {
      const v = mesh.vertices[idx] ?? { x: 0, y: 0, z: 0 };
      sx += v.x;
      sy += v.y;
      sz += v.z;
    }
    const n = Math.max(1, cara.length);
    centCara[f] = { x: sx / n, y: sy / n, z: sz / n };
    cxTotal += centCara[f].x;
    cyTotal += centCara[f].y;
    czTotal += centCara[f].z;
  }
  const centroObj: Vertex3D = { x: cxTotal / caras, y: cyTotal / caras, z: czTotal / caras };

  // Nº de pedazos: cada uno ≈ el tamaño de UNA CARA — 1.4 caras de
  // media (unos de 1 cara, otros de 2-3; más segmentos ⇒ más pedazos).
  const piezas = Math.max(2, Math.min(Math.round(caras / 1.4), 2000));

  // Cuotas DESIGUALES: cada pedazo parte de 1 cara y el resto de caras
  // se reparte a favor de los «pesados» (aleatoriedad manda el skew),
  // con tope natural por pedazo — nunca chunks de decenas de caras.
  const pesos: number[] = [];
  let sumaPesos = 0;
  for (let i = 0; i < piezas; i++) {
    // Elevado al cubo: cola suave (los pesados pesan bastante más).
    const w = (1 - aleat + rnd() * 2 * aleat) ** 3;
    pesos.push(Math.max(0.01, w));
    sumaPesos += w;
  }
  const cuota: number[] = new Array(piezas);
  let usadas = 0;
  for (let i = 0; i < piezas; i++) {
    const q = Math.max(1, Math.round((caras * pesos[i]) / sumaPesos));
    cuota[i] = q;
    usadas += q;
  }
  // Corregir el redondeo hasta cuadrar con las caras de la malla.
  let dif = caras - usadas;
  while (dif > 0) {
    cuota[Math.floor(rnd() * piezas)]++;
    dif--;
  }
  while (dif < 0) {
    const i = Math.floor(rnd() * piezas);
    if (cuota[i] > 1) {
      cuota[i]--;
      dif++;
    }
  }

  // Vecinas de cada cara por topología canon (los crecimientos quedan
  // contiguos, como cascarones); sin topología, reparto suelto.
  let vecinas: number[][] | null = null;
  try {
    const topo = construirAnillos(mesh);
    if (topo) {
      vecinas = mesh.faces.map(() => [] as number[]);
      for (const grupo of topo.bordeAFaces.values()) {
        for (let i = 0; i < grupo.length; i++) {
          for (let j = i + 1; j < grupo.length; j++) {
            const a = grupo[i];
            const b = grupo[j];
            if (a === b) continue;
            if (!vecinas[a].includes(b)) vecinas[a].push(b);
            if (!vecinas[b].includes(a)) vecinas[b].push(a);
          }
        }
      }
    }
  } catch {
    vecinas = null;
  }

  // Crecimiento: semilla al azar por pedazo y expansión por vecinas
  // hasta la cuota; las caras sin frontera (islas sueltas) van al azar.
  const semillasUsadas = new Set<number>();
  while (semillasUsadas.size < Math.min(piezas, caras)) {
    semillasUsadas.add(Math.floor(rnd() * caras));
  }
  const pedazoDe: number[] = new Array(caras).fill(-1);
  const carasDe: number[][] = Array.from({ length: piezas }, () => [] as number[]);
  const colas: number[][] = Array.from({ length: piezas }, () => [] as number[]);
  [...semillasUsadas].forEach((f, p) => {
    pedazoDe[f] = p;
    carasDe[p].push(f);
    colas[p].push(f);
  });
  let sueltasRestantes = caras - semillasUsadas.size;
  while (sueltasRestantes > 0) {
    let avanza = false;
    for (let p = 0; p < piezas && sueltasRestantes > 0; p++) {
      if (carasDe[p].length >= cuota[p]) continue;
      const cola = colas[p];
      while (cola.length) {
        const f = cola.shift() as number;
        const tomada = (vecinas?.[f] ?? []).find((g) => pedazoDe[g] === -1);
        if (tomada === undefined) continue;
        pedazoDe[tomada] = p;
        carasDe[p].push(tomada);
        cola.push(tomada);
        sueltasRestantes--;
        avanza = true;
        break;
      }
    }
    if (!avanza) break; // sin vecindades libre: relleno al azar abajo
  }
  for (let f = 0; f < caras; f++) {
    if (pedazoDe[f] !== -1) continue;
    const p = Math.floor(rnd() * piezas);
    pedazoDe[f] = p;
    carasDe[p].push(f);
  }

  // Transform de cada pedazo: escala, eje/ángulo de giro al azar
  // (desigual via rand²) y desplazamiento radial XZ.
  const pedazos: PedazoRomper[] = carasDe.map((lista) => {
    const nC = Math.max(1, lista.length);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const f of lista) {
      px += centCara[f].x;
      py += centCara[f].y;
      pz += centCara[f].z;
    }
    const centro: Vertex3D = { x: px / nC, y: py / nC, z: pz / nC };

    let ax = 0;
    let ay = 0;
    let az = 0;
    let lon = 0;
    do {
      ax = rnd() - 0.5;
      ay = rnd() - 0.5;
      az = rnd() - 0.5;
      lon = Math.hypot(ax, ay, az);
    } while (!(lon > 1e-6));
    ax /= lon;
    ay /= lon;
    az /= lon;
    const angulo = ((giro * Math.PI) / 180) * rnd() * rnd();
    const seno = Math.sin(angulo);
    const cosA = Math.cos(angulo);

    // Aplanar al caer: la normal media del pedazo se gira hacia +uS
    // (la vertical del suelo; caida 100% = cara paralela al suelo, todo
    // el pedazo en el piso; intermedios se aplanan a medias; caida 0 no
    // aplana).
    const n0 = normalDeCaras(mesh, lista);
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let senoF = 0;
    let cosF = 1;
    if (caida > 1e-9 && Math.hypot(n0.x, n0.y, n0.z) > 1e-12) {
      const n1 = giraVector(n0, ax, ay, az, seno, cosA);
      const nxu = n1.y * uS.z - n1.z * uS.y;
      const nyu = n1.z * uS.x - n1.x * uS.z;
      const nzu = n1.x * uS.y - n1.y * uS.x;
      const cruzLon = Math.hypot(nxu, nyu, nzu); // |n1 × uS|
      if (cruzLon > 1e-12) {
        const phi = Math.atan2(cruzLon, n1.x * uS.x + n1.y * uS.y + n1.z * uS.z);
        const phi2 = phi * caida;
        if (phi2 > 1e-9) {
          fx = nxu / cruzLon;
          fy = nyu / cruzLon;
          fz = nzu / cruzLon;
          senoF = Math.sin(phi2);
          cosF = Math.cos(phi2);
        }
      }
    }

    // Dirección de vuelo: radial hacia fuera DENTRO del plano del suelo
    // (perpendicular a la vertical uS).
    const dirX = centro.x - centroObj.x;
    const dirY = centro.y - centroObj.y;
    const dirZ = centro.z - centroObj.z;
    const compoU = dirX * uS.x + dirY * uS.y + dirZ * uS.z;
    const horX = dirX - compoU * uS.x;
    const horY = dirY - compoU * uS.y;
    const horZ = dirZ - compoU * uS.z;
    const horLon = Math.hypot(horX, horY, horZ);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    if (horLon > 1e-9) {
      vx = horX / horLon;
      vy = horY / horLon;
      vz = horZ / horLon;
    } else {
      // Dirección horizontal al azar (base ortonormal en el plano ⟂ uS).
      const ejx = Math.abs(uS.x) > 0.9 ? 0 : 1;
      const ejy = ejx === 0 ? 1 : 0;
      const e1x = ejx - (ejx * uS.x + ejy * uS.y) * uS.x;
      const e1y = ejy - (ejx * uS.x + ejy * uS.y) * uS.y;
      const e1z = -(ejx * uS.x + ejy * uS.y) * uS.z;
      const e1Lon = Math.hypot(e1x, e1y, e1z) || 1;
      const e2x = uS.y * (e1z / e1Lon) - uS.z * (e1y / e1Lon);
      const e2y = uS.z * (e1x / e1Lon) - uS.x * (e1z / e1Lon);
      const e2z = uS.x * (e1y / e1Lon) - uS.y * (e1x / e1Lon);
      const a = rnd() * Math.PI * 2;
      vx = Math.cos(a) * (e1x / e1Lon) + Math.sin(a) * e2x;
      vy = Math.cos(a) * (e1y / e1Lon) + Math.sin(a) * e2y;
      vz = Math.cos(a) * (e1z / e1Lon) + Math.sin(a) * e2z;
    }
    const mag = (fuerza / 100) * diagonal * (0.3 + rnd());
    return {
      centro,
      escala,
      ax,
      ay,
      az,
      seno,
      cos: cosA,
      fx,
      fy,
      fz,
      senoF,
      cosF,
      dx: vx * mag,
      dy: vy * mag,
      dz: vz * mag,
    };
  });

  // Duplicar vértices cara a cara (fronteras sueltas entre pedazos) y
  // transformar. Los arrays por-cara quedan alineados porque el ORDEN
  // de las caras no cambia.
  const nuevosVertices: Vertex3D[] = [];
  const nuevasCaras: number[][] = new Array(caras);
  const nuevosUvs: [number, number][] | undefined = mesh.uvs ? [] : undefined;
  const indicesDe: number[][] = pedazos.map(() => []);
  for (let f = 0; f < caras; f++) {
    const t = pedazos[pedazoDe[f]];
    const cara = mesh.faces[f];
    const nueva: number[] = [];
    for (const idx of cara) {
      const origen = mesh.vertices[idx] ?? { x: 0, y: 0, z: 0 };
      const i = nuevosVertices.length;
      nuevosVertices.push(puntoRomper(origen, t));
      indicesDe[pedazoDe[f]].push(i);
      nueva.push(i);
      if (nuevosUvs) {
        const uv = mesh.uvs?.[idx] ?? [0, 0];
        nuevosUvs.push([uv[0], uv[1]]);
      }
    }
    nuevasCaras[f] = nueva;
  }

  // Caída (aplastado vertical): a 100% CADA VÉRTICE baja hasta el plano
  // REAL del suelo (dado por el editor en coords locales) — el pedazo
  // queda aplastado plano sobre el suelo aunque esté combado (dos caras
  // en ángulo nunca se tumban planas con un giro rígido: la normal media
  // se alinea pero las caras siguen a ±45°); 0% se queda donde explotó.
  // Intermedios: compresión y descenso proporcionales.
  for (let p = 0; p < indicesDe.length; p++) {
    const lista = indicesDe[p];
    if (!lista.length) continue;
    for (const i of lista) {
      const v = nuevosVertices[i];
      const salto = (planoD - altoDe(v)) * caida;
      if (salto === 0) continue;
      v.x += uS.x * salto;
      v.y += uS.y * salto;
      v.z += uS.z * salto;
    }
  }

  return { ...mesh, vertices: nuevosVertices, faces: nuevasCaras, uvs: nuevosUvs ?? mesh.uvs };
}

/* ------------------------------------------------------------------ */
/* Registro                                                           */
/* ------------------------------------------------------------------ */

const paramsDePlugin = (id: string): PluginParam[] => {
  const p = DEFORMADORES.find((d) => d.id === id);
  return p ? p.params : [];
};

/**
 * Sustituye el valor por defecto de algunos sliders del plugin: en los
 * BOTONES DIRECTOS el estado inicial es NEUTRO (el objeto aparece sin
 * deformar y el usuario lo dobla/afila él con los campos). El modal de
 * plugins conserva sus defaults originales.
 */
const conValor = (
  params: PluginParam[],
  cambios: Record<string, number>
): PluginParam[] =>
  params.map((p) =>
    p.tipo === 'slider' && cambios[p.id] !== undefined
      ? { ...p, valor: cambios[p.id] }
      : p
  );

const biselParams: PluginParam[] = [
  {
    tipo: 'slider',
    id: 'radio',
    etiqueta: 'Radio',
    min: 0,
    max: 50,
    paso: 1,
    valor: 0,
    unidad: '%',
    descripcion:
      'Tamaño del chaflán relativo a la caja del objeto (0 = sin bisel). En figuras muy voxelizadas puede no apretar.',
  },
];

const biselPlanoParams: PluginParam[] = [
  {
    tipo: 'slider',
    id: 'separacion',
    etiqueta: 'Separación',
    min: 0,
    max: 50,
    paso: 1,
    valor: 0,
    unidad: '%',
    descripcion:
      'Ancho del marco interior, % de la dimensión menor del polígono en su plano (0 = sin marco). Captura las caras del botón Polígono al entrar.',
  },
  {
    tipo: 'slider',
    id: 'profInterior',
    etiqueta: 'Profundidad interior',
    min: -100,
    max: 100,
    paso: 1,
    valor: 0,
    unidad: '%',
    descripcion:
      'Sube (positivo) o hunde (negativo) el polígono que queda DENTRO del marco, % de la diagonal de la caja. Con CTRL: congela el marco DONDE ESTÁ (sin salto) y el interior sigue en solitario; el gesto queda fijado.',
  },
  {
    tipo: 'slider',
    id: 'profMarco',
    etiqueta: 'Profundidad del marco',
    min: -100,
    max: 100,
    paso: 1,
    valor: 0,
    unidad: '%',
    descripcion:
      'Sube (positivo) o hunde (negativo) el borde EXTERIOR del marco, % de la diagonal de la caja. Las caras vecinas se inclinan con él (marco «extruido»).',
  },
];

/**
 * Slider común de la GUÍA en los deformadores con eje posicional
 * (doblar, enroscar, sesgar, afilar, derretir): 0 = donde empezaba de
 * siempre (neutro exacto), 0–100 = posición a lo largo del eje. En la
 * ventana 3D hay una GUÍA NARANJA arrastrable (la asa la mueve
 * handleDeformPreviewParams con el mismo param).
 */
const paramGuia: PluginParam = {
  tipo: 'slider',
  id: 'guia',
  etiqueta: 'Guía',
  min: 0,
  max: 100,
  paso: 1,
  valor: 0,
  unidad: '%',
  descripcion:
    'Dónde empieza/centra la deformación a lo largo del eje: 0 = donde empezaba de siempre (la base de la caja), 50 = el centro, 100 = el otro extremo. También se arrastra la guía naranja en la ventana 3D.',
};

export const DEFORMADORES_DIRECTOS: DeformadorDirecto[] = [
  {
    id: 'doblar',
    nombre: 'Doblar',
    icono: '/icons/Doblar.png',
    // Neutro al entrar: el usuario dobla desde 0 con el campo.
    params: conValor(paramsDePlugin('doblar'), { angulo: 0 }),
    aplicar: (mesh, params) => {
      if (Math.abs(num(params, 'angulo', 0)) < 1e-9) return mesh;
      return pluginAplicar('doblar', mesh, params);
    },
  },
  {
    id: 'enroscar',
    nombre: 'Enroscar',
    icono: '/icons/Enroscar.png',
    params: conValor(paramsDePlugin('torcer'), { angulo: 0 }),
    aplicar: (mesh, params) => {
      if (Math.abs(num(params, 'angulo', 0)) < 1e-9) return mesh;
      return pluginAplicar('torcer', mesh, params);
    },
  },
  {
    id: 'bisel',
    nombre: 'Bisel',
    icono: '/icons/Bisel.png',
    params: biselParams,
    aplicar: (mesh, params) => bisel(mesh, params),
  },
  {
    id: 'bisel-plano',
    nombre: 'Bisel plano',
    icono: '/icons/Bisel Plano.png',
    params: biselPlanoParams,
    // El param OCULTO carasSel llega del editor (caras capturadas con el
    // botón Polígono al entrar): no va en params para no salir en panel.
    aplicar: (mesh, params) => biselPlano(mesh, params),
  },
  {
    id: 'hinchar',
    nombre: 'Hinchar',
    icono: '/icons/Hinchar.png',
    params: [
      {
        tipo: 'slider',
        id: 'amplitud',
        etiqueta: 'Amplitud',
        min: -100,
        max: 200,
        paso: 1,
        valor: 0,
        unidad: '%',
      },
    ],
    aplicar: (mesh, params) => hinchar(mesh, params),
  },
  {
    id: 'sesgar',
    nombre: 'Sesgar',
    icono: '/icons/Sesgar.png',
    params: [
      {
        tipo: 'slider',
        id: 'desplazamiento',
        etiqueta: 'Desplazamiento',
        min: -100,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: '%',
      },
      {
        tipo: 'select',
        id: 'eje',
        etiqueta: 'Eje de sesgado',
        opciones: EJES,
        valor: 'y',
      },
      paramGuia,
    ],
    aplicar: (mesh, params) => sesgar(mesh, params),
  },
  {
    id: 'suavizado',
    nombre: 'Suavizado',
    icono: '/icons/Suavizado.png',
    params: [
      {
        tipo: 'slider',
        id: 'iteraciones',
        etiqueta: 'Intensidad',
        min: 0,
        max: 10,
        paso: 1,
        valor: 0,
      },
    ],
    aplicar: (mesh, params) => {
      const iteraciones = Math.round(num(params, 'iteraciones', 0));
      if (iteraciones <= 0) return mesh; // neutro: 0 iteraciones = nada
      return smoothVoxelMesh(mesh, iteraciones);
    },
  },
  {
    id: 'afilar',
    nombre: 'Afilar',
    icono: '/icons/Afilar.png',
    // Neutro: base y cima a 100% (el usuario afina él).
    params: conValor(paramsDePlugin('afilar'), { escalaFin: 100 }),
    aplicar: (mesh, params) => pluginAplicar('afilar', mesh, params),
  },
  {
    id: 'derretir',
    nombre: 'Derretir',
    icono: '/icons/Derretir.png',
    params: [
      {
        tipo: 'slider',
        id: 'caida',
        etiqueta: 'Caída',
        min: 0,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: '%',
      },
      {
        tipo: 'slider',
        id: 'ensanche',
        etiqueta: 'Ensanche en la base',
        min: 0,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: '%',
      },
      {
        tipo: 'select',
        id: 'eje',
        etiqueta: 'Eje vertical',
        opciones: EJES,
        valor: 'y',
      },
      paramGuia,
    ],
    aplicar: (mesh, params) => derretir(mesh, params),
  },
  {
    id: 'romper',
    nombre: 'Romper',
    icono: '/icons/Romper.png',
    params: [
      {
        tipo: 'slider',
        id: 'fuerza',
        etiqueta: 'Fuerza',
        min: 0,
        max: 300,
        paso: 1,
        valor: 0,
        unidad: '%',
        descripcion:
          'Con cuánta violencia se esparcen los pedazos (0 = sin romper; 100 = dispersión del tamaño del objeto). Cuantos más segmentos tenga la pieza, más pedazos salen (cada uno del tamaño de una cara, no todos iguales).',
      },
      {
        tipo: 'slider',
        id: 'caida',
        etiqueta: 'Caída',
        min: 0,
        max: 100,
        paso: 1,
        // 0 por defecto: la FUERZA solo dispersa (explosión congelada);
        // caer al suelo lo manda SU campo, Caída — antes con 100 de
        // default CUALQUIER fuerza (hasta 1) tiraba todo al suelo.
        valor: 0,
        unidad: '%',
        descripcion:
          '0% = los pedazos se quedan flotando por el aire, como una explosión congelada. 100% = caen al suelo y se tumban: TODOS quedan apoyados planos, ninguno flotando. Los intermedios caen y se tumban a medias.',
      },
      {
        tipo: 'slider',
        id: 'giroVelocidad',
        etiqueta: 'Velocidad de ángulo',
        min: 0,
        max: 720,
        paso: 5,
        valor: 90,
        unidad: '°',
        descripcion: 'Giro que sale volando cada pedazo (cada uno gira distinto, hasta ese ángulo).',
      },
      {
        tipo: 'slider',
        id: 'tamanoFinal',
        etiqueta: 'Tamaño final',
        min: 5,
        max: 100,
        paso: 1,
        valor: 100,
        unidad: '%',
        descripcion: 'Escala de cada pedazo: 100% los deja intactos, 50% los deja a la mitad.',
      },
      {
        tipo: 'slider',
        id: 'aleatoriedad',
        etiqueta: 'Aleatoriedad',
        min: 0,
        max: 100,
        paso: 1,
        valor: 50,
        unidad: '%',
        descripcion: 'Lo desigual del reparto: tamaños y vuelos distintos entre pedazos.',
      },
      {
        tipo: 'slider',
        id: 'semilla',
        etiqueta: 'Semilla',
        min: 1,
        max: 999,
        paso: 1,
        valor: 42,
      },
    ],
    aplicar: (mesh, params) => romper(mesh, params),
  },
];

export function deformadorPorId(id: string): DeformadorDirecto | null {
  return DEFORMADORES_DIRECTOS.find((d) => d.id === id) ?? null;
}

/**
 * Aplica el deformador con los valores por defecto rellenados a partir
 * de sus params (los campos que aún no existen viajan con su valor
 * inicial). Jamás muta `mesh`; si algo falla devuelve la original.
 */
export function aplicarDeformador(
  id: string,
  mesh: Mesh,
  params: PluginParams
): Mesh {
  const def = deformadorPorId(id);
  if (!def) return mesh;
  const llenos: PluginParams = { ...params };
  for (const p of def.params) {
    if (llenos[p.id] === undefined) llenos[p.id] = p.valor;
  }
  try {
    return def.aplicar(mesh, llenos);
  } catch (error) {
    console.warn('[deformadores] Falló el deformador, se deja la malla tal cual:', error);
    return mesh;
  }
}

/* ------------------------------------------------------------------ */
/* Deformadores sobre GRUPOS («como si fuera 1»)                       */
/* ------------------------------------------------------------------ */

/**
 * Matriz de rotación 3×3 con el orden de ángulos XYZ (la MISMA convención
 * que THREE.Euler(rx, ry, rz) — rotación intrínseca X luego Y luego Z,
 * R = Rx·Ry·Rz). Verificada numéricamente contra makeRotationFromEuler.
 */
function rotacionXYZ(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rx·Ry·Rz (fila por fila)
  return [
    cy * cz, -cy * sz, sy,
    sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy,
    -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy,
  ];
}

/** Aplica el transform (escala → rotación → posición, como THREE.compose). */
export function aplicarTransformacion(
  t: ObjectTransform,
  v: Vertex3D
): Vertex3D {
  const r = rotacionXYZ(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  const x = (t.sx ?? 1) * v.x, y = (t.sy ?? 1) * v.y, z = (t.sz ?? 1) * v.z;
  return {
    x: r[0] * x + r[1] * y + r[2] * z + (t.px ?? 0),
    y: r[3] * x + r[4] * y + r[5] * z + (t.py ?? 0),
    z: r[6] * x + r[7] * y + r[8] * z + (t.pz ?? 0),
  };
}

/** Inversa exacta (afín con escala): primero posición, luego Rᵀ, luego /escala. */
export function aplicarTransformacionInversa(
  t: ObjectTransform,
  v: Vertex3D
): Vertex3D {
  const r = rotacionXYZ(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  const dx = v.x - (t.px ?? 0), dy = v.y - (t.py ?? 0), dz = v.z - (t.pz ?? 0);
  // Transpuesta (columna i de R = fila i de la inversa):
  const x = r[0] * dx + r[3] * dy + r[6] * dz;
  const y = r[1] * dx + r[4] * dy + r[7] * dz;
  const z = r[2] * dx + r[5] * dy + r[8] * dz;
  return { x: x / (t.sx || 1), y: y / (t.sy || 1), z: z / (t.sz || 1) };
}

export interface MiembroGrupoDeformador {
  id: string;
  mesh: Mesh;
  transform: ObjectTransform;
}

export interface UnionGrupoDeformador {
  /** Las mallas unidas en el marco `marco` (coordenadas de ese objeto). */
  unida: Mesh;
  partes: Array<{
    id: string;
    /** Índice del PRIMER vértice / cara de este miembro en `unida`. */
    vinicio: number;
    finicio: number;
    /** La malla local original (para restaurar sus campos de textura). */
    base: Mesh;
    transform: ObjectTransform;
    /** El miembro tenía UVs propias: si no, el reparto NO debe inventar
     * [0,0] — el constructor del visual las proyecta (si no, la textura
     * colapsa a un texel: «el objeto pierde la textura» al deformar). */
    teniaUVs: boolean;
    teniaColores: boolean;
    teniaOpacidades: boolean;
    teniaTexturas: boolean;
    teniaGruposT: boolean;
  }>;
  /** El transform cuyo espacio local es el de `unida`. */
  marco: ObjectTransform;
}

/** Índice de la PRIMERA cara de `id` en la unión de `miembros` (suma de
 * caras de los miembros anteriores); -1 si el miembro no está. Sirve para
 * remapear carasSel (que indexa la malla base del miembro dueño) hacia la
 * malla UNIDA del grupo. */
export function finicioDeMiembro(
  miembros: MiembroGrupoDeformador[],
  id: string
): number {
  let acc = 0;
  for (const mi of miembros) {
    if (mi.id === id) return acc;
    acc += mi.mesh.faces.length;
  }
  return -1;
}

/**
 * Une las mallas de los miembros en el marco del objeto seleccionado
 * (`marco`): cada miembro entra con M = Marco⁻¹·L_miembro. La UNION no
 * duplica vértices entre miembros (cada uno conserva sus datos por cara
 * y por vértice: colores, opacidades, texturas, UVs).
 */
export function unirMallasComoGrupo(
  miembros: MiembroGrupoDeformador[],
  marco: ObjectTransform
): UnionGrupoDeformador {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const faceColors: (string | null)[] = [];
  const faceOpacities: number[] = [];
  const faceTextures: (string | null)[] = [];
  const faceTextureGroups: (string | null)[] = [];
  const uvs: [number, number][] = [];
  const hayUVs = miembros.some((m) => !!m.mesh.uvs);

  const partes = miembros.map((miembro) => {
    const vinicio = vertices.length;
    const finicio = faces.length;
    for (const v of miembro.mesh.vertices) {
      const enMarco = aplicarTransformacion(miembro.transform, v);
      vertices.push(aplicarTransformacionInversa(marco, enMarco));
    }
    for (const f of miembro.mesh.faces) {
      faces.push(f.map((indice) => indice + vinicio));
    }
    // Los arrays por cara SIEMPRE se emiten (null/1 donde el miembro no
    // define): así el SLICE del reparto conserva los valores del miembro
    // que SÍ los tenía aunque el resto no traiga el array.
    const caras = miembro.mesh.faces.length;
    for (let c = 0; c < caras; c++) {
      faceColors.push(miembro.mesh.faceColors?.[c] ?? null);
      faceOpacities.push(miembro.mesh.faceOpacities?.[c] ?? 1);
      faceTextures.push(miembro.mesh.faceTextures?.[c] ?? null);
      faceTextureGroups.push(miembro.mesh.faceTextureGroups?.[c] ?? null);
    }
    if (hayUVs) {
      const uvsMiembro = miembro.mesh.uvs;
      for (let vi = 0; vi < miembro.mesh.vertices.length; vi++) {
        uvs.push(uvsMiembro?.[vi] ?? [0, 0]);
      }
    }
    return {
      id: miembro.id, vinicio, finicio, base: miembro.mesh, transform: miembro.transform,
      teniaUVs: !!miembro.mesh.uvs,
      teniaColores: !!miembro.mesh.faceColors,
      teniaOpacidades: !!miembro.mesh.faceOpacities,
      teniaTexturas: !!miembro.mesh.faceTextures,
      teniaGruposT: !!miembro.mesh.faceTextureGroups,
    };
  });

  const unida: Mesh = {
    vertices,
    faces,
    ...(faceColors.length ? { faceColors } : {}),
    ...(faceOpacities.length ? { faceOpacities } : {}),
    ...(faceTextures.length ? { faceTextures } : {}),
    ...(faceTextureGroups.length ? { faceTextureGroups } : {}),
    ...(hayUVs && uvs.length ? { uvs } : {}),
    // Campos de malla (nivel objeto): los del primer miembro (el marco).
    ...deNivelObjeto(miembros[0]?.mesh),
  };
  return { unida, partes, marco };
}

/** Reparte la unida DEFORMADA a los espacios locales de cada miembro. */
export function repartirGrupoDeformado(
  union: UnionGrupoDeformador,
  deformada: Mesh
): MiembroGrupoDeformador[] {
  const total = deformada.vertices.length;
  return union.partes.map((parte, i) => {
    const sigV = i + 1 < union.partes.length ? union.partes[i + 1].vinicio : total;
    const sigF = i + 1 < union.partes.length ? union.partes[i + 1].finicio : deformada.faces.length;
    // v_local = L_miembro⁻¹·(Marco·p_marco) — cada miembro conserva SU
    // transform: el visor lo vuelve a colocar exactamente donde estaba.
    const vertices = deformada.vertices
      .slice(parte.vinicio, sigV)
      .map((p) =>
        aplicarTransformacionInversa(
          parte.transform,
          aplicarTransformacion(union.marco, p)
        )
      );
    const mallaLocal: Mesh = {
      ...deNivelObjeto(parte.base),
      vertices,
      faces: deformada.faces
        .slice(parte.finicio, sigF)
        .map((f) => f.map((indice) => indice - parte.vinicio)),
      // SOLO los arrays que el miembro LLEVABA: inventarlos (de nulls o
      // de 1s) cambia la RAMA del visual — uvs [0,0] colapsan la textura
      // proyectada, faceColors de nulls puede tapar el color del objeto…
      ...(parte.teniaColores ? { faceColors: deformada.faceColors?.slice(parte.finicio, sigF) } : {}),
      ...(parte.teniaOpacidades ? { faceOpacities: deformada.faceOpacities?.slice(parte.finicio, sigF) ?? [] } : {}),
      ...(parte.teniaTexturas ? { faceTextures: deformada.faceTextures?.slice(parte.finicio, sigF) } : {}),
      ...(parte.teniaGruposT ? { faceTextureGroups: deformada.faceTextureGroups?.slice(parte.finicio, sigF) } : {}),
      // UVs SOLO si el miembro LLEVABA: los [0,0] inventados mandan sobre
      // la proyección y la textura colapsa a un texel.
      ...(union.unida.uvs && parte.teniaUVs
        ? { uvs: deformada.uvs?.slice(parte.vinicio, sigV) ?? [] }
        : {}),
    };
    return { id: parte.id, mesh: mallaLocal, transform: parte.transform };
  });
}

/** Copia SOLO los campos de nivel objeto de una malla (sin arrays por cara). */
function deNivelObjeto(m: Mesh | undefined): Partial<Mesh> {
  if (!m) return {};
  const { vertices: _v, faces: _f, faceColors: _c, faceOpacities: _o, faceTextures: _t, faceTextureGroups: _g, uvs: _u, ...resto } = m;
  return resto as Partial<Mesh>;
}

/**
 * DEFORMAR UN GRUPO COMO UNA SOLA PIEZA: une las mallas en el marco del
 * seleccionado, aplica el deformador UNA VEZ (la caja envolvente es la
 * COMBINADA de todos los miembros — el arco/explosión los mueve juntos)
 * y reparte el resultado a cada miembro en SU espacio local.
 * Si el deformador sale neutral (misma malla), devuelve las locales
 * originales sin recomponer.
 */
export function deformarGrupoComoUnidad(
  id: string,
  marco: ObjectTransform,
  miembros: MiembroGrupoDeformador[],
  params: PluginParams
): { porMiembro: MiembroGrupoDeformador[]; unida: Mesh } | null {
  return deformarGrupoCadena(marco, miembros, [{ tipo: id, params }]);
}

/**
 * CADENA de deformadores sobre un GRUPO ( playback de pistas de deformador
 * de grupo): une las mallas en el marco, aplica TODOS los deformadores en
 * orden y reparte el resultado — exactamente como el modo directo de la
 * Escena pero con varios pasos. Sin cadena o sin salida → las mallas
 * base intactas.
 */
export function deformarGrupoCadena(
  marco: ObjectTransform,
  miembros: MiembroGrupoDeformador[],
  cadena: Array<{ tipo: string; params: PluginParams }>
): { porMiembro: MiembroGrupoDeformador[]; unida: Mesh } | null {
  if (miembros.length === 0) return null;
  const union = unirMallasComoGrupo(miembros, marco);
  let m = union.unida;
  for (const paso of cadena) {
    const salida = aplicarDeformador(paso.tipo, m, paso.params);
    if (salida && salida.vertices.length > 0 && salida.faces.length > 0) m = salida;
  }
  if (m === union.unida) {
    // Sin deformación (neutro o error): las mallas base sin tocar.
    return { porMiembro: miembros.map((mi) => ({ id: mi.id, mesh: mi.mesh, transform: mi.transform })), unida: union.unida };
  }
  return { porMiembro: repartirGrupoDeformado(union, m), unida: m };
}