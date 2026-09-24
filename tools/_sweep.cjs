"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSweepMesh = buildSweepMesh;
const geometry_1 = require("./_geo.cjs");
const three_1 = require("three");
// 0..1 -> -1..1: la misma escala que usa el extrusor para el lienzo Frontal,
// de modo que una figura dibujada a pantalla completa ocupa lo mismo.
const UNIT = 2;
const UP = { x: 0, y: 0, z: 1 };
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vmul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const vnorm = (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
};
function centroid(pts) {
    let x = 0;
    let y = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
    }
    return { x: x / pts.length, y: y / pts.length };
}
/** Área con signo (dos dimensiones) de un polígono. */
function shoelace2(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
}
/** Punto de una curva de Catmull-Rom (para suavizar el recorrido). */
function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 *
        (2 * b +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t2 +
            (-a + 3 * b - 3 * c + d) * t3);
    return {
        x: f(p0.x, p1.x, p2.x, p3.x),
        y: f(p0.y, p1.y, p2.y, p3.y),
        z: f(p0.z, p1.z, p2.z, p3.z),
    };
}
/**
 * Triangulación por recorte de orejas de un polígono simple en 2D.
 * Devuelve índices (tripletes) sobre la lista de puntos.
 */
function earClip(poly) {
    const n = poly.length;
    if (n < 3)
        return [];
    const idx = Array.from({ length: n }, (_, i) => i);
    const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        signedArea += a.x * b.y - b.x * a.y;
    }
    if (signedArea < 0)
        idx.reverse();
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 6000) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const ia = idx[(i - 1 + idx.length) % idx.length];
            const ib = idx[i];
            const ic = idx[(i + 1) % idx.length];
            const a = poly[ia];
            const b = poly[ib];
            const c = poly[ic];
            if (orient(a, b, c) <= 0)
                continue; // cóncavo o degenerado
            let ok = true;
            for (const j of idx) {
                if (j === ia || j === ib || j === ic)
                    continue;
                const p = poly[j];
                if (orient(a, b, p) >= 0 &&
                    orient(b, c, p) >= 0 &&
                    orient(c, a, p) >= 0) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            tris.push(ia, ib, ic);
            idx.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped)
            break;
    }
    if (idx.length === 3) {
        tris.push(idx[0], idx[1], idx[2]);
    }
    else if (idx.length > 3) {
        for (let i = 1; i + 1 < idx.length; i++)
            tris.push(idx[0], idx[i], idx[i + 1]);
    }
    return tris;
}
function faceNormal(ids, verts) {
    const a = verts[ids[0]];
    const b = verts[ids[1]];
    const c = verts[ids[2]];
    return vcross(vsub(b, a), vsub(c, a));
}
function faceCenter(ids, verts) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const id of ids) {
        x += verts[id].x;
        y += verts[id].y;
        z += verts[id].z;
    }
    const k = ids.length;
    return { x: x / k, y: y / k, z: z / k };
}
/**
 * Orienta una cara para que su normal mire hacia `outwardFrom` (el eje del
 * recorrido): devuelve los índices en el orden que deja la normal saliente.
 * Con `sign = -1` la normal mira hacia `outwardFrom` (se usa en las paredes
 * interiores de un agujero, que deben mirar hacia el hueco).
 */
function orientFace(ids, verts, outwardFrom, sign = 1) {
    const nrm = faceNormal(ids, verts);
    const center = faceCenter(ids, verts);
    return vdot(nrm, vsub(center, outwardFrom)) * sign < 0
        ? [...ids].reverse()
        : ids;
}
/**
 * Construye la malla de un objeto barrido ("recorrido"): la plantilla de
 * cada vértice se coloca con su centro sobre el segmento, perpendicular a
 * él (o inclinada `tilt` grados) y entre vértices consecutivos la plantilla
 * se deforma de una forma a la siguiente. El segmento se suaviza con una
 * curva de Catmull-Rom, así que la figura coge su forma.
 *
 * Si `options.holes` trae figuras, se barren también junto a la plantilla y
 * se restan: la pieza queda hueca de lado a lado (calado / túnel).
 */
function buildSweepMesh(nodes, options = {}) {
    const empty = { vertices: [], faces: [] };
    const usable = nodes.filter((n) => n.polygon.length >= 3);
    if (nodes.length < 2 || usable.length < 2)
        return empty;
    const closed = !!options.closed;
    const steps = Math.max(1, Math.min(64, Math.round(options.subdivisions ?? 10)));
    const scale = options.scale && options.scale > 0 ? options.scale : 1;
    // Todas las anillas deben tener el mismo número de puntos para poder
    // coserlas: se remuestrean a un tamaño común (el del contorno más denso).
    let densest = 0;
    const flats = nodes.map((n) => {
        const flat = (0, geometry_1.flattenPolygon)(n.polygon, 12);
        densest = Math.max(densest, flat.length);
        return flat;
    });
    const ringCount = Math.max(16, Math.min(96, densest));
    const rings = flats.map((f) => (0, geometry_1.resampleClosed)(f, ringCount));
    // Plantillas de los agujeros (calados): constantes a lo largo del recorrido
    // (un solo contorno dibujado en el lienzo Frontal) y remuestreadas al mismo
    // número de puntos que las anillas para poder coser sus paredes.
    const holeRings = [];
    const holeDepths = [];
    for (const hole of options.holes ?? []) {
        const poly = (0, geometry_1.holePolygon)(hole);
        if (poly.length < 3)
            continue;
        const flat = (0, geometry_1.flattenPolygon)(poly, 12);
        if (flat.length < 3)
            continue;
        holeRings.push((0, geometry_1.resampleClosed)(flat, ringCount));
        holeDepths.push((0, geometry_1.holeDepth)(hole));
    }
    const holeCount = holeRings.length;
    // Centros en el mundo: el recorrido vive en el plano XY (la plantilla se
    // barre perpendicular, hacia dentro/atrás).
    const m = nodes.length;
    const centers = nodes.map((n) => ({
        x: (n.x - 0.5) * UNIT * scale,
        y: (0.5 - n.y) * UNIT * scale,
        z: 0,
    }));
    const tilts = nodes.map((n) => ((n.tilt ?? 0) * Math.PI) / 180);
    const samples = [];
    const segCount = closed ? m : m - 1;
    for (let s = 0; s < segCount; s++) {
        const i0 = closed ? (s - 1 + m) % m : Math.max(0, s - 1);
        const i1 = s;
        const i2 = closed ? (s + 1) % m : Math.min(m - 1, s + 1);
        const i3 = closed ? (s + 2) % m : Math.min(m - 1, s + 2);
        for (let k = 0; k < steps; k++) {
            const t = k / steps;
            samples.push({
                pos: catmull(centers[i0], centers[i1], centers[i2], centers[i3], t),
                seg: s,
                t,
            });
        }
    }
    if (!closed) {
        samples.push({ pos: centers[m - 1], seg: m - 2, t: 1 });
    }
    // Tangentes por diferencias finitas sobre las muestras.
    const total = samples.length;
    const tangents = samples.map((_, i) => {
        const prev = samples[i === 0 ? (closed ? total - 1 : 0) : i - 1].pos;
        const next = samples[i === total - 1 ? (closed ? 0 : total - 1) : i + 1].pos;
        const d = vsub(next, prev);
        return Math.hypot(d.x, d.y, d.z) < 1e-9 ? { x: 1, y: 0, z: 0 } : vnorm(d);
    });
    // Longitud de arco acumulada a lo largo del recorrido (calado ciego).
    const cumLen = [0];
    for (let i = 1; i < total; i++) {
        const dd = vsub(samples[i].pos, samples[i - 1].pos);
        cumLen[i] = cumLen[i - 1] + Math.hypot(dd.x, dd.y, dd.z);
    }
    const pathLen = cumLen[total - 1] || 0;
    // Fondo de cada agujero: pasante (o recorrido cerrado) => total - 1; ciego
    // => la muestra `e` cuyo tramo [e, e+1] contiene la profundidad `hd`, más
    // la fracción `fr` dentro de ese tramo. Así el suelo se coloca en la
    // profundidad EXACTA (no en la muestra más cercana), imprescindible porque
    // las muestras del recorrido no están equiespaciadas.
    const holeEndIdx = [];
    const holeFloorFrac = [];
    for (let h = 0; h < holeCount; h++) {
        const hd = holeDepths[h];
        if (closed || !(hd > 0) || hd >= pathLen - 1e-9) {
            holeEndIdx.push(total - 1);
            holeFloorFrac.push(0);
            continue;
        }
        let e = total - 1;
        for (let i = 0; i + 1 < total; i++) {
            if (cumLen[i] <= hd + 1e-12 && hd <= cumLen[i + 1] + 1e-12) {
                e = i;
                break;
            }
        }
        let fr = 0;
        const seg = cumLen[e + 1] - cumLen[e];
        if (e + 1 < total && seg > 1e-12) {
            fr = (hd - cumLen[e]) / seg;
            if (fr < 0)
                fr = 0;
            if (fr > 1)
                fr = 1;
            if (fr > 1 - 1e-9) {
                e += 1;
                fr = 0;
            } // justo en la muestra siguiente
        }
        holeEndIdx.push(Math.min(e, total - 1));
        holeFloorFrac.push(fr);
    }
    const vertices = [];
    const ringIds = [];
    const holeRingIds = []; // [muestra][agujero][punto]
    for (let i = 0; i < total; i++) {
        const sample = samples[i];
        const ringA = rings[sample.seg];
        const ringB = rings[(sample.seg + 1) % m];
        const tiltA = tilts[sample.seg];
        const tiltB = tilts[(sample.seg + 1) % m];
        const tilt = tiltA + (tiltB - tiltA) * sample.t;
        // Plantilla interpolada (deformación progresiva de una forma a otra).
        const prof = [];
        for (let k = 0; k < ringCount; k++) {
            const a = ringA[k];
            const b = ringB[k];
            prof.push({ x: a.x + (b.x - a.x) * sample.t, y: a.y + (b.y - a.y) * sample.t });
        }
        const c = centroid(prof);
        // Marco local: la tangente es la normal del plano de la plantilla; en su
        // plano, `perp` (perpendicular al segmento dentro de XY) y el eje Z.
        const tangent = tangents[i];
        const perp = vnorm({ x: tangent.y, y: -tangent.x, z: 0 });
        const cos = Math.cos(tilt);
        const sin = Math.sin(tilt);
        const ids = [];
        for (let k = 0; k < ringCount; k++) {
            const lx = (prof[k].x - c.x) * UNIT * scale;
            const ly = (prof[k].y - c.y) * UNIT * scale;
            const a = lx * cos - ly * sin;
            const b = lx * sin + ly * cos;
            const p = vadd(sample.pos, vadd(vmul(perp, a), vmul(UP, b)));
            vertices.push({ x: p.x, y: p.y, z: p.z });
            ids.push(vertices.length - 1);
        }
        ringIds.push(ids);
        // Anillas de los agujeros: se colocan en el mismo marco, desplazadas
        // respecto al centro de la plantilla (conservan su sitio dentro de la
        // figura), de modo que barren un túnel a lo largo de todo el recorrido.
        const sampleHoleIds = [];
        for (let h = 0; h < holeCount; h++) {
            const hr = holeRings[h];
            const idsH = [];
            for (let k = 0; k < ringCount; k++) {
                const lx = (hr[k].x - c.x) * UNIT * scale;
                const ly = (hr[k].y - c.y) * UNIT * scale;
                const a = lx * cos - ly * sin;
                const b = lx * sin + ly * cos;
                const p = vadd(sample.pos, vadd(vmul(perp, a), vmul(UP, b)));
                vertices.push({ x: p.x, y: p.y, z: p.z });
                idsH.push(vertices.length - 1);
            }
            sampleHoleIds.push(idsH);
        }
        holeRingIds.push(sampleHoleIds);
    }
    // Anillos de FONDO de los calados ciegos: interpolados dentro del tramo
    // [e, e+1] según `fr`, para colocar el suelo en la profundidad exacta.
    const holeFloorIds = new Array(holeCount).fill(null);
    for (let h = 0; h < holeCount; h++) {
        const e = holeEndIdx[h];
        const fr = holeFloorFrac[h];
        if (e >= total - 1 || fr <= 1e-9)
            continue;
        const aIds = holeRingIds[e][h];
        const bIds = holeRingIds[e + 1][h];
        const ids = [];
        for (let k = 0; k < ringCount; k++) {
            const A = vertices[aIds[k]];
            const B = vertices[bIds[k]];
            vertices.push({
                x: A.x + (B.x - A.x) * fr,
                y: A.y + (B.y - A.y) * fr,
                z: A.z + (B.z - A.z) * fr,
            });
            ids.push(vertices.length - 1);
        }
        holeFloorIds[h] = ids;
    }
    const faces = [];
    // Piel: coser anillas consecutivas. La cara se orienta hacia fuera tomando
    // como referencia el eje indicado (`sign = 1` hacia fuera; las paredes del
    // agujero usan `sign = -1` para mirar hacia su propio hueco).
    const stitch = (aIds, bIds, axis, sign = 1) => {
        for (let k = 0; k < ringCount; k++) {
            const k2 = (k + 1) % ringCount;
            const quad = [aIds[k], aIds[k2], bIds[k2], bIds[k]];
            faces.push(orientFace(quad, vertices, axis, sign));
        }
    };
    // Piel exterior.
    for (let i = 0; i + 1 < total; i++) {
        const axis = vmul(vadd(samples[i].pos, samples[i + 1].pos), 0.5);
        stitch(ringIds[i], ringIds[i + 1], axis, 1);
    }
    if (closed) {
        const axis = vmul(vadd(samples[total - 1].pos, samples[0].pos), 0.5);
        stitch(ringIds[total - 1], ringIds[0], axis, 1);
    }
    // Piel interior de cada agujero (normales hacia el eje del agujero).
    // Un calado ciego solo recorre las muestras hasta su fondo.
    if (holeCount > 0) {
        for (let h = 0; h < holeCount; h++) {
            const last = holeEndIdx[h];
            for (let i = 0; i < last; i++) {
                const aIds = holeRingIds[i][h];
                const bIds = holeRingIds[i + 1][h];
                const axis = vmul(vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)), 0.5);
                stitch(aIds, bIds, axis, -1);
            }
            // Tramo final hasta el fondo exacto (calado ciego interpolado).
            const floorIds = holeFloorIds[h];
            if (floorIds) {
                const eIds = holeRingIds[holeEndIdx[h]][h];
                const axis = vmul(vadd(faceCenter(eIds, vertices), faceCenter(floorIds, vertices)), 0.5);
                stitch(eIds, floorIds, axis, -1);
            }
            if (closed) {
                const aIds = holeRingIds[total - 1][h];
                const bIds = holeRingIds[0][h];
                const axis = vmul(vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)), 0.5);
                stitch(aIds, bIds, axis, -1);
            }
        }
    }
    // Tapas (recorrido abierto): se triangula la anilla en su propio plano,
    // restando los agujeros cuando los hay.
    const cap = (ids, holeIdsList, center, tangent, sign) => {
        const perp = vnorm({ x: tangent.y, y: -tangent.x, z: 0 });
        const to2d = (id) => {
            const d = vsub(vertices[id], center);
            return { x: vdot(d, perp), y: vdot(d, UP) };
        };
        const outward = vmul(tangent, sign);
        if (holeIdsList.length === 0) {
            const local = ids.map(to2d);
            const tris = earClip(local);
            for (let i = 0; i + 2 < tris.length; i += 3) {
                const tri = [ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]];
                const nrm = faceNormal(tri, vertices);
                if (vdot(nrm, outward) < 0)
                    tri.reverse();
                faces.push(tri);
            }
            return;
        }
        // Con agujeros: ShapeUtils/Earcut para que la tapa respete el hueco.
        const mainOrd = [...ids];
        const contour2d = mainOrd.map(to2d);
        if (shoelace2(contour2d) < 0) {
            contour2d.reverse();
            mainOrd.reverse();
        }
        const holesOrd = holeIdsList.map((h) => [...h]);
        const holes2d = holesOrd.map((h, hi) => {
            const arr = h.map(to2d);
            if (shoelace2(arr) > 0) {
                arr.reverse();
                holesOrd[hi].reverse();
            }
            return arr;
        });
        let tris = [];
        try {
            const raw = three_1.ShapeUtils.triangulateShape(contour2d.map((q) => new three_1.Vector2(q.x, q.y)), holes2d.map((h) => h.map((q) => new three_1.Vector2(q.x, q.y))));
            tris = Array.isArray(raw) ? raw : [];
        }
        catch {
            tris = [];
        }
        if (!tris.length)
            return; // mejor sin tapa que romper la malla
        const flatIds = [].concat(mainOrd, ...holesOrd);
        for (const t of tris) {
            const i0 = flatIds[t[0]];
            const i1 = flatIds[t[1]];
            const i2 = flatIds[t[2]];
            if (i0 === undefined || i1 === undefined || i2 === undefined)
                continue;
            const tri = [i0, i1, i2];
            const nrm = faceNormal(tri, vertices);
            if (vdot(nrm, outward) < 0)
                tri.reverse();
            faces.push(tri);
        }
    };
    if (!closed) {
        // Tapa inicial: todos los agujeros (pasantes y ciegos) abren aquí.
        cap(ringIds[0], holeRingIds[0], samples[0].pos, tangents[0], -1);
        // Tapa final: solo los agujeros PASANTES la atraviesan; los ciegos
        // quedan cerrados por su propio suelo antes de llegar.
        const throughEndHoles = [];
        for (let h = 0; h < holeCount; h++) {
            if (holeEndIdx[h] >= total - 1)
                throughEndHoles.push(holeRingIds[total - 1][h]);
        }
        cap(ringIds[total - 1], throughEndHoles, samples[total - 1].pos, tangents[total - 1], 1);
        // Suelo (fondo) de cada calado ciego: tapa rellena en su muestra
        // final, mirando hacia atrás (hacia la abertura del bolsillo).
        for (let h = 0; h < holeCount; h++) {
            const e = holeEndIdx[h];
            if (e >= total - 1)
                continue;
            const fIds = holeFloorIds[h];
            if (fIds) {
                const A = samples[e].pos;
                const B = samples[e + 1].pos;
                const fr = holeFloorFrac[h];
                const center = {
                    x: A.x + (B.x - A.x) * fr,
                    y: A.y + (B.y - A.y) * fr,
                    z: A.z + (B.z - A.z) * fr,
                };
                const t0 = tangents[e];
                const t1 = tangents[e + 1];
                const tan = vnorm({
                    x: t0.x + (t1.x - t0.x) * fr,
                    y: t0.y + (t1.y - t0.y) * fr,
                    z: t0.z + (t1.z - t0.z) * fr,
                });
                cap(fIds, [], center, tan, -1);
            }
            else {
                cap(holeRingIds[e][h], [], samples[e].pos, tangents[e], -1);
            }
        }
    }
    return { vertices, faces };
}
