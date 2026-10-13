import type { Mesh, Vertex3D } from '@/lib/geometry';

/**
 * AYUDITAS DE PROYECCIÓN DE TEXTURA (planar / cilíndrica / esférica).
 * Vivían dentro de components/viewer-3d.tsx; se sacan aquí para que el
 * ESPEJO «Crear objeto nuevo» pueda calcular en el lib — justo antes de
 * crear el gemelo — las UV que el original rendiría, y hornearlas en
 * él: al hornear su inclinación en la malla cambia la caja local y la
 * proyección viva de cada render elegiría OTRO eje, poniendo la textura
 * de otra cara (oscuro/rayado donde el original sale liso). Las tres
 * rutas de render honran mesh.uvs para la plana, así que basta hornear.
 *
 * Reglas IDÉNTICAS a las de viewer-3d.tsx (que ahora importa de aquí):
 * cualquier cambio de mapeo se hace en un solo sitio.
 */

/** Caja alineada de una lista de vértices (mínimos y máximos por eje). */
export type CajaV = {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
};

export function cajaDeVertices(vertices: Vertex3D[]): CajaV | null {
  if (vertices.length === 0) return null;
  const c: CajaV = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (const v of vertices) {
    if (v.x < c.minX) c.minX = v.x;
    if (v.x > c.maxX) c.maxX = v.x;
    if (v.y < c.minY) c.minY = v.y;
    if (v.y > c.maxY) c.maxY = v.y;
    if (v.z < c.minZ) c.minZ = v.z;
    if (v.z > c.maxZ) c.maxZ = v.z;
  }
  return c;
}

/** Eje normal de una cara alineada: 'x' (cara YZ), 'y' (cara XZ), 'z' (cara XY). */
export type EjeProy = 'x' | 'y' | 'z';

/**
 * Cara PLANA más probable de la figura: la perpendicular al eje de MENOR
 * extensión — la caja es más delgada por ahí, o sea que esa es la cara
 * grande (una placa de pie abraza su cara YZ, tumbada abraza la XZ de
 * arriba). En empate gana Z: la proyección frontal de siempre.
 */
export function ejeCaraPlana(c: CajaV): EjeProy {
  const ex = c.maxX - c.minX;
  const ey = c.maxY - c.minY;
  const ez = c.maxZ - c.minZ;
  if (ez <= ex && ez <= ey) return 'z';
  if (ex <= ey) return 'x';
  return 'y';
}

/**
 * Eje de la envolvente CILÍNDRICA: la figura gira alrededor del eje cuyos
 * DOS ejes perpendiculares se parecen más (la sección es redonda). Una
 * taza de torno: X≈Z → eje Y (siempre, como hasta ahora); un tubo tumbado
 * a lo largo de X: Y≈Z → eje X.
 */
export function ejeCilindro(c: CajaV): EjeProy {
  const ex = c.maxX - c.minX;
  const ey = c.maxY - c.minY;
  const ez = c.maxZ - c.minZ;
  const dY = Math.abs(ex - ez); // perpendiculares del eje Y: X y Z
  const dX = Math.abs(ey - ez); // perpendiculares del eje X: Y y Z
  const dZ = Math.abs(ex - ey); // perpendiculares del eje Z: X y Y
  if (dY <= dX && dY <= dZ) return 'y';
  if (dX <= dZ) return 'x';
  return 'z';
}

/**
 * UV de la proyección PLANA sobre la cara más probable. V crece hacia
 * ARRIBA de la cara (la convención de lib/geometry.ts). El eje `eje` es
 * el normal de la cara (ejeCaraPlana) y la pieza amarilla se coloca en
 * ese mismo lado, así que pieza y textura siempre coinciden.
 */
export function uvCaraPlana(
  p: { x: number; y: number; z: number },
  c: CajaV,
  eje: EjeProy
): [number, number] {
  const rx = c.maxX - c.minX || 1;
  const ry = c.maxY - c.minY || 1;
  const rz = c.maxZ - c.minZ || 1;
  if (eje === 'z') return [(p.x - c.minX) / rx, (p.y - c.minY) / ry];
  // Cara superior (visto desde arriba): arriba de la textura = -Z.
  if (eje === 'y') return [(p.x - c.minX) / rx, (c.maxZ - p.z) / rz];
  // Cara de costado (vista desde +X): arriba de la textura = +Y.
  return [(c.maxZ - p.z) / rz, (p.y - c.minY) / ry];
}

/**
 * UV de la envolvente CILÍNDRICA alrededor del eje `eje`.
 */
export function uvCilindrica(
  p: { x: number; y: number; z: number },
  c: CajaV,
  eje: EjeProy
): [number, number] {
  const rx = c.maxX - c.minX || 1;
  const ry = c.maxY - c.minY || 1;
  const rz = c.maxZ - c.minZ || 1;
  if (eje === 'y') {
    const u = ((Math.atan2(p.z, p.x) / (Math.PI * 2)) + 1) % 1;
    return [u, (p.y - c.minY) / ry];
  }
  if (eje === 'x') {
    const u = ((Math.atan2(p.y, p.z) / (Math.PI * 2)) + 1) % 1;
    return [u, (p.x - c.minX) / rx];
  }
  const u = ((Math.atan2(p.y, p.x) / (Math.PI * 2)) + 1) % 1;
  return [u, (p.z - c.minZ) / rz];
}

/**
 * Los tres lados del objeto DENTRO DE LA ESCENA: el lado de cada eje
 * local multiplicado por la escala de ese eje. Los VÉRTICES no cambian
 * al estirar el objeto con el gizmo (un cubo estirado sigue siendo un
 * cubo por dentro, con sus tres lados iguales) — el muro se crea con la
 * ESCALA. Mirar solo la caja de vértices daba empate y la pieza caía en
 * el canto; con la escala, un cubo estirado en pared delgada×alto×largo
 * elige la cara grande de pared. El GIRO no entra: la cara y la normal
 * giran con el objeto, sus anchuras relativas no cambian.
 */
export function ladosDeEscena(
  c: CajaV,
  sx: number, sy: number, sz: number
): [number, number, number] {
  return [
    (c.maxX - c.minX) * Math.abs(sx || 1),
    (c.maxY - c.minY) * Math.abs(sy || 1),
    (c.maxZ - c.minZ) * Math.abs(sz || 1),
  ];
}

/** CARA MÁS PROBABLE mirando el objeto tal y como se ve (con su escala). */
export function ejeCaraPlanaDeEscena(
  c: CajaV, sx: number, sy: number, sz: number
): EjeProy {
  const [ex, ey, ez] = ladosDeEscena(c, sx, sy, sz);
  // Misma regla y desempates que ejeCaraPlana, pero con la escala.
  if (ez <= ex && ez <= ey) return 'z';
  if (ex <= ey) return 'x';
  return 'y';
}

/** EJE CILÍNDRICO mirando el objeto tal y como se ve (con su escala). */
export function ejeCilindroDeEscena(
  c: CajaV, sx: number, sy: number, sz: number
): EjeProy {
  const [ex, ey, ez] = ladosDeEscena(c, sx, sy, sz);
  const dY = Math.abs(ex - ez); // perpendiculares del eje Y: X y Z
  const dX = Math.abs(ey - ez); // perpendiculares del eje X: Y y Z
  const dZ = Math.abs(ex - ey); // perpendiculares del eje Z: X y Y
  // Misma regla y desempates que ejeCilindro, pero con la escala.
  if (dY <= dX && dY <= dZ) return 'y';
  if (dX <= dZ) return 'x';
  return 'z';
}

/**
 * UV PLANAS horneadas en el marco de proyección DE SIEMPRE del objeto:
 * su caja local y su escala — la MISMA fórmula viva del visor (cara plana
 * más probable mirando el objeto tal y como se ve). Para el gemelo del
 * Espejo: los índices no cambian (el espejo conserva el orden de los
 * vértices) y las tres rutas de render honran mesh.uvs para la plana,
 * así que con esta lista el gemelo rinde la textura como el original.
 */
export function uvPlanasDeObjeto(
  mesh: Mesh,
  transform?: { sx?: number; sy?: number; sz?: number }
): [number, number][] {
  const caja = cajaDeVertices(mesh.vertices);
  if (!caja) return [];
  const eje = ejeCaraPlanaDeEscena(
    caja,
    transform?.sx ?? 1, transform?.sy ?? 1, transform?.sz ?? 1
  );
  return mesh.vertices.map((v) => uvCaraPlana(v, caja, eje));
}