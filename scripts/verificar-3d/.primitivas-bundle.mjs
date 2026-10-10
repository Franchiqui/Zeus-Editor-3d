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
  const normales = transportadores(tangentes);
  const tilts = util.map((n) => (n.tilt ?? 0) * Math.PI / 180);
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
    const t1 = tangentes[i];
    const n1 = normales[i];
    const b1 = vcross(n1, t1);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const ids = [];
    for (let k = 0; k < ringCount; k++) {
      const lx = (prof[k].x - c.x) * UNIT * esc;
      const ly = (prof[k].y - c.y) * UNIT * esc;
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
function paramsDeArchivo(fileName) {
  const base = fileName.toLowerCase().replace(/\.zeus$/i, "");
  const p = PARAMETROS_POR_ARCHIVO[base];
  return p ? structuredClone(p) : null;
}
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
export {
  construirMallaPrimitiva,
  normalizarParams,
  paramsDeArchivo
};
