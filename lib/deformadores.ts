import type { Mesh, Vertex3D } from '@/lib/geometry';
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
  | 'romper';

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
 * la extensión transversal.
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

  const vertices = mesh.vertices.map((v) => {
    const t =
      (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
    return conEje(v, e1, leerEje(v, e1) + total * t);
  });
  return { ...mesh, vertices };
}

/* ------------------------------------------------------------------ */
/* Derretir (derrame hacia la base, como Melt de 3ds Max)             */
/* ------------------------------------------------------------------ */

/**
 * Los vértices altos ceden hacia abajo con caída ∝ t² (t = altura) y la
 * base se ensancha (barril derretido). Determinista.
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

  const vertices = mesh.vertices.map((v) => {
    const t =
      (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
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
  const caida = Math.min(100, Math.max(0, num(params, 'caida', 100))) / 100;
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
        valor: 100,
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