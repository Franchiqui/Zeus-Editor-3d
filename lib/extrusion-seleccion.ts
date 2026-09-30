/**
 * Extrusión real de la SELECCIÓN (estilo Blender): al sacar un rectángulo
 * seleccionado hacia fuera se duplican sus vértices, el duplicado se
 * mueve con el delta pedido y las PAREDES van rectas del anillo original
 * al anillo duplicado. Las caras vecinas NO se estiran: lo que se extrae
 * es exactamente lo seleccionado.
 *
 * Las caras originales SE CONSERVAN (la malla solo crece): el original
 * queda como base del volumen (cerrado), la copia movida es la tapa.
 * Los índices de la malla previa no cambian, así el historial y las
 * caras de antes siguen siendo válidos.
 *
 * Si el desplazamiento apunta DENTRO del cuerpo, lo pedido es un hueco:
 * las caras originales de la región se QUITAN (la boca queda abierta y
 * se ven las paredes y el suelo del hueco) y los índices de las caras
 * posteriores se reducen en la misma cuenta. El resultado indica en
 * `retiradas` cuántas se quitaron para saber si hay que remapear.
 */
import type { Mesh, Vertex3D } from './geometry';

export type ObjetivoSeleccion = 'cara' | 'vertice' | 'segmento';

/** Clave canónica de arista «menor-mayor» (igual que usa el visor). */
function claveArista(a: number, b: number): string {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
}

/** Aristas de una malla deducidas de las caras, sin repetir. */
export function aristasDeMalla(mesh: Mesh): Array<{ a: number; b: number; key: string }> {
  const vistas = new Set<string>();
  const lista: Array<{ a: number; b: number; key: string }> = [];
  for (const cara of mesh.faces) {
    for (let i = 0; i < cara.length; i++) {
      const va = cara[i];
      const vb = cara[(i + 1) % cara.length];
      if (va === vb) continue;
      const key = claveArista(va, vb);
      if (vistas.has(key)) continue;
      vistas.add(key);
      lista.push({ a: Math.min(va, vb), b: Math.max(va, vb), key });
    }
  }
  return lista;
}

/**
 * Caras que forman la región extraíble según el tipo de selección:
 * - cara:     las caras seleccionadas.
 * - vertice:  las caras con TODOS sus vértices seleccionados (un rectángulo
 *             marcado con sus 4 esquinas extrae ese rectángulo entero).
 * - segmento: las caras con TODAS sus aristas seleccionadas.
 */
export function regionSegunObjetivo(
  mesh: Mesh,
  objetivo: ObjetivoSeleccion,
  carasSel: number[],
  verticesSel: number[],
  aristasSel: string[],
): number[] {
  const total = mesh.faces.length;
  if (objetivo === 'cara') {
    return carasSel.filter((f) => f >= 0 && f < total);
  }
  if (objetivo === 'vertice') {
    const sel = new Set(verticesSel);
    return mesh.faces
      .map((_, i) => i)
      .filter((i) => mesh.faces[i].every((v) => sel.has(v)));
  }
  if (objetivo === 'segmento') {
    const sel = new Set(aristasSel);
    return mesh.faces
      .map((_, i) => i)
      .filter((i) => {
        const cara = mesh.faces[i];
        for (let k = 0; k < cara.length; k++) {
          const va = cara[k];
          const vb = cara[(k + 1) % cara.length];
          if (va === vb) continue;
          if (!sel.has(claveArista(va, vb))) return false;
        }
        return true;
      });
  }
  return [];
}

export type ExtrusionResultado = {
  /** Nueva malla completa (los índices previos intactos). */
  mesh: Mesh;
  /** Índices de las caras «tapa» (copias movidas), en el orden de la región. */
  carasNuevas: number[];
  /** Índices de las caras-pared creadas. */
  paredes: number[];
  /** Índices de los vértices duplicados (los que se movieron). */
  verticesNuevos: number[];
  /** original → duplicado. */
  vmap: Map<number, number>;
  /** Clave de arista vieja del anillo → clave entre duplicados. */
  mapaAristas: Map<string, string>;
  /** Caras originales que se quitaron (0 hacia fuera; la región hacia dentro). */
  retiradas: number;
  /** true si el desplazamiento apuntaba dentro del cuerpo (hizo hueco). */
  haciaDentro: boolean;
};

/**
 * Extrae las caras `carasRegion` con el vector `delta`: crea los
 * duplicados (tapa), las paredes hacia el anillo original fijo, y
 * devuelve la malla completa más los índices nuevos para reasignar la
 * selección. Devuelve null si la región está vacía o sin anillo.
 */
export function extrudeRegionMesh(
  mesh: Mesh,
  carasRegion: number[],
  delta: Vertex3D,
): ExtrusionResultado | null {
  const totalCaras = mesh.faces.length;
  const region = carasRegion.filter((f) => f >= 0 && f < totalCaras);
  if (region.length === 0) return null;

  // Anillo frontera: aristas de grado 1 entre las caras de la región
  // (una arista compartida por dos caras de la región es INTERIOR y no
  // crea pared; solo el borde toca el resto del objeto).
  const grado = new Map<string, number>();
  for (const idx of region) {
    const cara = mesh.faces[idx];
    for (let k = 0; k < cara.length; k++) {
      const va = cara[k];
      const vb = cara[(k + 1) % cara.length];
      if (va === vb) continue;
      const key = claveArista(va, vb);
      grado.set(key, (grado.get(key) ?? 0) + 1);
    }
  }
  const frontera = new Set([...grado.entries()].filter(([, g]) => g === 1).map(([k]) => k));
  if (frontera.size === 0) return null;

  // Duplicados: cada vértice de la región tiene una copia movida.
  const vmap = new Map<number, number>();
  const verticesDuplicados: Vertex3D[] = [];
  for (const idx of region) {
    for (const v of mesh.faces[idx]) {
      if (vmap.has(v)) continue;
      const orig = mesh.vertices[v] ?? { x: 0, y: 0, z: 0 };
      vmap.set(v, mesh.vertices.length + verticesDuplicados.length);
      verticesDuplicados.push({ x: orig.x + delta.x, y: orig.y + delta.y, z: orig.z + delta.z });
    }
  }
  if (vmap.size === 0) return null;

  const vertices = [...mesh.vertices, ...verticesDuplicados];

  // ¿El desplazamiento apunta DENTRO del cuerpo? Se usa la media de las
  // NORMALES de las caras de la región (salen de su orientación misma en
  // la malla, como hace el visor al construir). Extrudir EN CONTRA de la
  // normal hunde el trozo dentro de la superficie: lo que se pide es un
  // HUECO, así que las caras originales se QUITAN, dejando la boca
  // abierta para ver las paredes y el suelo. A favor (o tangente) se
  // conservan: el original queda de base y el bloque sale cerrado.
  let dentro = false;
  {
    let nx = 0, ny = 0, nz = 0, cuenta = 0;
    for (const idx of region) {
      const cara = mesh.faces[idx];
      if (cara.length < 3) continue;
      const a = mesh.vertices[cara[0]];
      const b = mesh.vertices[cara[1]];
      const c = mesh.vertices[cara[2]];
      if (!a || !b || !c) continue;
      const u1x = b.x - a.x, u1y = b.y - a.y, u1z = b.z - a.z;
      const u2x = c.x - a.x, u2y = c.y - a.y, u2z = c.z - a.z;
      let cxp = u1y * u2z - u1z * u2x;
      let cyp = u1z * u2x - u1x * u2z;
      let czp = u1x * u2y - u1y * u2x;
      const l1 = Math.hypot(cxp, cyp, czp);
      if (l1 < 1e-12) continue;
      nx += cxp / l1; ny += cyp / l1; nz += czp / l1; cuenta++;
    }
    if (cuenta > 0) {
      const largo = Math.hypot(nx, ny, nz);
      if (largo > 1e-9) {
        const dot = delta.x * (nx / largo) + delta.y * (ny / largo) + delta.z * (nz / largo);
        dentro = dot < -1e-6;
      }
    }
  }

  const mapaAristas = new Map<string, string>();

  // Primera pasada: tapa (copia de cada cara de la región, sobre
  // duplicados). Mismo orden que la región → carasNuevas[i] ↔ region[i].
  const tapas: Array<{ copia: number[]; base: number }> = [];
  for (const idx of region) {
    const cara = mesh.faces[idx];
    const copia = cara.map((v) => vmap.get(v) ?? v);
    tapas.push({ copia, base: idx });
  }

  // Segunda pasada: paredes por cada arista del ANILLO, recorriendo la
  // región en orden; el par consecutivo sale de la cara original para
  // que la pared siga la orientación de la superficie de la que salió.
  const nuevasParedes: number[][] = [];
  const basesDePared: number[] = [];
  for (const tapa of tapas) {
    const cara = mesh.faces[tapa.base];
    for (let k = 0; k < cara.length; k++) {
      const va = cara[k];
      const vb = cara[(k + 1) % cara.length];
      if (va === vb) continue;
      const key = claveArista(va, vb);
      if (!frontera.has(key)) continue;
      const va2 = vmap.get(va) ?? va;
      const vb2 = vmap.get(vb) ?? vb;
      nuevasParedes.push([va, vb, vb2, va2]);
      basesDePared.push(tapa.base);
      mapaAristas.set(key, claveArista(va2, vb2));
    }
  }

  // Malla final: caras originales (sin las de la región si es hueco) +
  // tapas + paredes. Los índices que quedan de la malla previa se
  // remapean; los arrays por cara (color, opacidad, textura, grupo) se
  // reconstruyen alineados, con las nuevas caras heredando de su base.
  const regionSet = new Set(region);
  const coloresVieja = mesh.faceColors ?? null;
  const opacidadesVieja = mesh.faceOpacities ?? null;
  const texturasVieja = mesh.faceTextures ?? null;
  const gruposVieja = mesh.faceTextureGroups ?? null;
  const facesFinal: number[][] = [];
  const colores: (string | null)[] | null = coloresVieja ? [] : null;
  const opacidades: number[] | null = opacidadesVieja ? [] : null;
  const texturas: (string | null)[] | null = texturasVieja ? [] : null;
  const grupos: (string | null)[] | null = gruposVieja ? [] : null;
  for (let i = 0; i < mesh.faces.length; i++) {
    if (dentro && regionSet.has(i)) continue;
    facesFinal.push(mesh.faces[i]);
    if (colores) colores.push(coloresVieja![i] ?? null);
    if (opacidades) opacidades.push(opacidadesVieja![i] ?? 1);
    if (texturas) texturas.push(texturasVieja![i] ?? null);
    if (grupos) grupos.push(gruposVieja![i] ?? null);
  }

  const carasNuevas: number[] = [];
  const paredes: number[] = [];
  const hereda = (nueva: number, base: number) => {
    if (colores) colores[nueva] = coloresVieja![base] ?? null;
    if (opacidades) opacidades[nueva] = opacidadesVieja![base] ?? 1;
    if (texturas) texturas[nueva] = texturasVieja![base] ?? null;
    if (grupos) grupos[nueva] = gruposVieja![base] ?? null;
  };
  for (const tapa of tapas) {
    carasNuevas.push(facesFinal.length);
    facesFinal.push(tapa.copia);
    hereda(facesFinal.length - 1, tapa.base);
  }
  for (let i = 0; i < nuevasParedes.length; i++) {
    paredes.push(facesFinal.length);
    facesFinal.push(nuevasParedes[i]);
    hereda(facesFinal.length - 1, basesDePared[i]);
  }

  // Los duplicados heredan las UV del vértice original (la textura viaja
  // con la cara movida; el visor recalcula de todas formas por cara).
  let uvs: [number, number][] | undefined;
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    uvs = [...mesh.uvs];
    for (const [orig, dup] of vmap) {
      uvs[dup] = uvs[orig] ?? uvs[dup];
    }
  }

  const resultado: Mesh = {
    ...mesh,
    vertices,
    faces: facesFinal,
  };
  if (colores) resultado.faceColors = colores;
  if (opacidades) resultado.faceOpacities = opacidades;
  if (texturas) resultado.faceTextures = texturas;
  if (grupos) resultado.faceTextureGroups = grupos;
  if (uvs) resultado.uvs = uvs;

  return {
    mesh: resultado,
    carasNuevas,
    paredes,
    verticesNuevos: [...vmap.values()],
    vmap,
    mapaAristas,
    // Cuántas caras originales se quitaron (la región si hizo hueco, 0 si no).
    retiradas: dentro ? region.length : 0,
    haciaDentro: dentro,
  };
}