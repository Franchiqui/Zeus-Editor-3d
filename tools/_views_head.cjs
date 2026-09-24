"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildViewsMesh = buildViewsMesh;
exports.polylineToPolygon = polylineToPolygon;
exports.buildExtrudeMesh = buildExtrudeMesh;
exports.buildExtrudeMeshes = buildExtrudeMeshes;
const geometry_1 = require('./_geo.cjs');
const three_1 = require("three");
/**
 * Construye el objeto 3D como una MALLA SUAVE Y EDITABLE a partir de las
 * tres plantillas, sin pasar por vóxeles: el sólido es el mismo (la
 * intersección de las tres extrusiones), pero sus caras siguen las curvas
 * dibujadas en las plantillas en vez de escalones de vóxeles.
 *
 * Método: cortes horizontales. A cada altura y, la sección del sólido es
 * la vista Superior recortada al intervalo X que permite el Frente a esa
 * altura y al intervalo Z que permite el Costado. Los contornos de cortes
 * consecutivos se empalman con cuadriláteros; las tapas se triangulan.
 * Así:
 *  - las curvas del Frente salen en los muros que miran a ±X,
 *  - las del Costado en los muros que miran a ±Z,
 *  - y las de la Superior en las paredes verticales del contorno.
 */
function buildViewsMesh(views, opts = {}) {
    const L = Math.max(8, Math.floor(opts.levels ?? 40));
    const N = Math.max(12, Math.floor(opts.samples ?? 96));
    const curveSteps = Math.max(8, opts.curveSteps ?? 24);
    if (views.front.length < 3 || views.side.length < 3 || views.top.length < 3) {
        return { vertices: [], faces: [] };
    }
    // Plantillas con las curvas aplanadas a polilíneas
    const front = (0, geometry_1.flattenPolygon)((0, geometry_1.normalizePolygon)(views.front), curveSteps);
    const side = (0, geometry_1.flattenPolygon)((0, geometry_1.normalizePolygon)(views.side), curveSteps);
    let top = (0, geometry_1.flattenPolygon)((0, geometry_1.normalizePolygon)(views.top), curveSteps);
    // Secciones opcionales: si vienen, mandan sobre `top` a cada altura
    const sections = opts.sections;
    const useSections = Array.isArray(sections) && sections.length >= 2;
    // Las plantillas pueden traer esquinas curvadas (asas hIn/hOut): se
    // aplanan a polilíneas para que la interpolación entre alturas siga las
    // curvas dibujadas en vez de las cuerdas rectas entre vértices. Sin
    // asas no se toca nada (mismo número de puntos que antes).
    const sectionsSorted = useSections
        ? [...sections]
            .sort((a, b) => a.y - b.y)
            .map((s) => s.polygon.some((p) => p.hIn || p.hOut)
            ? { ...s, polygon: (0, geometry_1.flattenPolygon)(s.polygon, curveSteps) }
            : s)
        : [];
    const sectionsYLo = useSections ? sectionsSorted[0].y : 0;
    const sectionsYHi = useSections
        ? sectionsSorted[sectionsSorted.length - 1].y
        : 1;
    const sectionsTargetN = useSections
        ? Math.max(...sectionsSorted.map((s) => s.polygon.length))
        : 0;
    // Orientación del contorno superior: shoelace NEGATIVO (antihorario
    // visual con el eje Y del lienzo hacia abajo). Con esta orientación una
    // tapa en ese orden mira a +Y y los muros [p_k, p_k+1, q_k+1, q_k]
    // (p corte inferior, q superior) apuntan hacia fuera.
    if (shoelace(top) > 0)
        top.reverse();
    const vertices = [];
    const faces = [];
    const vmap = new Map();
    const getVertex = (x, y, z) => {
        const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
        const found = vmap.get(key);
        if (found !== undefined)
            return found;
        const id = vertices.length;
        vertices.push({ x, y, z });
        vmap.set(key, id);
        return id;
    };
    // Tapa de un contorno: dir=+1 mira a +Y (arriba), dir=-1 a -Y (abajo)
    const capFaces = (ring, dir) => {
        const { pts, ids } = ring;
        const n = pts.length;
        if (n < 3)
            return;
        // El recorte de orejas trabaja con anillos CCW (shoelace positivo):
        // se le pasa el contorno invertido. Los triángulos que salen tienen
        // ese mismo giro físico, así que la tapa superior (que necesita el
        // giro contrario, el del contorno original) se voltea.
        const rev = [...pts].reverse();
        const tris = earClip(rev);
        for (let t = 0; t + 2 < tris.length; t += 3) {
            const a = (n - 1 - tris[t]) % n;
            const b = (n - 1 - tris[t + 1]) % n;
            const c = (n - 1 - tris[t + 2]) % n;
            if (dir > 0)
                faces.push([ids[a], ids[c], ids[b]]);
            else
                faces.push([ids[a], ids[b], ids[c]]);
        }
    };
    // Contornos de la sección a la altura yc (coordenadas de lienzo, y abajo)
    const clampY = (y, lo, hi) => Math.max(lo, Math.min(hi, y));
    // Contornos de la sección a la altura yc (coordenadas de lienzo, y abajo)
    const ringsAt = (yc) => {
        const modelY = 1 - 2 * yc;
        const xr = (0, geometry_1.scanlineIntervalsAtY)(front, clampY(yc, fLo, fHi));
        const zr = (0, geometry_1.scanlineIntervalsAtY)(side, clampY(yc, sLo, sHi));
        if (xr.length === 0 || zr.length === 0)
            return [];
        const out = [];
        if (xr.length === 1 && zr.length === 1) {
            // Corte a esta altura: la Superior manda en la FORMA del contorno
            // y el Frente y el Costado en su TAMAÑO. En vez de recortar la
            // Superior a la caja que permiten las otras dos (con tres círculos
            // eso da el sólido de Steinmetz, con aristas en vez de esfera), se
            // escala al ancho exacto de esa caja. Así tres círculos dan una
            // esfera perfecta, y una Superior rectangular sigue dando
            // exactamente la caja de siempre (un cuadro que ocupa todo el
            // lienzo, escalado a la caja, es la caja).
            const [x0, x1] = xr[0];
            const [z0, z1] = zr[0];
            const kx = x1 - x0;
            const kz = z1 - z0;
            if (kx >= 1e-7 && kz >= 1e-7) {
                // Si hay secciones, la forma en planta a esta altura es la
                // sección interpolada; si no, la vista Superior escalada.
                let baseContour;
                if (useSections) {
                    const yModel = 1 - yc;
                    const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
                    baseContour = (0, geometry_1.interpolateSection)(sectionsSorted, yy, sectionsTargetN);
                }
                else {
                    baseContour = top;
                }
                let p = baseContour.map((q) => ({
                    x: x0 + q.x * kx,
                    y: z0 + q.y * kz,
                }));
                p = dedupe(p);
                if (p.length >= 3 && Math.abs(shoelace(p)) >= 1e-9) {
                    if (shoelace(p) > 0)
                        p.reverse();
                    const ring = resampleRing(p, N);
                    if (ring.length >= 3) {
                        let cx = 0;
                        let cy = 0;
                        const ids = ring.map((q) => {
                            cx += q.x;
                            cy += q.y;
                            return getVertex(2 * q.x - 1, modelY, 2 * q.y - 1);
                        });
                        out.push({
                            pts: ring,
                            ids,
                            cx: cx / ring.length,
                            cy: cy / ring.length,
                        });
                    }
                }
            }
            return out;
        }
        // Perfil no convexo a esta altura (varios intervalos): intersección
        // clásica con la caja, que maneja cada pieza por separado
        let baseContour;
        if (useSections) {
            const yModel = 1 - yc;
            const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
            baseContour = (0, geometry_1.interpolateSection)(sectionsSorted, yy, sectionsTargetN);
        }
        else {
            baseContour = top;
        }
        for (const [x0, x1] of xr) {
            for (const [z0, z1] of zr) {
                if (x1 - x0 < 1e-7 || z1 - z0 < 1e-7)
                    continue;
                let p = clipToRect(baseContour, x0, x1, z0, z1);
                p = dedupe(p);
                if (p.length < 3 || Math.abs(shoelace(p)) < 1e-9)
                    continue;
                if (shoelace(p) > 0)
                    p.reverse();
                const ring = resampleRing(p, N);
                if (ring.length < 3)
                    continue;
                let cx = 0;
                let cy = 0;
                const ids = ring.map((q) => {
                    cx += q.x;
                    cy += q.y;
                    return getVertex(2 * q.x - 1, modelY, 2 * q.y - 1);
                });
                out.push({
                    pts: ring,
                    ids,
                    cx: cx / ring.length,
                    cy: cy / ring.length,
                });
            }
        }
        return out;
    };
    // Rango real en Y de las plantillas: una curva puede sobresalir del bbox
    // de los vértices (curvar las dos esquinas de arriba levanta el borde
    // superior por encima de la línea de vértices), así que se mide sobre
    // las polilíneas aplanadas. Cada vista manda en su dirección: donde la
    // curva de una vista sobresale de la altura de la otra, la otra NO
    // recorta (usa su último intervalo definido). Así el borde curvado del
    // Frente levanta la cara superior aunque el Costado sea plano (y al
    // revés). Con polígonos sin curvas los rangos coinciden y no cambia
    // nada.
    const [fLo, fHi] = (0, geometry_1.polygonYRange)(front);
    const [sLo, sHi] = (0, geometry_1.polygonYRange)(side);
    const yLo = Math.min(fLo, sLo);
    const yHi = Math.max(fHi, sHi);
    const span = Math.max(1e-6, yHi - yLo);
    // Cortes de abajo (yc=yHi) a arriba (yc=yLo). Además de los centros
    // uniformes se prueban los extremos exactos: si la plantilla acaba en
    // borde plano, la tapa cae en la altura exacta (el objeto mide lo que
    // marca la plantilla); si acaba en pico, el contorno degenera y se
    // descarta solo. La densidad de cortes se mantiene aunque las curvas
    // estiren el objeto por encima o por debajo del bbox de vértices.
    const EPS_Y = 1e-6;
    const L2 = Math.max(8, Math.ceil(L * span));
    const slices = [];
    const bottom = ringsAt(yHi - EPS_Y);
    if (bottom.length > 0)
        slices.push(bottom);
    for (let i = 0; i < L2; i++) {
        slices.push(ringsAt(yHi - (i + 0.5) * (span / L2)));
    }
    const topSlice = ringsAt(yLo + EPS_Y);
    if (topSlice.length > 0)
        slices.push(topSlice);
    let prev = [];
    for (const cur of slices) {
        // Emparejar cada contorno actual con el más cercano del corte anterior
        const usedPrev = new Set();
        for (const c of cur) {
            let best = -1;
            let bestD = Infinity;
            prev.forEach((p, idx) => {
                if (usedPrev.has(idx))
                    return;
                const d = (p.cx - c.cx) ** 2 + (p.cy - c.cy) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = idx;
                }
            });
            if (best >= 0 && bestD < 0.16) {
                usedPrev.add(best);
                const p = prev[best];
                // Muro entre cortes consecutivos, normal hacia fuera
                for (let k = 0; k < N; k++) {
                    const k2 = (k + 1) % N;
                    faces.push([p.ids[k], p.ids[k2], c.ids[k2], c.ids[k]]);
                }
            }
            else {
                // Componente que nace en este corte: tapa inferior
                capFaces(c, -1);
            }
        }
        // Componentes del corte anterior que terminan: tapa superior
        prev.forEach((p, idx) => {
            if (!usedPrev.has(idx))
                capFaces(p, +1);
        });
        prev = cur;
    }
    // Tapas superiores del último corte
    for (const p of prev)
        capFaces(p, +1);
    return { vertices, faces };
}
/**
 * Convierte una polilínea en un polígono si está cerrada (el primer
 * y último punto coinciden). Devuelve null si no está cerrada o tiene
 * menos de 3 puntos.
 */
function polylineToPolygon(polyline) {
    if (polyline.points.length < 3)
        return null;
    const first = polyline.points[0];
    const last = polyline.points[polyline.points.length - 1];
    const dist = Math.hypot(first.x - last.x, first.y - last.y);
    if (dist < 0.001) {
        return polyline.points.slice(0, -1);
    }
    return null;
}
/**
 * Extrae la lógica central de buildExtrudeMesh: extruye un solo
 * polígono a lo largo del eje Z, con agujeros opcionales.
 *
 * Los agujeros deben ser polígonos simples cuyo interior está contenido
 * en el polígono exterior. ShapeUtils.triangulateShape se encarga de
 * generar triángulos para el exterior y los agujeros, y el winding
 * correcto (exteriores CCW, agujeros CW en el lienzo) se asegura aquí.
 */
function extrudeSinglePolygon(polygon, depth, holes = []) {
    const curveSteps = Math.max(8, 24);
    if (polygon.length < 3)
        return { vertices: [], faces: [] };
    const front = (0, geometry_1.flattenPolygon)((0, geometry_1.normalizePolygon)(polygon), curveSteps);
    if (front.length < 3)
        return { vertices: [], faces: [] };
    // Quitar punto final duplicado (ShapeUtils.triangulateShape lo hace
    // internamente y rompería el alineamiento de índices con los vértices 3D)
    const frontClosed = dedupe(front);
    if (frontClosed.length < 3)
        return { vertices: [], faces: [] };
    // Positive shoelace = CW en el lienzo = CCW en 3D visto desde +Z.
    // Se garantiza para que la tapa delantera mire a +Z.
    if (shoelace(frontClosed) < 0)
        frontClosed.reverse();
    // Aplanar agujeros y garantizar winding CW en el lienzo
    const flatHoles = [];
    for (const hole of holes) {
        if (hole.length < 3)
            continue;
        const flat = (0, geometry_1.flattenPolygon)((0, geometry_1.normalizePolygon)(hole), curveSteps);
        if (flat.length < 3)
            continue;
        const flatClosed = dedupe(flat);
        if (flatClosed.length < 3)
            continue;
        // ShapeUtils/Earcut requires holes to have OPPOSITE winding from the
        // exterior. Exterior is CCW (positive shoelace); holes must be CW
        // (negative shoelace). If a hole comes in CCW, reverse it to CW.
        if (shoelace(flatClosed) > 0)
            flatClosed.reverse();
        flatHoles.push(flatClosed);
    }
    const vertices = [];
    const faces = [];
    // Helper: crear vértices 3D a partir de puntos 2D a una altura z dada
    const makeVerts = (pts, z) => {
        return pts.map((q) => {
            const x = 2 * q.x - 1;
            const y = 1 - 2 * q.y;
            return vertices.push({ x, y, z }) - 1;
        });
    };
    // Vértices frontales (z = 0)
    const frontCap = makeVerts(frontClosed, 0);
    const backCap = makeVerts(frontClosed, -depth);
    // Vértices de los agujeros (frontales y traseros)
    const holeFronts = [];
    const holeBacks = [];
    for (const hole of flatHoles) {
        holeFronts.push(makeVerts(hole, 0));
        holeBacks.push(makeVerts(hole, -depth));
    }
    // --- Triangulación de las tapas usando ShapeUtils (soporta agujeros) ---
    const contour2d = frontClosed.map((q) => new three_1.Vector2(q.x, q.y));
    const holes2d = flatHoles.map((h) => h.map((q) => new three_1.Vector2(q.x, q.y)));
    let tris = [];
    try {
        const raw = three_1.ShapeUtils.triangulateShape(contour2d, holes2d);
        tris = (Array.isArray(raw) ? raw : []);
        if (tris.length === 0) {
            throw new Error('ShapeUtils returned no triangles');
        }
    }
    catch (e) {
        // Fallback: triangulación con agujeros (ear-clip + bridge)
        const ear = earClipWithHoles(frontClosed, flatHoles);
        for (let i = 0; i + 2 < ear.length; i += 3) {
            tris.push([ear[i], ear[i + 1], ear[i + 2]]);
        }
    }
    // ShapeUtils indices over [exterior, hole0, hole1, ...]
    // flat3dFront/Back have identical structure so offsets are shared
    const flat3dFront = [frontCap, ...holeFronts];
    const flat3dBack = [backCap, ...holeBacks];
    const offsets = [];
    let acc = 0;
    for (const f of flat3dFront) {
        offsets.push(acc);
        acc += f.length;
    }
    const idAt = (flat, i) => {
        for (let g = flat.length - 1; g >= 0; g--) {
            if (i >= offsets[g])
                return flat[g][i - offsets[g]];
        }
        return flat[0][0];
    };
    // Tapa delantera: winding CCW visto desde +Z
    for (const t of tris) {
        if (t.length < 3)
            continue;
        faces.push([idAt(flat3dFront, t[0]), idAt(flat3dFront, t[1]), idAt(flat3dFront, t[2])]);
    }
    // Tapa trasera: winding CCW visto desde −Z (invertido respecto al frente)
    for (const t of tris) {
        if (t.length < 3)
            continue;
        faces.push([idAt(flat3dBack, t[2]), idAt(flat3dBack, t[1]), idAt(flat3dBack, t[0])]);
    }
    // Caras laterales del contorno exterior:
    // [frente_k, tras_k, tras_{k+1}, frente_{k+1}] — winding exterior
    for (let k = 0; k < frontCap.length; k++) {
        const k2 = (k + 1) % frontCap.length;
        faces.push([frontCap[k], backCap[k], backCap[k2], frontCap[k2]]);
    }
    // Caras laterales de los agujeros (el interior es aire, winding hacia dentro):
    // [hole_frente_k, hole_frente_{k+1}, hole_tras_{k+1}, hole_tras_k]
    for (let h = 0; h < holeFronts.length; h++) {
        const fIds = holeFronts[h];
        const bIds = holeBacks[h];
        const nh = fIds.length;
        for (let k = 0; k < nh; k++) {
            const k2 = (k + 1) % nh;
            faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);
        }
    }
    return { vertices, faces };
}
/**
 * Construye un objeto 3D extruyendo el contorno de la vista Frente a lo
 * largo del eje Z. Se ignoran las vistas Costado y Superior: la figura
 * resulta es el contorno Frente extruido `depth` unidades hacia -Z, con
 * tapa delantera (mira +Z) y trasera (mira -Z) y las caras laterales.
 *
 * El contorno se aplanan las curvas (asas) a polilíneas y se mapea a
 * coordenadas 3D como en buildViewsMesh: x = 2·x−1, y = 1−2·y, con z=0
 * en la tapa delantera y z = −depth en la trasera.
 */
function buildExtrudeMesh(views, depth) {
    return extrudeSinglePolygon(views.front, depth);
}
/**
 * Como buildExtrudeMesh, pero extruye TODOS los polígonos (el contorno
 * principal y las polilíneas cerradas) y devuelve una única malla con
 * todas las extrusiones fusionadas. Cada polígono se convierte en un
 * prisma independiente; los vértices de cada prisma se añaden a la malla
 * global renumerando los índices de las caras.
 *
 * `subtractHoles` son polígonos cerrados que se convierten en agujeros
 * del prisma del contorno principal (índice 0 de `polygons`).
 */
function buildExtrudeMeshes(polygons, depth, subtractHoles = []) {
    let allVertices = [];
    let allFaces = [];
    for (let pi = 0; pi < polygons.length; pi++) {
        const poly = polygons[pi];
        if (poly.length < 3)
            continue;
        // El primer polígono es el contorno principal: le aplican los agujeros
        // de resta solo a él.
        const holes = pi === 0 ? subtractHoles : [];
        const mesh = extrudeSinglePolygon(poly, depth, holes);
        if (mesh.vertices.length === 0)
            continue;
        const offset = allVertices.length;
        allVertices = allVertices.concat(mesh.vertices);
        allFaces = allFaces.concat(mesh.faces.map((face) => face.map((idx) => idx + offset)));
    }
    return { vertices: allVertices, faces: allFaces };
}
/** Área con signo (shoelace) de un polígono cerrado */
function shoelace(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
}
/** Quita puntos consecutivos repetidos (típico del recorte) */
function dedupe(poly) {
    const out = [];
    for (const p of poly) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9)
            out.push(p);
    }
    if (out.length > 1) {
        const first = out[0];
        const last = out[out.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9)
            out.pop();
    }
    return out;
}
/** Recorte de un polígono contra un rectángulo (Sutherland–Hodgman) */
function clipToRect(poly, x0, x1, z0, z1) {
    let pts = poly;
    const clipPlane = (inp, keep, inter) => {
        if (inp.length === 0)
            return [];
        const out = [];
        for (let i = 0; i < inp.length; i++) {
            const a = inp[i];
            const b = inp[(i + 1) % inp.length];
            const ka = keep(a);
            const kb = keep(b);
            if (ka)
                out.push(a);
            if (ka !== kb)
                out.push(inter(a, b));
        }
        return out;
    };
    const atX = (a, b, x) => {
        const t = (x - a.x) / (b.x - a.x);
        return { x, y: a.y + (b.y - a.y) * t };
    };
    const atY = (a, b, y) => {
        const t = (y - a.y) / (b.y - a.y);
        return { x: a.x + (b.x - a.x) * t, y };
    };
    const e = 1e-12;
    pts = clipPlane(pts, (p) => p.x >= x0 - e, (a, b) => atX(a, b, x0));
    pts = clipPlane(pts, (p) => p.x <= x1 + e, (a, b) => atX(a, b, x1));
    pts = clipPlane(pts, (p) => p.y >= z0 - e, (a, b) => atY(a, b, z0));
    pts = clipPlane(pts, (p) => p.y <= z1 + e, (a, b) => atY(a, b, z1));
    return pts;
}
/**
 * Remuestrea el contorno cerrado a n puntos uniformes por longitud de
 * arco, empezando en el vértice MÁS ABAJO (y a igualdad, el más a la
 * derecha): ancla estable para que los muros entre cortes consecutivos
 * no se retuerzan. Con el ancla abajo, una figura que se va girando
 * (cuadrado → rombo) mantiene cada esquina en su sitio de un corte al
 * siguiente: las líneas del objeto salen rectas, no en diagonal.
 */
function resampleRing(poly, n) {
    const m = poly.length;
    let s = 0;
    for (let i = 1; i < m; i++) {
        if (poly[i].y > poly[s].y + 1e-12 ||
            (Math.abs(poly[i].y - poly[s].y) <= 1e-12 &&
                poly[i].x > poly[s].x + 1e-12)) {
            s = i;
        }
    }
    const segLen = [];
    let total = 0;
    for (let k = 0; k < m; k++) {
        const a = poly[(s + k) % m];
        const b = poly[(s + k + 1) % m];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        segLen.push(l);
        total += l;
    }
    if (total <= 0)
        return [];
    const out = [];
    let seg = 0;
    let acc = 0;
    const step = total / n;
    for (let k = 0; k < n; k++) {
        const target = k * step;
        while (seg < m - 1 && acc + segLen[seg] < target) {
            acc += segLen[seg];
            seg++;
        }
        const a = poly[(s + seg) % m];
        const b = poly[(s + seg + 1) % m];
        const t = segLen[seg] > 1e-12 ? (target - acc) / segLen[seg] : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return out;
}
function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
function pointInTriangle(p, a, b, c) {
    const d1 = cross(a, b, p);
    const d2 = cross(b, c, p);
    const d3 = cross(c, a, p);
    const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(hasNeg && hasPos);
}
/**
 * Triangula un polígono exterior con agujeros usando ear-clip + puentes.
 * Convierte los agujeros en "cortes" (puentes) hasta el exterior, luego
 * ejecuta earClip sobre el polígono resultante.
 * Los índices retornados son relativos al array plano:
 * [exterior..., hole0..., hole1..., ...] con los mismos offsets que idAt espera.
 */
function earClipWithHoles(exterior, holes) {
    const n = exterior.length;
    if (n < 3)
        return [];
    const flat = [...exterior];
    const holeStarts = [];
    for (const h of holes) {
        if (h.length < 3)
            continue;
        holeStarts.push(flat.length);
        for (const v of h)
            flat.push(v);
    }
    if (holeStarts.length === 0) {
        return earClip(flat);
    }
    // Build combined index list with bridges inserted
    const combined = [];
    for (let i = 0; i < n; i++)
        combined.push(i);
    for (let hi = 0; hi < holeStarts.length; hi++) {
        const hs = holeStarts[hi];
        const he = hi + 1 < holeStarts.length ? holeStarts[hi + 1] : flat.length;
        // Leftmost hole vertex
        let bestHoleIdx = hs;
        for (let j = hs + 1; j < he; j++) {
            if (flat[j].x < flat[bestHoleIdx].x)
                bestHoleIdx = j;
        }
        // Nearest exterior vertex by distance to the hole vertex
        let bestExtIdx = 0;
        let bestDist = Infinity;
        for (let j = 0; j < n; j++) {
            const d = dist2(flat[j], flat[bestHoleIdx]);
            if (d < bestDist) {
                bestDist = d;
                bestExtIdx = j;
            }
        }
        const extPos = combined.indexOf(bestExtIdx);
        if (extPos === -1)
            continue;
        const toInsert = [bestExtIdx];
        for (let j = bestHoleIdx; j < he; j++)
            toInsert.push(j);
        for (let j = hs; j < bestHoleIdx; j++)
            toInsert.push(j);
        toInsert.push(bestExtIdx);
        combined.splice(extPos + 1, 0, ...toInsert);
    }
    const points = combined.map((i) => flat[i]);
    const ear = earClip(points);
    return ear.map((i) => combined[i]);
}
/**
 * Triangulación por recorte de orejas de un polígono simple CCW (shoelace
 * positivo). Devuelve triángulos como índices [i0,i1,i2, i0,i1,i2, ...]
 * sobre el propio array. Si se atasca (polígono degenerado) cae a un
 * abanico desde el primer punto.
 */
function earClip(poly) {
    const n = poly.length;
    if (n < 3)
        return [];
    const idx = Array.from({ length: n }, (_, i) => i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 2 * n) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const ia = idx[(i + idx.length - 1) % idx.length];
            const ib = idx[i];
            const ic = idx[(i + 1) % idx.length];
            const a = poly[ia];
            const b = poly[ib];
            const c = poly[ic];
            if (cross(a, b, c) <= 1e-12)
                continue; // cóncavo o colineal
            let inside = false;
            for (const j of idx) {
                if (j === ia || j === ib || j === ic)
                    continue;
                if (pointInTriangle(poly[j], a, b, c)) {
                    inside = true;
                    break;
                }
            }
            if (inside)
                continue;
            tris.push(ia, ib, ic);
            idx.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped)
            break;
    }
    if (idx.length === 3)
        tris.push(idx[0], idx[1], idx[2]);
    // Resguardo: si quedaron puntos sin triangular, abanico desde el primero
    if (idx.length > 3) {
        const base = idx[0];
        for (let i = 1; i + 1 < idx.length; i++) {
            tris.push(base, idx[i], idx[i + 1]);
        }
    }
    return tris;
}
