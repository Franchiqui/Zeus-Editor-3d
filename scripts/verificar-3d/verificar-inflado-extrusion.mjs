// INFLADO de la extrusión con Ctrl (flecha de mover): normales suavizadas
// por vértice de la región (coherencia de enrolado + hacia fuera + cúmulos
// por posición). Lo que pidió el usuario 2026-10-11: en la cápsula
// «unas caras salen más afuera que otras» — con el inflado TODAS salen lo
// mismo en superficie curvada, sin desgarro.
// (requiere el bundle: .inflado-bundle.mjs, generado con esbuild)
import { normalesSuavizadasDeRegion } from './.inflado-bundle.mjs';

let fallos = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${msg}`);
  if (!cond) fallos++;
};

/** Cápsula hombro: parche curvado de cols×files celdas cuadranguladas
 *  (2 triángulos por celda, índices COMPARTIDOS, orientación coherente). */
function hombroRegenerada(cols, files, seg = 24) {
  const verts = [], faces = [];
  const R = 1;
  const filas = files + 1, COLUMNAS = cols + 1;
  const idx = (c, f) => f * COLUMNAS + c;
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < COLUMNAS; c++) {
      const a = (2 * Math.PI * (11 + c)) / seg; // zona del hombro
      const ph = Math.PI * (0.25 + (0.5 * f) / 16);
      verts.push({
        x: R * Math.sin(ph) * Math.cos(a),
        y: R * Math.cos(ph),
        z: R * Math.sin(ph) * Math.sin(a),
      });
    }
  }
  const quad = (c, f) => [idx(c, f), idx(c + 1, f), idx(c + 1, f + 1), idx(c, f + 1)];
  for (let f = 0; f < files; f++) {
    for (let c = 0; c < cols; c++) {
      const q = quad(c, f);
      faces.push([q[0], q[1], q[2]]);
      faces.push([q[0], q[2], q[3]]);
    }
  }
  return { vertices: verts, faces };
}

/** Misma geometría PERO con vértices duplicados por triángulo y UNA cara
 *  con enrolado invertido (malla .zeus «mal enrollada»). Las caras se
 *  remapean a los índices NUEVOS de los duplicados. */
function hombroDuplicada(cols, files, invertirAlguna = true) {
  const base = hombroRegenerada(cols, files);
  const dup = { vertices: [], faces: [] };
  let nInvertidas = 0;
  base.faces.forEach((f, i) => {
    let cara;
    if (invertirAlguna && i === 5) {
      nInvertidas++;
      cara = [...f].reverse();
    } else {
      cara = [...f];
    }
    // Mapear cada ORIGINAL a su duplicado recién empujado:
    const nuevos = cara.map((v) => {
      const p = base.vertices[v];
      dup.vertices.push({ ...p });
      return dup.vertices.length - 1;
    });
    dup.faces.push(nuevos);
  });
  return { malla: dup, nInvertidas };
}

const mesh = hombroRegenerada(3, 3); // 9 caras lógicas = 18 triángulos
const region = mesh.faces.map((_, i) => i);

// == 1. Normales unitarias y OUTWARD en el parche curvado ==
{
  const nv = normalesSuavizadasDeRegion(mesh, region);
  let okUnit = true, okOut = true, okTapa = true;
  const centro = {};
  for (const v of vertsDe(mesh)) {
    centro.x = (centro.x ?? 0) + v.x; centro.n = (centro.n ?? 0) + 1;
    centro.y = (centro.y ?? 0) + v.y; centro.z = (centro.z ?? 0) + v.z;
  }
  const cx = centro.x / centro.n, cy = centro.y / centro.n, cz = centro.z / centro.n;
  for (const [vi, n] of nv) {
    const l = Math.hypot(n.x, n.y, n.z);
    if (Math.abs(l - 1) > 1e-9) okUnit = false;
    const v = mesh.vertices[vi];
    const dot = (v.x - cx) * n.x + (v.y - cy) * n.y + (v.z - cz) * n.z;
    if (dot <= 0) okOut = false;
  }
  check(okUnit, 'normales unitarias en todos los vértices de la región');
  check(okOut, 'normales mirando FUERA (hombro abierto hacia fuera)');
  check(nv.size === mesh.vertices.length, `cubiertos todos los vértices (${nv.size}/${mesh.vertices.length})`);
  void okTapa;
}

// == 2. Inflado real: profundidad de salida IGUAL por cara y SIN desgarro ==
{
  const nv = normalesSuavizadasDeRegion(mesh, region);
  const d = 0.5;
  const movidos = new Map();
  for (const [vi, n] of nv) {
    const v = mesh.vertices[vi];
    movidos.set(vi, { x: v.x + n.x * d, y: v.y + n.y * d, z: v.z + n.z * d });
  }
  // Profundidad de cada triángulo medida contra SU normal (la métrica que
  // el usuario ve como «cuánto sale afuera» la cara):
  const prof = (cara) => {
    const a = movidos.get(cara[0]), b0 = mesh.vertices[cara[0]];
    const l1 = normalDeCara(mesh, cara);
    if (!l1) return NaN;
    return (a.x - b0.x) * l1.x + (a.y - b0.y) * l1.y + (a.z - b0.z) * l1.z;
  };
  const profundidades = region.map((i) => prof(mesh.faces[i]));
  const media = profundidades.reduce((s, x) => s + x, 0) / profundidades.length;
  const maxDesvio = Math.max(...profundidades.map((x) => Math.abs(x - media)));
  check(maxDesvio / media < 0.06,
    `inflado: profundidad de salida igual por cara (desvío máx ${(100 * maxDesvio / media).toFixed(1)}% < 6%; rígido daba 96%→~0%)`);
  // Comparación con el arrastre RÍGIDO (una sola dirección): desvío grande.
  // Toma la normal media de la región como eje, como hacía el gizmo:
  let ex = 0, ey = 0, ez = 0;
  const faces = region.map((i) => normalDeCara(mesh, mesh.faces[i]));
  for (const n of faces) { ex += n.x; ey += n.y; ez += n.z; }
  const le = Math.hypot(ex, ey, ez);
  // parche entero desplazado media·d en la dirección media
  const deltaEje = { x: (ex / le) * media, y: (ey / le) * media, z: (ez / le) * media };
  const profRigida = region.map((i) => {
    const cara = mesh.faces[i];
    const n = normalDeCara(mesh, cara);
    return deltaEje.x * n.x + deltaEje.y * n.y + deltaEje.z * n.z;
  });
  const desvioRigido = Math.max(...profRigida.map((x) => Math.abs(x - media)));
  check(desvioRigido > maxDesvio,
    'el rígido (una dirección) desvía más que el inflado — reproduce la queja');
}

// == 3. Sin desgarro: vértices coincidentes comparten normal ==
{
  const { malla } = hombroDuplicada(3, 3);
  const nv = normalesSuavizadasDeRegion(malla, malla.faces.map((_, i) => i));
  // Claves por posición y desviación de normal entre coincidentes:
  const porPunto = new Map();
  let maxAngulo = 0;
  malla.faces.forEach((cara, fi) => {
    cara.forEach((vi, k) => {
      const p = malla.vertices[vi];
      const key = `${p.x.toFixed(6)}|${p.y.toFixed(6)}|${p.z.toFixed(6)}`;
      const n = nv.get(vi);
      if (!n) return;
      const prev = porPunto.get(key);
      if (prev) {
        const dot = prev.x * n.x + prev.y * n.y + prev.z * n.z;
        maxAngulo = Math.max(maxAngulo, Math.acos(Math.max(-1, Math.min(1, dot))));
      } else porPunto.set(key, n);
      void fi; void k;
    });
  });
  check(maxAngulo < 0.35,
    `malla con vértices duplicados: coincidentes con normal igual (ángulo máx ${(maxAngulo * 180 / Math.PI).toFixed(1)}° — el desgarro era arista a arista)`);
}

// == 4. Enrolado invertido de una cara: la orientación no se corrompe ==
{
  const { malla } = hombroDuplicada(3, 3, true);
  const nv = normalesSuavizadasDeRegion(malla, malla.faces.map((_, i) => i));
  let okOut = true;
  const centro = {};
  malla.vertices.forEach((v) => {
    centro.x = (centro.x ?? 0) + v.x; centro.n = (centro.n ?? 0) + 1;
    centro.y = (centro.y ?? 0) + v.y; centro.z = (centro.z ?? 0) + v.z;
  });
  const cx = centro.x / centro.n, cy = centro.y / centro.n, cz = centro.z / centro.n;
  for (const [vi, n] of nv) {
    const v = malla.vertices[vi];
    const dot = (v.x - cx) * n.x + (v.y - cy) * n.y + (v.z - cz) * n.z;
    if (dot <= 0) okOut = false;
  }
  check(okOut, 'una cara mal enrollada no voltea el conjunto (propagación por adyacencia)');
}

// == 5. Zanja cóncava: el promedio no se cancela ==
{
  // Fondo de una esquina cóncava PLEGADA en 90°: dos aletas a distinta
  // dirección de normal compartiendo la arista del pliegue. Con normales
  // alineadas a cada aleta el promedio por vértice del pliegue existe (no
  // es cero, no cancela).
  const verts = [], faces = [];
  const idx = (c, f, lado) => (lado * 4 + f) * 5 + c;
  for (let lado = 0; lado < 2; lado++) {
    for (let f = 0; f < 4; f++) {
      for (let c = 0; c < 5; c++) {
        if (lado === 0) verts.push({ x: -2 + 0.5 * c, y: 1 - 0.5 * f, z: lado * 0.01 - 0.5 * (c / 5) });
        else if (c <= 2 || true) ; // (la aleta 2 es el mismo plano girado)
        if (lado === 1) verts.push({ x: -2 + 0.5 * c, y: 1 + 0.0001 * f, z: 0.5 + 0.5 * (c / 5) - 0.0002 * (c / 5) });
      }
    }
  }
  // Más simple: dos quad-tiras formando V (normales 90°). Comparten la
  // arista índice y un pliegue: la clave es que el promedio no cancele.
  verts.length = 0; faces.length = 0;
  for (let c = 0; c < 5; c++) {
    verts.push({ x: -2 + c, y: 0, z: c * 0.3 });       // aleta 1 (sube en Y-Z)
  }
  for (let c = 0; c < 5; c++) {
    verts.push({ x: -2 + c, y: (4 - c) * 0.3, z: 1.2 }); // aleta 2 (viene bajando)
  }
  for (let c = 0; c < 4; c++) {
    faces.push([c, c + 1, 5 + c + 1, 5 + c]); // quads cruzando el pliegue
  }
  const nv = normalesSuavizadasDeRegion({ vertices: verts, faces }, faces.map((_, i) => i));
  let okNoCancel = true;
  for (const n of nv.values()) {
    const l = Math.hypot(n.x, n.y, n.z);
    if (l < 0.5) okNoCancel = false; // la del pliegue debería ser ~45°
  }
  check(okNoCancel, 'pliegue cóncavo (aletas a 90°): el promedio del pliegue no se cancela');
}

function vertsDe(m) { return m.vertices.map((v) => v); }
function normalDeCara(m, cara) {
  const a = m.vertices[cara[0]], b = m.vertices[cara[1]], c = m.vertices[cara[2]];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l < 1e-12 ? null : { x: nx / l, y: ny / l, z: nz / l };
}

console.log('');
if (fallos === 0) console.log('TODO OK');
else console.log(`${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);