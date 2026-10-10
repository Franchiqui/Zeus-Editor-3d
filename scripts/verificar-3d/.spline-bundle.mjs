// lib/geometry.ts
function flattenPolygon(poly, steps = 16) {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: poly[0].x, y: poly[0].y }];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = poly[i];
    const q = poly[j];
    const c1 = p.hOut ?? p;
    const c2 = q.hIn ?? q;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x,
        y: u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * q.y
      });
    }
  }
  return out;
}
function resampleClosed(poly, n) {
  const m = poly.length;
  if (m < 3 || n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  let s = 0;
  for (let i = 1; i < m; i++) {
    if (poly[i].y > poly[s].y + 1e-12 || Math.abs(poly[i].y - poly[s].y) <= 1e-12 && poly[i].x > poly[s].x + 1e-12) {
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
  if (total <= 0) return poly.map((p) => ({ x: p.x, y: p.y }));
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

// lib/spline-3d.ts
var vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
var vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
var vmul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
var vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
var vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
var vnorm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
var vfinito = (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: f(p0.x, p1.x, p2.x, p3.x),
    y: f(p0.y, p1.y, p2.y, p3.y),
    z: f(p0.z, p1.z, p2.z, p3.z)
  };
}
function earClip(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (signedArea < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 6e3) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      if (orient(a, b, c) <= 0) continue;
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        if (orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    tris.push(idx[0], idx[1], idx[2]);
  } else if (idx.length > 3) {
    for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
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
function orientFace(ids, verts, outwardFrom) {
  const nrm = faceNormal(ids, verts);
  const center = faceCenter(ids, verts);
  return vdot(nrm, vsub(center, outwardFrom)) < 0 ? [...ids].reverse() : ids;
}
function muestrearSpline(nodes, closed, subdivisions) {
  const m = nodes.length;
  if (m < 2) return [];
  const steps = Math.max(1, Math.min(64, Math.round(subdivisions)));
  const samples = [];
  const segCount = closed ? m : m - 1;
  for (let s = 0; s < segCount; s++) {
    const env = (i) => closed ? (i + m) % m : Math.max(0, Math.min(m - 1, i));
    const i1 = s;
    const i2 = closed ? (s + 1) % m : Math.min(m - 1, s + 1);
    let p0 = nodes[env(s - 1)].p;
    let p3 = nodes[env(s + 2)].p;
    if (nodes[i1].esquina) p0 = nodes[i1].p;
    if (nodes[i2].esquina) p3 = nodes[i2].p;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      samples.push({
        pos: catmull(p0, nodes[i1].p, nodes[i2].p, p3, t),
        seg: s,
        t
      });
    }
  }
  if (!closed) {
    samples.push({ pos: nodes[m - 1].p, seg: m - 2, t: 1 });
  }
  return samples;
}
function primeraNormal(t) {
  const ref = Math.abs(t.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const n = vnorm(vsub(ref, vmul(t, vdot(ref, t))));
  return n;
}
function transportadores(tangentes) {
  const total = tangentes.length;
  const normales = [primeraNormal(tangentes[0])];
  for (let i = 1; i < total; i++) {
    const t0 = tangentes[i - 1];
    const t1 = tangentes[i];
    const d = vdot(t0, t1);
    let n = normales[i - 1];
    if (d < 0.999999) {
      const eje = vcross(t0, t1);
      if (vfinito(eje) && Math.hypot(eje.x, eje.y, eje.z) > 1e-9) {
        const e = vnorm(eje);
        const ang = Math.acos(Math.max(-1, Math.min(1, d)));
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const rot = (a) => {
          const cr = vcross(e, a);
          const dr = vdot(e, a);
          return {
            x: a.x * c + cr.x * s + e.x * dr * (1 - c),
            y: a.y * c + cr.y * s + e.y * dr * (1 - c),
            z: a.z * c + cr.z * s + e.z * dr * (1 - c)
          };
        };
        n = rot(n);
      }
    }
    const t1n = tangentes[i];
    n = vnorm(vsub(n, vmul(t1n, vdot(n, t1n))));
    normales.push(n);
  }
  return normales;
}
function frenet(tangentes) {
  const total = tangentes.length;
  const normales = [];
  let prev = primeraNormal(tangentes[0]);
  for (let i = 0; i < total; i++) {
    const t = tangentes[i];
    const t0 = tangentes[i === 0 ? 0 : i - 1];
    const t1 = tangentes[i === total - 1 ? total - 1 : i + 1];
    const curv = vsub(t1, t0);
    if (vfinito(curv) && Math.hypot(curv.x, curv.y, curv.z) > 1e-9) {
      const cu = vnorm(vmul(curv, -1));
      const proj = vsub(cu, vmul(t, vdot(cu, t)));
      if (Math.hypot(proj.x, proj.y, proj.z) > 1e-9) prev = vnorm(proj);
    }
    prev = vnorm(vsub(prev, vmul(t, vdot(prev, t))));
    normales.push(prev);
  }
  return normales;
}
var UNIT = 2;
var LIMITE_VERTICES = 2e5;
function buildSpline3DMesh(nodes, options = {}) {
  const empty = { vertices: [], faces: [] };
  const util = nodes.filter(
    (n) => vfinito(n.p) && (n.esquina || (n.polygon ?? []).length >= 3)
  );
  if (util.length < 2) return empty;
  const closed = !!options.closed;
  const esc = options.escala && options.escala > 0 ? options.escala : 0.5;
  const DEF = options.plantillaPorDefecto ?? [];
  const flats = util.map((n) => {
    const poly = n.polygon ?? DEF;
    return flattenPolygon(poly.length >= 3 ? poly : DEF, 12);
  });
  let densa = 0;
  for (const f of flats) densa = Math.max(densa, f.length);
  if (flats.some((f) => f.length < 3)) return empty;
  const ringCount = Math.max(16, Math.min(96, densa));
  const rings = flats.map((f) => resampleClosed(f, ringCount));
  const subdivisions = Math.max(1, Math.min(64, Math.round(options.subdivisions ?? 5)));
  const muestras = muestrearSpline(util, closed, subdivisions);
  if (muestras.length < 2) return empty;
  let steps = subdivisions;
  const maxSteps = Math.max(1, Math.floor(LIMITE_VERTICES / (util.length * ringCount)));
  if (steps > maxSteps) steps = maxSteps;
  const muestrasFinal = steps === subdivisions ? muestras : muestrearSpline(util, closed, steps);
  const total = muestrasFinal.length;
  const tangentes = muestrasFinal.map((_, i) => {
    const prev = muestrasFinal[i === 0 ? closed ? total - 1 : 0 : i - 1].pos;
    const next = muestrasFinal[i === total - 1 ? closed ? 0 : total - 1 : i + 1].pos;
    const d = vsub(next, prev);
    return Math.hypot(d.x, d.y, d.z) < 1e-9 ? { x: 1, y: 0, z: 0 } : vnorm(d);
  });
  const normales = options.orientacion === "radial" ? frenet(tangentes) : transportadores(tangentes);
  const tilts = util.map((n) => (n.tilt ?? 0) * Math.PI / 180);
  const escalas = util.map(
    (n) => n.escala && n.escala > 0 ? Math.max(0.01, Math.min(8, n.escala)) : esc
  );
  const vertices = [];
  const anillas = [];
  for (let i = 0; i < total; i++) {
    const m = muestrasFinal[i];
    const ringA = rings[m.seg];
    const ringB = rings[(m.seg + 1) % util.length];
    const tiltA = tilts[m.seg];
    const tiltB = tilts[(m.seg + 1) % util.length];
    const tilt = tiltA + (tiltB - tiltA) * m.t;
    const prof = [];
    for (let k = 0; k < ringCount; k++) {
      const a = ringA[k];
      const b = ringB[k];
      prof.push({ x: a.x + (b.x - a.x) * m.t, y: a.y + (b.y - a.y) * m.t });
    }
    const c = centroid(prof);
    const escA = escalas[m.seg];
    const escB = escalas[(m.seg + 1) % util.length];
    const esc2 = escA + (escB - escA) * m.t;
    const t1 = tangentes[i];
    const n1 = normales[i];
    const b1 = vcross(n1, t1);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const ids = [];
    for (let k = 0; k < ringCount; k++) {
      const lx = (prof[k].x - c.x) * UNIT * esc2;
      const ly = (prof[k].y - c.y) * UNIT * esc2;
      const a = lx * cos - ly * sin;
      const b = lx * sin + ly * cos;
      const p = vadd(m.pos, vadd(vmul(n1, a), vmul(b1, b)));
      vertices.push({ x: p.x, y: p.y, z: p.z });
      ids.push(vertices.length - 1);
    }
    anillas.push(ids);
  }
  const faces = [];
  const stitch = (aIds, bIds, eje) => {
    for (let k = 0; k < ringCount; k++) {
      const k2 = (k + 1) % ringCount;
      faces.push(orientFace([aIds[k], aIds[k2], bIds[k2], bIds[k]], vertices, eje));
    }
  };
  for (let i = 0; i + 1 < total; i++) {
    const eje = vmul(vadd(muestrasFinal[i].pos, muestrasFinal[i + 1].pos), 0.5);
    stitch(anillas[i], anillas[i + 1], eje);
  }
  if (closed && total > 2) {
    const eje = vmul(vadd(muestrasFinal[total - 1].pos, muestrasFinal[0].pos), 0.5);
    stitch(anillas[total - 1], anillas[0], eje);
  }
  if (!closed) {
    const cap = (ids, centro, tangente, signo) => {
      const salida = vmul(tangente, signo);
      const local = ids.map((id) => {
        const d = vsub(vertices[id], centro);
        return { x: vdot(d, normales[0]), y: vdot(d, vcross(normales[0], tangente)) };
      });
      const tris = earClip(local);
      for (let i = 0; i + 2 < tris.length; i += 3) {
        const tri = [ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]];
        const nrm = faceNormal(tri, vertices);
        if (vdot(nrm, salida) < 0) tri.reverse();
        faces.push(tri);
      }
    };
    cap(anillas[0], muestrasFinal[0].pos, tangentes[0], -1);
    cap(
      anillas[total - 1],
      muestrasFinal[total - 1].pos,
      tangentes[total - 1],
      1
    );
  }
  return { vertices, faces };
}
var ROSCA_DEFECTO = {
  vueltas: 6,
  verticesPorVuelta: 16,
  separacion: 0.4,
  radioMuelle: 0.5,
  radioTubo: 0.12
};
function construirMuestraHelix(params) {
  const totalNodos = params.vueltas * params.verticesPorVuelta;
  if (totalNodos < 1) return [];
  const altura = params.vueltas * params.separacion;
  const plantilla = circuloExacto(32);
  const nodes = [];
  for (let i = 0; i <= totalNodos; i++) {
    const th = i / params.verticesPorVuelta * Math.PI * 2;
    nodes.push({
      id: i,
      p: {
        x: Math.cos(th) * params.radioMuelle,
        y: params.separacion * th / (Math.PI * 2) - altura / 2,
        z: Math.sin(th) * params.radioMuelle
      },
      polygon: plantilla
    });
  }
  return nodes;
}
function circuloExacto(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = i / n * Math.PI * 2;
    pts.push({ x: 0.5 + Math.cos(th) * 0.5, y: 0.5 + Math.sin(th) * 0.5 });
  }
  return pts;
}
var PLANTILLA_SPLINE_DEFECTO = circuloExacto(32);
function buildRoscaMesh(params) {
  const nodes = construirMuestraHelix(params);
  if (nodes.length < 2) return { vertices: [], faces: [] };
  return buildSpline3DMesh(nodes, {
    closed: false,
    subdivisions: 1,
    // el camino ya es denso, sin muestras intermedias
    escala: params.radioTubo
  });
}
var puntoNum = (n) => {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : null;
};
function validarSplineDatos(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const r = raw;
  if (!Array.isArray(r.nodes)) return void 0;
  const nodes = [];
  for (const item of r.nodes.slice(0, 256)) {
    if (!item || typeof item !== "object") continue;
    const o = item;
    if (!o.p || typeof o.p !== "object") continue;
    const pp = o.p;
    const x = puntoNum(pp.x);
    const y = puntoNum(pp.y);
    const z = puntoNum(pp.z);
    if (x === null || y === null || z === null) continue;
    const idN = puntoNum(o.id);
    const node = {
      p: { x, y, z },
      id: idN !== null ? idN : nodes.length
    };
    if (o.esquina === true) node.esquina = true;
    if (typeof o.tilt === "number" && Number.isFinite(o.tilt))
      node.tilt = Math.max(-360, Math.min(360, o.tilt));
    const escalaN2 = puntoNum(o.escala);
    if (escalaN2 !== null && escalaN2 > 0) node.escala = Math.max(0.01, Math.min(8, escalaN2));
    if (Array.isArray(o.polygon)) {
      const poly = [];
      for (const ptRaw of o.polygon) {
        if (Array.isArray(ptRaw) || !ptRaw || typeof ptRaw !== "object") continue;
        const pto = ptRaw;
        const px = puntoNum(pto.x);
        const py = puntoNum(pto.y);
        if (px === null || py === null) continue;
        const punto = { x: px, y: py };
        if (pto.hOut && typeof pto.hOut === "object") {
          const h = pto.hOut;
          const hx = puntoNum(h.x);
          const hy = puntoNum(h.y);
          if (hx !== null && hy !== null) punto.hOut = { x: hx, y: hy };
        }
        if (pto.hIn && typeof pto.hIn === "object") {
          const h = pto.hIn;
          const hx = puntoNum(h.x);
          const hy = puntoNum(h.y);
          if (hx !== null && hy !== null) punto.hIn = { x: hx, y: hy };
        }
        poly.push(punto);
      }
      if (poly.length >= 3) node.polygon = poly;
    }
    nodes.push(node);
  }
  if (nodes.length < 2) return void 0;
  let closed = false;
  if (r.closed === true || r.closed === "true") closed = true;
  const subdivisionsN = puntoNum(r.subdivisions);
  const escalaN = puntoNum(r.escala);
  const datos = {
    nodes,
    closed,
    subdivisions: subdivisionsN !== null ? Math.max(1, Math.min(64, Math.round(subdivisionsN))) : 5,
    escala: escalaN !== null ? Math.max(0.01, Math.min(8, escalaN)) : 0.5,
    orientacion: r.orientacion === "radial" ? "radial" : void 0
  };
  if (r.rosca && typeof r.rosca === "object") {
    const c = r.rosca;
    const vueltas = puntoNum(c.vueltas);
    const vpv = puntoNum(c.verticesPorVuelta);
    const sep = puntoNum(c.separacion);
    const rm = puntoNum(c.radioMuelle);
    const rt = puntoNum(c.radioTubo);
    if (vueltas !== null && vpv !== null && sep !== null && rm !== null && rt !== null) {
      const radioMuelle = Math.max(1e-3, rm);
      datos.rosca = {
        vueltas: Math.max(1, Math.min(40, Math.round(vueltas))),
        verticesPorVuelta: Math.max(6, Math.min(128, Math.round(vpv))),
        separacion: Math.max(1e-3, sep),
        radioMuelle,
        radioTubo: Math.max(5e-3, Math.min(radioMuelle * 0.999, rt))
      };
    }
  }
  return datos;
}
export {
  PLANTILLA_SPLINE_DEFECTO,
  ROSCA_DEFECTO,
  buildRoscaMesh,
  buildSpline3DMesh,
  construirMuestraHelix,
  muestrearSpline,
  validarSplineDatos
};
