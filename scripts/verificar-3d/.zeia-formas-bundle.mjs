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

// lib/primitivas-parametricas.ts
var PARAMETROS_POR_ARCHIVO = {
  cubo: { kind: "cubo", ancho: 1, alto: 1, profundo: 1, segX: 1, segY: 1, segZ: 1 },
  esfera: { kind: "esfera", radio: 0.5, meridianos: 26, anillos: 13 },
  toroide: { kind: "toroide", radioAnillo: 1 / 3, radioTubo: 1 / 6, segAnillo: 32, segTubo: 16 },
  tubo: {
    kind: "tubo",
    radioInterno: 0.25,
    radioExterno: 0.5,
    altura: 0.5,
    segRotacion: 16,
    segAltura: 4,
    segTapa: 1
  },
  cono: { kind: "cono", radio: 0.5, altura: 1, segmentos: 16, bandas: 4 },
  cilindro: { kind: "cilindro", radio: 0.25, altura: 1, segmentos: 16, bandas: 4 },
  plano: { kind: "plano", ancho: 1, profundo: 1, segX: 10, segZ: 10 },
  piramide: { kind: "piramide", lado: 1, altura: 1 },
  capsula: {
    kind: "capsula",
    radio: 0.25,
    altura: 1,
    segmentos: 16,
    bandasCuerpo: 4,
    bandasCasquete: 4
  },
  disco: { kind: "disco", radio: 0.5, radioInterior: 0, sectores: 33 }
};
var v = (x, y, z) => ({ x, y, z });
var MIN = 1e-3;
var MAX_SEG = 128;
var num = (n, fallback) => {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
};
var entero = (n, fallback, min, max) => {
  const x = Math.round(num(n, fallback));
  return Math.max(min, Math.min(max, x));
};
var positivo = (n, fallback) => Math.max(MIN, num(n, fallback));
function normalizarParams(p) {
  switch (p.kind) {
    case "cubo":
      return {
        kind: "cubo",
        ancho: positivo(p.ancho, 1),
        alto: positivo(p.alto, 1),
        profundo: positivo(p.profundo, 1),
        segX: entero(p.segX, 1, 1, MAX_SEG),
        segY: entero(p.segY, 1, 1, MAX_SEG),
        segZ: entero(p.segZ, 1, 1, MAX_SEG)
      };
    case "esfera":
      return {
        kind: "esfera",
        radio: positivo(p.radio, 0.5),
        meridianos: entero(p.meridianos, 26, 3, MAX_SEG),
        anillos: entero(p.anillos, 13, 3, MAX_SEG)
      };
    case "toroide":
      return {
        kind: "toroide",
        radioAnillo: positivo(p.radioAnillo, 1 / 3),
        radioTubo: Math.min(positivo(p.radioTubo, 1 / 6), positivo(p.radioAnillo, 1 / 3)),
        segAnillo: entero(p.segAnillo, 32, 3, MAX_SEG),
        segTubo: entero(p.segTubo, 16, 3, MAX_SEG)
      };
    case "tubo": {
      const ro = positivo(p.radioExterno, 0.5);
      return {
        kind: "tubo",
        radioExterno: ro,
        radioInterno: Math.min(positivo(p.radioInterno, 0.25), ro * 0.999),
        altura: positivo(p.altura, 0.5),
        segRotacion: entero(p.segRotacion, 16, 3, MAX_SEG),
        segAltura: entero(p.segAltura, 4, 1, MAX_SEG),
        segTapa: entero(p.segTapa, 1, 1, MAX_SEG)
      };
    }
    case "cono":
      return {
        kind: "cono",
        radio: positivo(p.radio, 0.5),
        altura: positivo(p.altura, 1),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandas: entero(p.bandas, 4, 1, MAX_SEG)
      };
    case "cilindro":
      return {
        kind: "cilindro",
        radio: positivo(p.radio, 0.25),
        altura: positivo(p.altura, 1),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandas: entero(p.bandas, 4, 1, MAX_SEG)
      };
    case "plano":
      return {
        kind: "plano",
        ancho: positivo(p.ancho, 1),
        profundo: positivo(p.profundo, 1),
        segX: entero(p.segX, 10, 1, MAX_SEG),
        segZ: entero(p.segZ, 10, 1, MAX_SEG)
      };
    case "piramide":
      return { kind: "piramide", lado: positivo(p.lado, 1), altura: positivo(p.altura, 1) };
    case "capsula": {
      const radio = positivo(p.radio, 0.25);
      return {
        kind: "capsula",
        radio,
        altura: Math.max(positivo(p.altura, 1), radio * 2 + MIN),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandasCuerpo: entero(p.bandasCuerpo, 4, 1, MAX_SEG),
        bandasCasquete: entero(p.bandasCasquete, 4, 1, MAX_SEG)
      };
    }
    case "disco": {
      const radio = positivo(p.radio, 0.5);
      return {
        kind: "disco",
        radio,
        radioInterior: Math.max(0, Math.min(num(p.radioInterior, 0), radio * 0.999)),
        sectores: entero(p.sectores, 33, 3, MAX_SEG)
      };
    }
    case "muelle":
      return {
        kind: "muelle",
        vueltas: entero(p.vueltas, 6, 1, 40),
        verticesPorVuelta: entero(p.verticesPorVuelta, 16, 6, MAX_SEG),
        separacion: positivo(p.separacion, 0.4),
        radioMuelle: positivo(p.radioMuelle, 0.5),
        // Como el toroide: el tubo no pasa del centro del propio muelle.
        radioTubo: Math.min(positivo(p.radioTubo, 0.12), positivo(p.radioMuelle, 0.5) * 0.999)
      };
  }
}
function caraRet(vertices, faces, o, u, dirV, nu, nv) {
  const base = vertices.length;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      vertices.push(
        A(o.x + u.x * i + dirV.x * j, o.y + u.y * i + dirV.y * j, o.z + u.z * i + dirV.z * j)
      );
    }
  }
  const fila = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      faces.push([
        base + i * fila + j,
        base + (i + 1) * fila + j,
        base + (i + 1) * fila + j + 1,
        base + i * fila + j + 1
      ]);
    }
  }
}
var A = (x, y, z) => ({ x, y, z });
function construirCubo(p) {
  const vertices = [];
  const faces = [];
  const hx = p.ancho / 2, hy = p.alto / 2, hz = p.profundo / 2;
  caraRet(vertices, faces, A(-hx, -hy, +hz), A(p.ancho / p.segX, 0, 0), A(0, p.alto / p.segY, 0), p.segX, p.segY);
  caraRet(vertices, faces, A(+hx, -hy, -hz), A(-p.ancho / p.segX, 0, 0), A(0, p.alto / p.segY, 0), p.segX, p.segY);
  caraRet(vertices, faces, A(-hx, +hy, -hz), A(0, 0, p.profundo / p.segZ), A(p.ancho / p.segX, 0, 0), p.segZ, p.segX);
  caraRet(vertices, faces, A(-hx, -hy, -hz), A(p.ancho / p.segX, 0, 0), A(0, 0, p.profundo / p.segZ), p.segX, p.segZ);
  caraRet(vertices, faces, A(+hx, -hy, -hz), A(0, p.alto / p.segY, 0), A(0, 0, p.profundo / p.segZ), p.segY, p.segZ);
  caraRet(vertices, faces, A(-hx, +hy, -hz), A(0, -p.alto / p.segY, 0), A(0, 0, p.profundo / p.segZ), p.segY, p.segZ);
  return { vertices, faces };
}
function construirEsfera(p) {
  const M = p.meridianos;
  const A_ = p.anillos;
  const vertices = [v(0, p.radio, 0)];
  const anillosY = [];
  for (let k = 1; k < A_; k++) {
    const phi = k / A_ * Math.PI;
    const r = Math.sin(phi) * p.radio;
    const y = Math.cos(phi) * p.radio;
    anillosY.push(Array.from({ length: M }, (_, j) => {
      const th = j / M * Math.PI * 2;
      return vertices.push(v(Math.cos(th) * r, y, Math.sin(th) * r)) - 1;
    }));
  }
  const polo_abajo = vertices.push(v(0, -p.radio, 0)) - 1;
  const faces = [];
  const sup = anillosY[0];
  for (let j = 0; j < M; j++) faces.push([0, sup[(j + 1) % M], sup[j]]);
  for (let k = 0; k < anillosY.length - 1; k++) {
    const arriba = anillosY[k];
    const abj = anillosY[k + 1];
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      faces.push([arriba[j], arriba[j2], abj[j2], abj[j]]);
    }
  }
  const inf = anillosY[anillosY.length - 1];
  for (let j = 0; j < M; j++) faces.push([polo_abajo, inf[j], inf[(j + 1) % M]]);
  return { vertices, faces };
}
function construirToroide(p) {
  const vertices = [];
  const faces = [];
  for (let i = 0; i < p.segAnillo; i++) {
    const u = i / p.segAnillo * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < p.segTubo; j++) {
      const t = j / p.segTubo * Math.PI * 2;
      const r = p.radioAnillo + p.radioTubo * Math.cos(t);
      vertices.push(v(cu * r, p.radioTubo * Math.sin(t), su * r));
    }
  }
  for (let i = 0; i < p.segAnillo; i++) {
    const i2 = (i + 1) % p.segAnillo;
    for (let j = 0; j < p.segTubo; j++) {
      const j2 = (j + 1) % p.segTubo;
      faces.push([
        i * p.segTubo + j,
        i * p.segTubo + j2,
        i2 * p.segTubo + j2,
        i2 * p.segTubo + j
      ]);
    }
  }
  return { vertices, faces };
}
function anilloRadial(vertices, y, radio, segs) {
  return Array.from({ length: segs }, (_, j) => {
    const th = j / segs * Math.PI * 2;
    return vertices.push(v(Math.cos(th) * radio, y, Math.sin(th) * radio)) - 1;
  });
}
function paredVertical(faces, superior, inferior, invertir = false) {
  const n = superior.length;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    const cara = invertir ? [superior[j2], superior[j], inferior[j], inferior[j2]] : [superior[j], superior[j2], inferior[j2], inferior[j]];
    faces.push(cara);
  }
}
function construirTubo(p) {
  const vertices = [];
  const faces = [];
  const hh = p.altura / 2;
  const ext = [];
  for (let i = 0; i <= p.segAltura; i++) {
    ext.push(anilloRadial(vertices, hh - i / p.segAltura * p.altura, p.radioExterno, p.segRotacion));
  }
  for (let i = 0; i < p.segAltura; i++) paredVertical(faces, ext[i], ext[i + 1]);
  const int = [];
  for (let i = 0; i <= p.segAltura; i++) {
    int.push(anilloRadial(vertices, hh - i / p.segAltura * p.altura, p.radioInterno, p.segRotacion));
  }
  for (let i = 0; i < p.segAltura; i++) paredVertical(faces, int[i], int[i + 1], true);
  for (const [y, haciaArriba] of [
    [hh, true],
    [-hh, false]
  ]) {
    for (let t = 0; t < p.segTapa; t++) {
      const r0 = p.radioInterno + (p.radioExterno - p.radioInterno) * t / p.segTapa;
      const r1 = p.radioInterno + (p.radioExterno - p.radioInterno) * (t + 1) / p.segTapa;
      const extT = anilloRadial(vertices, y, r1, p.segRotacion);
      const intT = anilloRadial(vertices, y, r0, p.segRotacion);
      for (let j = 0; j < p.segRotacion; j++) {
        const j2 = (j + 1) % p.segRotacion;
        faces.push(
          haciaArriba ? [extT[j], intT[j], intT[j2], extT[j2]] : [extT[j], extT[j2], intT[j2], intT[j]]
        );
      }
    }
  }
  return { vertices, faces };
}
function lateralBandas(vertices, faces, radios, alturas, segs, haciaFuera = true) {
  const filas = [];
  for (let i = 0; i < radios.length; i++) {
    filas.push(anilloRadial(vertices, alturas[i], radios[i], segs));
  }
  for (let i = 0; i < filas.length - 1; i++) {
    paredVertical(faces, filas[i], filas[i + 1], !haciaFuera);
  }
  return filas;
}
function abanicoHorizontal(faces, centro, anillo, arriba) {
  const n = anillo.length;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    faces.push(arriba ? [centro, anillo[j2], anillo[j]] : [centro, anillo[j], anillo[j2]]);
  }
}
function construirCono(p) {
  const vertices = [];
  const faces = [];
  const hh = p.altura / 2;
  const B = p.bandas;
  const filas = [];
  for (let k = 1; k <= B; k++) {
    filas.push(anilloRadial(vertices, hh - k / B * p.altura, p.radio * k / B, p.segmentos));
  }
  for (let k = 0; k < filas.length - 1; k++) {
    paredVertical(faces, filas[k], filas[k + 1]);
  }
  const apex = vertices.push(v(0, hh, 0)) - 1;
  const primera = filas[0];
  for (let j = 0; j < p.segmentos; j++) {
    const j2 = (j + 1) % p.segmentos;
    faces.push([apex, primera[j2], primera[j]]);
  }
  const centroBase = vertices.push(v(0, -hh, 0)) - 1;
  abanicoHorizontal(faces, centroBase, filas[filas.length - 1], false);
  return { vertices, faces };
}
function construirCilindro(p) {
  const vertices = [];
  const faces = [];
  const hh = p.altura / 2;
  const radios = [];
  const alturas = [];
  for (let i = 0; i <= p.bandas; i++) {
    radios.push(p.radio);
    alturas.push(hh - i / p.bandas * p.altura);
  }
  const filas = lateralBandas(vertices, faces, radios, alturas, p.segmentos);
  const centroSup = vertices.push(v(0, hh, 0)) - 1;
  abanicoHorizontal(faces, centroSup, filas[0], true);
  const centroInf = vertices.push(v(0, -hh, 0)) - 1;
  abanicoHorizontal(faces, centroInf, filas[filas.length - 1], false);
  return { vertices, faces };
}
function construirPlano(p) {
  const vertices = [];
  const faces = [];
  caraRet(
    vertices,
    faces,
    A(-p.ancho / 2, 0, -p.profundo / 2),
    A(0, 0, p.profundo / p.segZ),
    A(p.ancho / p.segX, 0, 0),
    p.segZ,
    p.segX
  );
  return { vertices, faces };
}
function construirPiramide(p) {
  const b = p.lado / 2;
  const hh = p.altura / 2;
  const vertices = [
    v(-b, -hh, -b),
    v(b, -hh, -b),
    v(b, -hh, b),
    v(-b, -hh, b),
    v(0, hh, 0)
  ];
  const faces = [
    [0, 4, 1],
    [1, 4, 2],
    [2, 4, 3],
    [3, 4, 0],
    [0, 1, 2, 3]
  ];
  return { vertices, faces };
}
function construirCapsula(p) {
  const vertices = [];
  const faces = [];
  const hh = p.altura / 2;
  const M = p.segmentos;
  const B = p.bandasCasquete;
  const filas = [];
  const poloInf = vertices.push(v(0, -hh, 0)) - 1;
  for (let k = 1; k < B; k++) {
    const phi = k / (2 * B) * Math.PI;
    const r = Math.sin(phi) * p.radio;
    filas.push({
      indices: anilloRadial(vertices, -hh + p.radio * (1 - Math.cos(phi)), r, M)
    });
  }
  const yCuerpo = hh - p.radio;
  for (let k = 0; k <= p.bandasCuerpo; k++) {
    filas.push({
      indices: anilloRadial(vertices, -yCuerpo + 2 * yCuerpo / p.bandasCuerpo * k, p.radio, M)
    });
  }
  for (let k = B - 1; k >= 1; k--) {
    const phi = k / (2 * B) * Math.PI;
    const r = Math.sin(phi) * p.radio;
    filas.push({
      indices: anilloRadial(vertices, hh - p.radio * (1 - Math.cos(phi)), r, M)
    });
  }
  const poloSup = vertices.push(v(0, hh, 0)) - 1;
  for (let i = 0; i < filas.length - 1; i++) {
    const a = filas[i].indices;
    const b = filas[i + 1].indices;
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      faces.push([a[j], b[j], b[j2], a[j2]]);
    }
  }
  const primera = filas[0].indices;
  for (let j = 0; j < M; j++) faces.push([poloInf, primera[j], primera[(j + 1) % M]]);
  const ultima = filas[filas.length - 1].indices;
  for (let j = 0; j < M; j++) faces.push([poloSup, ultima[(j + 1) % M], ultima[j]]);
  return { vertices, faces };
}
function construirDisco(p) {
  const N = p.sectores;
  if (p.radioInterior <= 0) {
    const vertices2 = [v(0, 0, 0)];
    const faces2 = [];
    const exteriores = anilloRadial(vertices2, 0, p.radio, N);
    for (let i = 0; i < N; i++) {
      faces2.push([exteriores[(N - i - 1 + N) % N], 0, exteriores[(N - i + N) % N]]);
    }
    return { vertices: vertices2, faces: faces2 };
  }
  const vertices = [];
  const faces = [];
  const fuera = anilloRadial(vertices, 0, p.radio, N);
  const dentro = anilloRadial(vertices, 0, p.radioInterior, N);
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    faces.push([fuera[j], fuera[j2], dentro[j2], dentro[j]]);
  }
  return { vertices, faces };
}
function construirMallaPrimitiva(params) {
  const p = normalizarParams(params);
  switch (p.kind) {
    case "cubo":
      return construirCubo(p);
    case "esfera":
      return construirEsfera(p);
    case "toroide":
      return construirToroide(p);
    case "tubo":
      return construirTubo(p);
    case "cono":
      return construirCono(p);
    case "cilindro":
      return construirCilindro(p);
    case "plano":
      return construirPlano(p);
    case "piramide":
      return construirPiramide(p);
    case "capsula":
      return construirCapsula(p);
    case "disco":
      return construirDisco(p);
    case "muelle":
      return buildRoscaMesh(p);
  }
}

// lib/zeia-primitives.ts
var v2 = (x, y, z) => ({ x, y, z });
function normalizePrimitiveName(name) {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase();
  switch (n) {
    case "cube":
    case "box":
    case "caja":
    case "cubo":
      return "cube";
    case "sphere":
    case "esfera":
    case "bola":
      return "sphere";
    case "cylinder":
    case "cilindro":
      return "cylinder";
    case "cone":
    case "cono":
      return "cone";
    case "torus":
    case "toro":
    case "donut":
      return "torus";
    case "plane":
    case "plano":
    case "ground":
    case "suelo":
      return "plane";
    case "pyramid":
    case "piramide":
    case "pir\xE1mide":
      return "pyramid";
    case "tetrahedron":
    case "tetra":
    case "tetraedro":
      return "tetrahedron";
    case "capsule":
    case "c\xE1psula":
    case "capsula":
    case "pill":
    case "pastilla":
      return "capsule";
    case "tube":
    case "tubo":
    case "pipe":
    case "tuberia":
    case "tuber\xEDa":
      return "tube";
    case "disc":
    case "disco":
    case "plate":
    case "plato":
    case "dish":
      return "disc";
    case "ring":
    case "anillo":
    case "argolla":
    case "annulus":
    case "aro":
      return "ring";
    case "spring":
    case "muelle":
    case "resorte":
    case "helice":
    case "h\xE9lice":
    case "spiral":
    case "coil":
      return "spring";
    default:
      return null;
  }
}
function primitiveIsSmooth(name) {
  return name === "sphere" || name === "cylinder" || name === "cone" || name === "torus" || name === "capsule" || name === "tube" || name === "spring";
}
function cube(half) {
  const vertices = [
    v2(-half, -half, -half),
    // 0
    v2(half, -half, -half),
    // 1
    v2(half, half, -half),
    // 2
    v2(-half, half, -half),
    // 3
    v2(-half, -half, half),
    // 4
    v2(half, -half, half),
    // 5
    v2(half, half, half),
    // 6
    v2(-half, half, half)
    // 7
  ];
  const faces = [
    [4, 5, 6, 7],
    // frente (+Z)
    [1, 0, 3, 2],
    // atrás (-Z)
    [0, 4, 7, 3],
    // izquierda (-X)
    [5, 1, 2, 6],
    // derecha (+X)
    [3, 7, 6, 2],
    // arriba (+Y)
    [0, 1, 5, 4]
    // abajo (-Y)
  ];
  return { vertices, faces };
}
function plane(half) {
  const vertices = [
    v2(-half, 0, -half),
    v2(half, 0, -half),
    v2(half, 0, half),
    v2(-half, 0, half)
  ];
  const faces = [[0, 1, 2, 3]];
  return { vertices, faces };
}
function sphere(radius, rings = 16, segments = 24) {
  const vertices = [];
  const faces = [];
  for (let i = 0; i <= rings; i++) {
    const phi = i / rings * Math.PI;
    const y = Math.cos(phi) * radius;
    const r = Math.sin(phi) * radius;
    for (let j = 0; j <= segments; j++) {
      const theta = j / segments * Math.PI * 2;
      vertices.push(v2(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
  }
  const rowLen = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      faces.push([a, a + 1, b + 1, b]);
    }
  }
  return { vertices, faces };
}
function cylinder(radius, height, segments = 24) {
  const vertices = [];
  const faces = [];
  const hh = height / 2;
  for (let j = 0; j <= segments; j++) {
    const theta = j / segments * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    vertices.push(v2(x, hh, z));
    vertices.push(v2(x, -hh, z));
  }
  for (let j = 0; j < segments; j++) {
    const top = j * 2;
    const bot = top + 1;
    const ntop = (j + 1) * 2;
    const nbot = ntop + 1;
    faces.push([top, ntop, nbot, bot]);
  }
  const topCenter = vertices.push(v2(0, hh, 0)) - 1;
  const botCenter = vertices.push(v2(0, -hh, 0)) - 1;
  for (let j = 0; j < segments; j++) {
    const top = j * 2;
    const ntop = (j + 1) * 2;
    const bot = top + 1;
    const nbot = ntop + 1;
    faces.push([topCenter, ntop, top]);
    faces.push([botCenter, bot, nbot]);
  }
  return { vertices, faces };
}
function cone(radius, height, segments = 24) {
  const vertices = [];
  const faces = [];
  const hh = height / 2;
  const apex = vertices.push(v2(0, hh, 0)) - 1;
  for (let j = 0; j <= segments; j++) {
    const theta = j / segments * Math.PI * 2;
    vertices.push(v2(Math.cos(theta) * radius, -hh, Math.sin(theta) * radius));
  }
  for (let j = 0; j < segments; j++) {
    faces.push([apex, j + 2, j + 1]);
  }
  const baseCenter = vertices.push(v2(0, -hh, 0)) - 1;
  for (let j = 0; j < segments; j++) {
    faces.push([baseCenter, j + 1, j + 2]);
  }
  return { vertices, faces };
}
function torus(major, minor, radialSeg = 24, tubularSeg = 12) {
  const vertices = [];
  const faces = [];
  for (let i = 0; i <= radialSeg; i++) {
    const u = i / radialSeg * Math.PI * 2;
    for (let j = 0; j <= tubularSeg; j++) {
      const vv = j / tubularSeg * Math.PI * 2;
      const x = (major + minor * Math.cos(vv)) * Math.cos(u);
      const y = minor * Math.sin(vv);
      const z = (major + minor * Math.cos(vv)) * Math.sin(u);
      vertices.push({ x, y, z });
    }
  }
  const rowLen = tubularSeg + 1;
  for (let i = 0; i < radialSeg; i++) {
    for (let j = 0; j < tubularSeg; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      faces.push([a, a + 1, b + 1, b]);
    }
  }
  return { vertices, faces };
}
function pyramid(baseHalf, height) {
  const hh = height / 2;
  const vertices = [
    v2(-baseHalf, -hh, -baseHalf),
    v2(baseHalf, -hh, -baseHalf),
    v2(baseHalf, -hh, baseHalf),
    v2(-baseHalf, -hh, baseHalf),
    v2(0, hh, 0)
    // ápice
  ];
  const faces = [
    [0, 4, 1],
    [1, 4, 2],
    [2, 4, 3],
    [3, 4, 0],
    [0, 1, 2, 3]
  ];
  return { vertices, faces };
}
function tetrahedron() {
  const vertices = [v2(1, 1, 1), v2(-1, -1, 1), v2(-1, 1, -1), v2(1, -1, -1)];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3]
  ];
  return { vertices, faces };
}
function buildPrimitiveFromParams(name, dims) {
  const p = normalizePrimitiveName(name);
  if (!p) return null;
  const d = dims && Object.keys(dims).length > 0 ? dims : null;
  if (!d) return null;
  const radio = d.radio;
  const altura = d.altura;
  const size = d.size;
  const porRadio = radio !== void 0 ? radio * 2 : void 0;
  const segmentos = d.segmentos;
  switch (p) {
    case "cube": {
      const w = d.ancho ?? porRadio ?? size;
      const h = d.alto ?? altura ?? w ?? porRadio ?? size;
      const dep = d.profundo ?? porRadio ?? size ?? w;
      if (w === void 0 && h === void 0 && dep === void 0) return null;
      const params = { kind: "cubo", ancho: w ?? 2, alto: h ?? 2, profundo: dep ?? 2, segX: 1, segY: 1, segZ: 1 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "sphere": {
      const r = radio ?? size;
      if (r === void 0) return null;
      const params = {
        kind: "esfera",
        radio: r,
        meridianos: segmentos ?? 24,
        anillos: Math.max(3, Math.round((segmentos ?? 24) * (2 / 3)))
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "cylinder": {
      if (radio === void 0 && size === void 0 && altura === void 0) return null;
      const params = { kind: "cilindro", radio: radio ?? size ?? 1, altura: altura ?? 2, segmentos: segmentos ?? 24, bandas: 4 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "cone": {
      if (radio === void 0 && size === void 0 && altura === void 0) return null;
      const params = { kind: "cono", radio: radio ?? size ?? 1, altura: altura ?? 2, segmentos: segmentos ?? 24, bandas: 4 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "torus": {
      const anillo = radio ?? size;
      if (anillo === void 0 && d.grosor === void 0) return null;
      const params = { kind: "toroide", radioAnillo: anillo ?? 1, radioTubo: d.grosor ?? 0.35, segAnillo: segmentos ?? 24, segTubo: 12 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "plane": {
      const w = d.ancho ?? porRadio ?? size;
      const dep = d.profundo ?? size ?? w;
      if (w === void 0 && dep === void 0) return null;
      const params = { kind: "plano", ancho: w ?? 2, profundo: dep ?? w ?? 2, segX: 1, segZ: 1 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "pyramid": {
      const lado = d.ancho ?? porRadio ?? size;
      const alt = altura ?? size;
      if (lado === void 0 && alt === void 0) return null;
      const params = { kind: "piramide", lado: lado ?? 2, altura: alt ?? 2 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "capsule": {
      if (radio === void 0 && size === void 0 && altura === void 0) return null;
      const params = {
        kind: "capsula",
        radio: radio ?? size ?? 1,
        altura: altura ?? 2,
        segmentos: segmentos ?? 24,
        bandasCuerpo: 4,
        bandasCasquete: 4
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "tube": {
      const ro = d.radioExterno ?? radio ?? size ?? 1;
      if (d.radioExterno === void 0 && radio === void 0 && size === void 0 && d.radioInterno === void 0 && d.grosor === void 0) return null;
      const params = {
        kind: "tubo",
        radioExterno: ro,
        radioInterno: d.radioInterno ?? (d.grosor !== void 0 ? ro - d.grosor : void 0) ?? ro * 0.5,
        altura: altura ?? 2,
        segRotacion: segmentos ?? 24,
        segAltura: 4,
        segTapa: 1
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "disc": {
      if (radio === void 0 && size === void 0 && d.radioInterno === void 0) return null;
      const params = { kind: "disco", radio: radio ?? size ?? 1, radioInterior: d.radioInterno ?? 0, sectores: d.sectores ?? segmentos ?? 33 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "ring": {
      if (radio === void 0 && size === void 0 && d.radioInterno === void 0) return null;
      const r = radio ?? size ?? 1;
      const params = { kind: "disco", radio: r, radioInterior: d.radioInterno ?? r * 0.8, sectores: d.sectores ?? segmentos ?? 33 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case "spring": {
      if (radio === void 0 && size === void 0 && d.grosor === void 0 && d.vueltas === void 0) return null;
      const params = {
        kind: "muelle",
        vueltas: d.vueltas ?? 6,
        verticesPorVuelta: segmentos ?? 16,
        separacion: d.separacion ?? 0.4,
        radioMuelle: radio ?? size ?? 0.5,
        radioTubo: d.grosor ?? 0.12
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    default:
      return null;
  }
}
function legacyPrimitiveParams(name) {
  switch (normalizePrimitiveName(name)) {
    case "cube":
      return { kind: "cubo", ancho: 2, alto: 2, profundo: 2, segX: 1, segY: 1, segZ: 1 };
    case "sphere":
      return { kind: "esfera", radio: 1, meridianos: 24, anillos: 16 };
    case "cylinder":
      return { kind: "cilindro", radio: 1, altura: 2, segmentos: 24, bandas: 1 };
    case "cone":
      return { kind: "cono", radio: 1, altura: 2, segmentos: 24, bandas: 1 };
    case "torus":
      return { kind: "toroide", radioAnillo: 1, radioTubo: 0.35, segAnillo: 24, segTubo: 12 };
    case "plane":
      return { kind: "plano", ancho: 2, profundo: 2, segX: 1, segZ: 1 };
    case "pyramid":
      return { kind: "piramide", lado: 2, altura: 2 };
    case "ring":
      return { kind: "disco", radio: 1, radioInterior: 0.8, sectores: 33 };
    default:
      return null;
  }
}
function buildPrimitiveMesh(name) {
  const p = normalizePrimitiveName(name);
  switch (p) {
    case "cube":
      return cube(1);
    case "plane":
      return plane(1);
    case "sphere":
      return sphere(1);
    case "cylinder":
      return cylinder(1, 2);
    case "cone":
      return cone(1, 2);
    case "torus":
      return torus(1, 0.35);
    case "pyramid":
      return pyramid(1, 2);
    case "tetrahedron":
      return tetrahedron();
    case "ring":
      return construirMallaPrimitiva({ kind: "disco", radio: 1, radioInterior: 0.8, sectores: 33 });
    default:
      return null;
  }
}
function fallbackMesh() {
  return cube(1);
}

// lib/zeia-scene.ts
var RAD = Math.PI / 180;
function num2(x, fallback) {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
function pickId(...vals) {
  for (const v3 of vals) if (typeof v3 === "string" && v3.trim()) return v3.trim();
  return void 0;
}
function triple(t, fallback) {
  if (Array.isArray(t)) {
    return [num2(t[0], fallback[0]), num2(t[1], fallback[1]), num2(t[2], fallback[2])];
  }
  if (t && typeof t === "object") {
    const o = t;
    return [num2(o.x ?? o[0], fallback[0]), num2(o.y ?? o[1], fallback[1]), num2(o.z ?? o[2], fallback[2])];
  }
  return fallback;
}
var DIM_ALIASES = {
  radius: "radio",
  radio: "radio",
  r: "radio",
  diameter: "diametro",
  diametro: "diametro",
  height: "altura",
  altura: "altura",
  h: "altura",
  length: "altura",
  largo: "altura",
  width: "ancho",
  ancho: "ancho",
  w: "ancho",
  depth: "profundo",
  profundidad: "profundo",
  prof: "profundo",
  d: "profundo",
  profundo: "profundo",
  alto: "alto",
  innerRadius: "radioInterno",
  radioInterno: "radioInterno",
  inner: "radioInterno",
  outerRadius: "radioExterno",
  radioExterno: "radioExterno",
  outer: "radioExterno",
  thickness: "grosor",
  grosor: "grosor",
  espesor: "grosor",
  size: "size",
  tamano: "size",
  tama\u00F1o: "size",
  escala: "size",
  segments: "segmentos",
  segmentos: "segmentos",
  sides: "segmentos",
  lados: "segmentos",
  sectors: "sectores",
  sectores: "sectores",
  turns: "vueltas",
  vueltas: "vueltas",
  loops: "vueltas",
  pitch: "separacion",
  separacion: "separacion",
  separaci\u00F3n: "separacion"
};
function extractDims(src) {
  const out = {};
  for (const [key, raw] of Object.entries(src)) {
    const canon = DIM_ALIASES[key];
    if (!canon || canon === "diametro") continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    if (out[canon] === void 0) out[canon] = raw;
  }
  const diam = src.diameter ?? src.diametro;
  if (out.radio === void 0 && typeof diam === "number" && Number.isFinite(diam) && diam >= 0) {
    out.radio = diam / 2;
  }
  return out;
}
function transformFromParams(params) {
  const t = params.transform && typeof params.transform === "object" ? params.transform : {};
  const [px, py, pz] = triple(t.position, [0, 0, 0]);
  const [rxd, ryd, rzd] = triple(t.rotation, [0, 0, 0]);
  const [sx, sy, sz] = triple(t.scale, [1, 1, 1]);
  return {
    px,
    py,
    pz,
    rx: rxd * RAD,
    ry: ryd * RAD,
    rz: rzd * RAD,
    sx: sx || 1,
    sy: sy || 1,
    sz: sz || 1
  };
}
function resolvePrimitiveName(params) {
  return normalizePrimitiveName(params.primitive) ?? normalizePrimitiveName(primitiveFromGeometry(params.geometry)) ?? null;
}
function objectName(params) {
  const n = params.name;
  if (typeof n === "string" && n.trim()) return n.trim();
  const prim = resolvePrimitiveName(params);
  if (prim) return prim.charAt(0).toUpperCase() + prim.slice(1);
  const type = typeof params.type === "string" ? params.type : "mesh";
  if (type === "light") return "Luz";
  if (type === "camera") return "C\xE1mara";
  return "Objeto";
}
function buildObject(id, params) {
  const prim = resolvePrimitiveName(params);
  const primName = prim?.toString() ?? params.primitive ?? primitiveFromGeometry(params.geometry) ?? null;
  const dims = extractDims(params);
  const fromParams = primName !== null ? buildPrimitiveFromParams(primName, dims) : null;
  const primitiveMesh = fromParams?.mesh ?? buildPrimitiveMesh(primName) ?? fallbackMesh();
  const meshExplicit = params.mesh && typeof params.mesh === "object" && !Array.isArray(params.mesh) ? params.mesh : null;
  const mesh = meshExplicit ?? primitiveMesh;
  const meshFinal = params.type === "light" || params.type === "camera" ? buildPrimitiveMesh("sphere") ?? mesh : mesh;
  const smooth = primitiveIsSmooth(prim);
  const primitiveParams = meshExplicit ? void 0 : fromParams?.params ?? (primName !== null ? legacyPrimitiveParams(primName) : void 0) ?? void 0;
  const obj = {
    id,
    name: objectName(params),
    transform: transformFromParams(params),
    mesh: meshFinal,
    smooth,
    ...primitiveParams ? { primitiveParams } : {},
    // Propiedades de textura/acabado/opacity pasadas desde execute.
    ...extractTextureProps(params)
  };
  return obj;
}
function extractTextureProps(params) {
  const out = {};
  const keys = ["texture", "textureColor", "textureRelief", "bumpTexture", "bumpTextureRepeat", "bumpTextureRepeatY", "textureRepeat", "textureRepeatY", "textureFinish", "texturePanela", "textureHelper", "textureHelperTransform", "opacity"];
  for (const key of keys) {
    if (key in params && params[key] !== void 0) out[key] = params[key];
  }
  return out;
}
function applyTransformPatch(base, patch) {
  const out = { ...base };
  const t = patch.transform && typeof patch.transform === "object" ? patch.transform : null;
  const source = t ?? patch;
  if ("position" in source) {
    const [x, y, z] = triple(source.position, [out.px, out.py, out.pz]);
    out.px = x;
    out.py = y;
    out.pz = z;
  }
  if ("rotation" in source) {
    const [x, y, z] = triple(source.rotation, [out.rx / RAD, out.ry / RAD, out.rz / RAD]);
    out.rx = x * RAD;
    out.ry = y * RAD;
    out.rz = z * RAD;
  }
  if ("scale" in source) {
    const [x, y, z] = triple(source.scale, [out.sx, out.sy, out.sz]);
    out.sx = x;
    out.sy = y;
    out.sz = z;
  }
  const flat = ["px", "py", "pz", "rx", "ry", "rz", "sx", "sy", "sz"];
  for (const k of flat) {
    if (typeof source[k] === "number" && Number.isFinite(source[k])) {
      out[k] = source[k];
    }
  }
  return out;
}
function valuesOf(t) {
  return { px: t.px, py: t.py, pz: t.pz, rx: t.rx, ry: t.ry, rz: t.rz, sx: t.sx, sy: t.sy, sz: t.sz };
}
function keyframeTransform(base, kf, fallbackTime) {
  if (!kf || typeof kf !== "object") return null;
  const k = kf;
  const time = Math.max(0, num2(k.time ?? k.t, fallbackTime));
  let out = { ...base };
  if ("position" in k) {
    const [x, y, z] = triple(k.position, [out.px, out.py, out.pz]);
    out = { ...out, px: x, py: y, pz: z };
  }
  if ("rotation" in k) {
    if (typeof k.rotation === "number") {
      out = { ...out, ry: k.rotation * RAD };
    } else {
      const [rx, ry, rz] = triple(k.rotation, [out.rx / RAD, out.ry / RAD, out.rz / RAD]);
      out = { ...out, rx: rx * RAD, ry: ry * RAD, rz: rz * RAD };
    }
  }
  if ("scale" in k) {
    const raw = typeof k.scale === "number" ? [k.scale, k.scale, k.scale] : k.scale;
    const [sx, sy, sz] = triple(raw, [out.sx, out.sy, out.sz]);
    out = { ...out, sx, sy, sz };
  }
  return { time, values: valuesOf(out) };
}
function buildMotionTrack(target, params, makeId) {
  const type = String(params.type || "rotate").toLowerCase();
  const duration = Math.max(0.1, num2(params.duration, 5));
  const loop = params.loop === true;
  const degrees = num2(params.degrees, 360);
  const base = { ...target.transform };
  let end = { ...base };
  let keyframeTimes = null;
  const kfRaw = params.keyframes;
  if (Array.isArray(kfRaw) && kfRaw.length >= 2) {
    const paso = duration / (kfRaw.length - 1);
    const parsed = kfRaw.map((kf, i) => keyframeTransform(base, kf, i * paso)).filter((k) => k !== null).sort((a, b) => a.time - b.time);
    if (parsed.length >= 2) {
      parsed[parsed.length - 1] = { ...parsed[parsed.length - 1], time: duration };
      return {
        id: makeId("ttrack"),
        objectId: target.id,
        name: `Animaci\xF3n ZEIA (keyframes)`,
        duration,
        looping: loop,
        keyframes: parsed.map((k) => ({ ...k, easing: "ease-in-out" }))
      };
    }
  }
  switch (type) {
    case "rotate":
    case "spin": {
      const axis = String(params.axis || "y").toLowerCase();
      end = { ...base };
      if (axis === "x") end.rx = base.rx + degrees * RAD;
      else if (axis === "z") end.rz = base.rz + degrees * RAD;
      else end.ry = base.ry + degrees * RAD;
      break;
    }
    case "orbit": {
      const axis = String(params.axis || "y").toLowerCase();
      const angle = params.angle !== void 0 ? num2(params.angle, num2(params.degrees, 360)) : degrees;
      end = { ...base };
      if (axis === "x") end.rx = base.rx + angle * RAD;
      else if (axis === "z") end.rz = base.rz + angle * RAD;
      else end.ry = base.ry + angle * RAD;
      break;
    }
    case "translate":
    case "move": {
      const to = params.to ?? params.position;
      if (to !== void 0) {
        const [px, py, pz] = triple(to, [base.px, base.py, base.pz]);
        end = { ...base, px, py, pz };
      } else {
        const axis = String(params.axis || "x").toLowerCase();
        const dist = num2(params.distance ?? params.amount ?? params.degrees, 1);
        end = { ...base };
        if (axis === "y") end.py = base.py + dist;
        else if (axis === "z") end.pz = base.pz + dist;
        else end.px = base.px + dist;
      }
      break;
    }
    case "bounce": {
      const height = num2(params.height ?? params.distance ?? params.amount, 1);
      const up = { ...base, py: base.py + height };
      keyframeTimes = [
        { time: 0, values: valuesOf(base) },
        { time: duration / 2, values: valuesOf(up) },
        { time: duration, values: valuesOf(base) }
      ];
      break;
    }
    case "pulse": {
      const minS = params.min_scale ?? params.minScale;
      if (minS) {
        const [sx, sy, sz] = triple(minS, [base.sx, base.sy, base.sz]);
        base.sx = sx;
        base.sy = sy;
        base.sz = sz;
      }
      const maxRaw = params.max_scale ?? params.maxScale ?? params.scale;
      const [mx, my, mz] = maxRaw !== void 0 ? triple(typeof maxRaw === "number" ? [maxRaw, maxRaw, maxRaw] : maxRaw, [base.sx * 2, base.sy * 2, base.sz * 2]) : [base.sx * 2, base.sy * 2, base.sz * 2];
      const peak = { ...base, sx: mx, sy: my, sz: mz };
      keyframeTimes = [
        { time: 0, values: valuesOf(base) },
        { time: duration / 2, values: valuesOf(peak) },
        { time: duration, values: valuesOf(base) }
      ];
      break;
    }
    case "scale": {
      const minS = params.min_scale ?? params.minScale;
      const maxS = params.max_scale ?? params.maxScale ?? params.scale;
      if (minS) {
        const [sx, sy, sz] = triple(minS, [base.sx, base.sy, base.sz]);
        base.sx = sx;
        base.sy = sy;
        base.sz = sz;
      }
      if (maxS) {
        const [sx, sy, sz] = triple(maxS, [base.sx * 2, base.sy * 2, base.sz * 2]);
        end = { ...base, sx, sy, sz };
      } else {
        end = { ...base, sx: base.sx * 2, sy: base.sy * 2, sz: base.sz * 2 };
      }
      break;
    }
    default:
      return null;
  }
  if (keyframeTimes) {
    return {
      id: makeId("ttrack"),
      objectId: target.id,
      name: `Animaci\xF3n ZEIA (${type})`,
      duration,
      looping: loop,
      keyframes: keyframeTimes.map((k) => ({ ...k, easing: "ease-in-out" }))
    };
  }
  return {
    id: makeId("ttrack"),
    objectId: target.id,
    name: `Animaci\xF3n ZEIA (${type})`,
    duration,
    looping: loop,
    keyframes: [
      { time: 0, values: valuesOf(base), easing: "linear" },
      { time: duration, values: valuesOf(end), easing: "ease-in-out" }
    ]
  };
}
function primitiveFromGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return void 0;
  const g = geometry;
  const geoType = typeof g.type === "string" ? g.type.toLowerCase() : "";
  if (geoType === "compound" && Array.isArray(g.shapes)) {
    const first = g.shapes[0];
    if (first && typeof first === "object" && typeof first.type === "string") {
      return first.type;
    }
  }
  if (geoType) return geoType;
  return void 0;
}
function shapeAlias(prim) {
  if (!prim) return null;
  const n = prim.toLowerCase();
  if (n === "vase" || n === "jar" || n === "bottle" || n === "column" || n === "tower") return "cylinder";
  if (n === "bell" || n === "teardrop" || n === "drop") return "cone";
  if (n === "pyramid" || n === "tetrahedron") return "pyramid";
  if (n === "torus" || n === "donut") return "torus";
  if (n === "plate" || n === "plato" || n === "bandeja" || n === "tray") return "disc";
  if (n === "pipe" || n === "tuberia" || n === "tuber\xEDa" || n === "ca\xF1eria" || n === "tubo") return "tube";
  if (n === "coil" || n === "resorte" || n === "resolte") return "spring";
  return null;
}
function normalizeCreateParams(execute) {
  const exeType = typeof execute.type === "string" ? execute.type : "";
  const isKnownObjectType = exeType === "mesh" || exeType === "light" || exeType === "camera";
  const typeAsPrimitive = !isKnownObjectType && exeType ? exeType : null;
  const params = {
    type: isKnownObjectType ? exeType : "mesh"
  };
  const primitive = execute.primitive ?? primitiveFromGeometry(execute.geometry) ?? typeAsPrimitive ?? (typeof execute.shape === "string" ? execute.shape : null);
  const normalized = normalizePrimitiveName(primitive);
  const resolved = normalized ?? shapeAlias(primitive);
  if (resolved) params.primitive = resolved;
  if (execute.name) {
    params.name = execute.name;
  } else if (typeAsPrimitive) {
    params.name = capitalize(typeAsPrimitive);
  } else if (typeof execute.shape === "string") {
    params.name = capitalize(execute.shape);
  } else if (execute.geometry && typeof execute.geometry === "object") {
    const mesh = execute.geometry.mesh;
    if (typeof mesh === "string" && mesh.trim()) params.name = mesh.trim();
  }
  if (typeof execute.id === "string") params.id = execute.id;
  if (typeof execute.objectId === "string") params.id = execute.objectId;
  const transform = {};
  if (execute.position) transform.position = execute.position;
  if (execute.rotation) transform.rotation = execute.rotation;
  if (execute.scale) transform.scale = execute.scale;
  if (execute.transform && typeof execute.transform === "object") {
    Object.assign(transform, execute.transform);
  }
  if (execute.geometry && typeof execute.geometry === "object") {
    const g = execute.geometry;
    if (g.type === "compound" && Array.isArray(g.shapes) && g.shapes.length > 0) {
      const shapes = g.shapes.filter(
        (s) => Boolean(s) && typeof s === "object" && !Array.isArray(s)
      );
      if (shapes.length > 0) params.parts = shapes;
    }
  }
  if (Object.keys(transform).length) params.transform = transform;
  if (execute.material) params.material = execute.material;
  if (execute.color) params.material = { ...typeof execute.material === "object" ? execute.material : {}, color: execute.color };
  const explicitMesh = extractExplicitMesh(execute);
  if (explicitMesh) params.mesh = explicitMesh;
  for (const key of ["texture", "textureColor", "textureRelief", "textureRepeat", "textureRepeatY", "textureFinish", "texturePanela", "textureHelper", "textureHelperTransform", "opacity"]) {
    if (key in execute && execute[key] !== void 0) params[key] = execute[key];
  }
  Object.assign(params, extractDims(execute));
  return params;
}
function extractExplicitMesh(execute) {
  if (execute.mesh && typeof execute.mesh === "object" && !Array.isArray(execute.mesh)) {
    const m = execute.mesh;
    if (Array.isArray(m.vertices) && Array.isArray(m.faces)) return m;
  }
  if (execute.geometry && typeof execute.geometry === "object") {
    const g = execute.geometry;
    if (g.mesh && typeof g.mesh === "object" && !Array.isArray(g.mesh)) {
      const m = g.mesh;
      if (Array.isArray(m.vertices) && Array.isArray(m.faces)) return m;
    }
    if (Array.isArray(g.vertices) && Array.isArray(g.faces)) {
      return { vertices: g.vertices, faces: g.faces };
    }
  }
  return null;
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function normalizeAnimateParams(execute) {
  const params = {};
  const oid = typeof execute.objectId === "string" ? execute.objectId : execute.id;
  if (oid) params.object_id = oid;
  const anim = execute.animation && typeof execute.animation === "object" ? execute.animation : execute;
  if (anim.type) params.type = anim.type;
  if ("angle" in anim) params.degrees = anim.angle;
  else if ("degrees" in anim) params.degrees = anim.degrees;
  if (anim.duration) params.duration = anim.duration;
  if (anim.loop !== void 0) params.loop = anim.loop;
  if (anim.axis) params.axis = anim.axis;
  if (anim.easing) params.easing = anim.easing;
  if ("scale" in anim) params.scale = anim.scale;
  if (anim.scale) params.scale = anim.scale;
  if (anim.min_scale) params.min_scale = anim.min_scale;
  if (anim.max_scale) params.max_scale = anim.max_scale;
  if (anim.minScale) params.min_scale = anim.minScale;
  if (anim.maxScale) params.max_scale = anim.maxScale;
  if (Array.isArray(anim.keyframes)) params.keyframes = anim.keyframes;
  if (anim.to !== void 0) params.to = anim.to;
  if (anim.position !== void 0 && !anim.objectId) params.to = anim.position;
  if (anim.distance !== void 0) params.distance = anim.distance;
  if (anim.amount !== void 0) params.amount = anim.amount;
  if (anim.height !== void 0) params.height = anim.height;
  return params;
}
var EFFECT_PARAM_KEYS = [
  "enabled",
  "count",
  "speed",
  "size",
  "intensity",
  "color",
  "riseSpeed",
  "starSize",
  "glowColor",
  "glowIntensity",
  "glowObjects"
];
function normalizeEffectType(raw) {
  const n = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!n) return null;
  if (n === "rain" || n === "lluvia" || n === "rainfall") return "rain";
  if (n === "smoke" || n === "humo" || n === "fog" || n === "niebla") return "smoke";
  if (n === "stars" || n === "star" || n === "estrellas" || n === "estrella") return "stars";
  if (n === "fire" || n === "fuego" || n === "flames" || n === "llamas") return "fire";
  if (n === "sparks" || n === "spark" || n === "chispas" || n === "chispa") return "sparks";
  if (n === "glow" || n === "brillo" || n === "bloom") return "glow";
  return null;
}
function buildEffectTrack(params, makeId) {
  const effectType = normalizeEffectType(params.name ?? params.type);
  if (!effectType) return null;
  const duration = Math.max(0.5, num2(params.duration, 5));
  const looping = params.loop === true || params.looping === true;
  const raw = params.params && typeof params.params === "object" ? params.params : params;
  const values = { enabled: true };
  const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  for (const key of EFFECT_PARAM_KEYS) {
    const candidates = [key, camel(key), key.toLowerCase()];
    for (const c of candidates) {
      const v3 = raw[c];
      if (v3 === void 0 || v3 === null) continue;
      if (key === "enabled" || key === "glowObjects") values[key] = v3 !== false;
      else if (key === "color" || key === "glowColor") {
        if (typeof v3 === "string") values[key] = v3;
      } else {
        const n = num2(v3, NaN);
        if (Number.isFinite(n)) values[key] = n;
      }
      break;
    }
  }
  return {
    id: makeId("etrack"),
    effectType,
    duration,
    looping,
    keyframes: [{ time: 0, values, easing: "linear" }]
  };
}
function normalizeEffectParams(execute) {
  const params = {};
  if (execute.objectId) params.object_id = execute.objectId;
  const effect = execute.effect && typeof execute.effect === "object" ? execute.effect : execute;
  if (effect.name) params.name = effect.name;
  else if (effect.type) params.name = String(effect.type);
  else if (effect.effectType) params.name = String(effect.effectType);
  if (effect.duration !== void 0) params.duration = effect.duration;
  else if (execute.duration !== void 0) params.duration = execute.duration;
  if (effect.loop !== void 0) params.loop = effect.loop;
  else if (execute.loop !== void 0) params.loop = execute.loop;
  else if (effect.looping !== void 0) params.loop = effect.looping;
  else if (execute.looping !== void 0) params.looping = execute.looping;
  const nested = effect.params && typeof effect.params === "object" ? effect.params : {};
  const effectParams = {};
  for (const key of EFFECT_PARAM_KEYS) {
    if (nested[key] !== void 0 && nested[key] !== null) effectParams[key] = nested[key];
    else if (effect[key] !== void 0 && effect[key] !== null) effectParams[key] = effect[key];
    else if (execute[key] !== void 0 && execute[key] !== null && effect !== execute) {
      effectParams[key] = execute[key];
    }
  }
  if (Object.keys(effectParams).length) params.params = effectParams;
  return params;
}
function normalizeObjectRefParams(execute) {
  const params = {};
  const oid = typeof execute.objectId === "string" ? execute.objectId : execute.id;
  if (oid) params.id = oid;
  return params;
}
function normalizeZeiaPlan(plan) {
  if (Array.isArray(plan.steps) && plan.steps.length > 0) return plan;
  const raw = plan;
  if (typeof raw.plan === "string" && raw.execute && typeof raw.execute === "object") {
    const exe = raw.execute;
    const steps = planStepsFromIntent(raw.plan, exe);
    if (steps.length > 0) return { ...plan, steps, results: [] };
  }
  return { ...plan, steps: [], results: [] };
}
function planStepsFromIntent(planType, execute) {
  const t = planType.toLowerCase();
  const steps = [];
  const isCreateLike = t.startsWith("create") || t.startsWith("add") && (execute.geometry || execute.material) || !t.startsWith("animate") && execute.geometry && !execute.effect;
  const effectTypeName = normalizeEffectType(execute.effectType) ?? normalizeEffectType(execute.type) ?? (t.includes("effect") ? normalizeEffectType(execute.name) : null);
  const isEffectLike = !execute.geometry && !execute.primitive && (Boolean(execute.effect) || effectTypeName !== null);
  if (t.startsWith("update") || t.startsWith("modify") || t.startsWith("move") || t.startsWith("transform")) {
    const params = normalizeObjectRefParams(execute);
    if (execute.patch) params.patch = execute.patch;
    if (execute.transform) {
      params.patch = { ...params.patch || {}, transform: execute.transform };
    }
    steps.push({ action: "objects.update", params });
  } else if (t.startsWith("delete") || t.startsWith("remove") || t.startsWith("destroy")) {
    steps.push({ action: "objects.delete", params: normalizeObjectRefParams(execute) });
  } else if (t.startsWith("duplicate") || t.startsWith("clone") || t.startsWith("copy")) {
    steps.push({ action: "objects.duplicate", params: normalizeObjectRefParams(execute) });
  } else if (isEffectLike) {
    steps.push({ action: "effects.apply", params: normalizeEffectParams(execute) });
  } else if (isCreateLike) {
    steps.push({ action: "objects.create", params: normalizeCreateParams(execute) });
  } else if ((t.includes("effect") || t.includes("fx")) && (execute.effect || execute.type || execute.name)) {
    steps.push({ action: "effects.apply", params: normalizeEffectParams(execute) });
  }
  if (execute.animation && typeof execute.animation === "object") {
    steps.push({ action: "motions.create", params: normalizeAnimateParams(execute) });
  }
  return steps;
}
function applyZeiaPlansToScene(plans, objects, transformTracks, opts = {}) {
  const makeId = opts.makeId ?? ((prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`);
  const idMap = { ...opts.idMap ?? {} };
  let objs = objects.slice();
  let tracks = transformTracks.slice();
  const warnings = [];
  const warned = /* @__PURE__ */ new Set();
  const warnOnce = (msg) => {
    if (!warned.has(msg)) {
      warned.add(msg);
      warnings.push(msg);
    }
  };
  let applied = 0;
  let created = 0;
  let updated = 0;
  let removed = 0;
  let motions = 0;
  let effects = 0;
  let lastCreatedId = opts.lastCreatedId ?? null;
  let effectTracks = (opts.effectTracks ?? []).slice();
  const byId = (id) => id ? objs.find((o) => o.id === id) : void 0;
  const byName = (name) => {
    if (!name) return void 0;
    const lower = name.trim().toLowerCase();
    if (!lower) return void 0;
    return objs.find((o) => o.name.toLowerCase() === lower);
  };
  const resolve = (raw) => {
    if (!raw) return void 0;
    const mapped = idMap[raw];
    if (mapped) {
      const o = byId(mapped);
      if (o) return o;
    }
    return byId(raw) ?? byName(raw);
  };
  for (const plan of plans) {
    const n = normalizeZeiaPlan(plan);
    const wasNormalized = !Array.isArray(plan.steps);
    const steps = Array.isArray(n.steps) ? n.steps : [];
    const results = Array.isArray(n.results) ? n.results : [];
    if (wasNormalized && steps.length === 0) {
      warnOnce("Plan ZEIA sin `steps` ni `{plan, execute}` reconocible: se omiti\xF3.");
    }
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const res = results[i] || {};
      const params = step.params || {};
      const action = String(step.action || "");
      switch (action) {
        case "objects.create": {
          let pCreate = params;
          if (!Array.isArray(params.parts) && params.geometry && typeof params.geometry === "object" && !Array.isArray(params.geometry) && typeof params.geometry.type === "string" && params.geometry.type.toLowerCase() === "compound") {
            pCreate = normalizeCreateParams(params);
          }
          const parts = Array.isArray(pCreate.parts) ? pCreate.parts.filter(
            (s) => Boolean(s) && typeof s === "object" && !Array.isArray(s)
          ) : null;
          if (parts && parts.length > 0) {
            const base = transformFromParams(pCreate);
            const baseName = typeof pCreate.name === "string" && pCreate.name.trim() ? pCreate.name.trim() : null;
            const dimsBase = extractDims(pCreate);
            let firstId = null;
            for (let i2 = 0; i2 < parts.length; i2++) {
              const nP = normalizeCreateParams(parts[i2]);
              const t = transformFromParams(nP);
              const comp = {
                px: base.px + t.px * base.sx,
                py: base.py + t.py * base.sy,
                pz: base.pz + t.pz * base.sz,
                rx: base.rx + t.rx,
                ry: base.ry + t.ry,
                rz: base.rz + t.rz,
                sx: base.sx * t.sx,
                sy: base.sy * t.sy,
                sz: base.sz * t.sz
              };
              const dims = { ...dimsBase, ...extractDims(parts[i2]) };
              const nombre = baseName !== null ? parts.length > 1 ? `${baseName} ${i2 + 1}` : baseName : typeof nP.name === "string" && nP.name.trim() ? nP.name : "Objeto";
              const editorId2 = makeId("obj");
              const creado = buildObject(editorId2, { ...nP, ...dims, name: nombre });
              objs = [...objs, { ...creado, transform: comp }];
              if (firstId === null) firstId = editorId2;
              created++;
              applied++;
            }
            lastCreatedId = firstId;
            if (firstId) {
              if (typeof res.object_id === "string") idMap[res.object_id] = firstId;
              if (typeof params.id === "string") idMap[params.id] = firstId;
              if (baseName) idMap[baseName] = firstId;
            }
            if (pCreate.type === "light") warnOnce("ZEIA cre\xF3 una luz; el editor la representa como una malla (sin iluminaci\xF3n real).");
            if (pCreate.type === "camera") warnOnce("ZEIA cre\xF3 una c\xE1mara; el editor la representa como una malla.");
            break;
          }
          const editorId = makeId("obj");
          objs = [...objs, buildObject(editorId, params)];
          lastCreatedId = editorId;
          created++;
          applied++;
          if (typeof res.object_id === "string") idMap[res.object_id] = editorId;
          if (typeof params.id === "string") idMap[params.id] = editorId;
          if (typeof params.name === "string" && params.name.trim()) idMap[params.name.trim()] = editorId;
          if (params.type === "light") warnOnce("ZEIA cre\xF3 una luz; el editor la representa como una malla (sin iluminaci\xF3n real).");
          if (params.type === "camera") warnOnce("ZEIA cre\xF3 una c\xE1mara; el editor la representa como una malla.");
          break;
        }
        case "objects.duplicate": {
          const src = resolve(pickId(params.id, params.object_id, res.object_id));
          if (!src) {
            warnOnce("objects.duplicate: no se encontr\xF3 el objeto de origen.");
            break;
          }
          const editorId = makeId("obj");
          const clone = { ...src, id: editorId, name: `${src.name} (copia)`, transform: { ...src.transform } };
          objs = [...objs, clone];
          lastCreatedId = editorId;
          created++;
          applied++;
          if (typeof res.object_id === "string") idMap[res.object_id] = editorId;
          break;
        }
        case "objects.update":
        case "objects.batch": {
          const target = resolve(pickId(params.id, params.object_id, res.object_id)) ?? (lastCreatedId ? byId(lastCreatedId) : void 0);
          if (!target) {
            warnOnce(`${action}: no se encontr\xF3 el objeto a actualizar.`);
            break;
          }
          const patch = params.patch && typeof params.patch === "object" ? params.patch : params;
          const newTransform = applyTransformPatch(target.transform, patch);
          const newName = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : target.name;
          objs = objs.map((o) => o.id === target.id ? { ...o, transform: newTransform, name: newName } : o);
          updated++;
          applied++;
          break;
        }
        case "objects.delete": {
          const target = resolve(pickId(params.id, params.object_id, res.object_id));
          if (!target) {
            warnOnce("objects.delete: no se encontr\xF3 el objeto a eliminar.");
            break;
          }
          objs = objs.filter((o) => o.id !== target.id);
          tracks = tracks.filter((t) => t.objectId !== target.id);
          removed++;
          applied++;
          break;
        }
        case "objects.parent": {
          applied++;
          break;
        }
        case "motions.create":
        case "motions.update": {
          const target = resolve(pickId(res.object_id, params.object_id)) ?? (lastCreatedId ? byId(lastCreatedId) : void 0);
          if (!target) {
            warnOnce(`${action}: no hay objeto destino para la animaci\xF3n.`);
            break;
          }
          const track = buildMotionTrack(target, params, makeId);
          if (!track) {
            warnOnce(`${action}: tipo de motion no soportado ("${String(params.type)}").`);
            break;
          }
          tracks = [...tracks, track];
          motions++;
          applied++;
          break;
        }
        case "effects.apply": {
          const track = buildEffectTrack(normalizeEffectParams(params), makeId);
          if (!track) {
            warnOnce(`${action}: tipo de efecto no soportado ("${String(params.name ?? params.type)}").`);
            break;
          }
          const due\u00F1o = resolve(pickId(params.id, params.object_id, res.object_id));
          if (due\u00F1o) track.objectId = due\u00F1o.id;
          effectTracks = [...effectTracks, track];
          effects++;
          applied++;
          break;
        }
        default: {
          warnOnce(`${action}: se aplic\xF3 en ZEIA pero no tiene representaci\xF3n directa en la escena del editor.`);
          break;
        }
      }
    }
  }
  return {
    objects: objs,
    transformTracks: tracks,
    effectTracks,
    idMap,
    lastCreatedId,
    result: { applied, created, updated, removed, motions, effects, warnings }
  };
}
export {
  applyZeiaPlansToScene,
  extractDims,
  normalizeEffectType
};
