// lib/geometry.ts
function holePolygon(h) {
  return Array.isArray(h) ? h : h.polygon;
}
function holeDepth(h) {
  return Array.isArray(h) ? 0 : h.depth ?? 0;
}
var contadorGruposTextura = 0;
function nuevoGrupoTextura() {
  contadorGruposTextura += 1;
  return `tg${contadorGruposTextura.toString(36)}${Date.now().toString(36)}`;
}
function estamparGrupoTextura(grupos, caras, id) {
  const resultado = [...grupos];
  for (const cara of caras) {
    if (cara < 0 || cara >= resultado.length) continue;
    resultado[cara] = id;
  }
  return resultado;
}
var GRID_SIZE = 16;
var VOXEL_COUNT = 16;
var HIGH_FIDELITY_RES = 96;
var DEFAULT_HANDLE_LEN = 0.35;
function roundedPolygonPath(poly, closed) {
  const n = poly.length;
  if (n === 0) return "";
  const f = (v) => (Math.round(v * 1e3) / 10).toString();
  const pt = (p) => `${f(p.x)} ${f(p.y)}`;
  if (!closed || n < 3) {
    return poly.map((p, i) => `${i === 0 ? "M" : "L"} ${pt(p)}`).join(" ") + (closed ? " Z" : "");
  }
  let d = `M ${pt(poly[0])}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = poly[i];
    const q = poly[j];
    if (p.hOut || q.hIn) {
      d += ` C ${p.hOut ? pt(p.hOut) : pt(p)} ${q.hIn ? pt(q.hIn) : pt(q)} ${pt(q)}`;
    } else {
      d += ` L ${pt(q)}`;
    }
  }
  return d + " Z";
}
function closestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), point: a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: Math.hypot(p.x - point.x, p.y - point.y), point };
}
function closestEdgeHit(poly, pt, steps = 12) {
  const n = poly.length;
  if (n < 2) return null;
  const edgeCount = n >= 3 ? n : n - 1;
  let best = null;
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n;
    const a = poly[i];
    const b = poly[j];
    if (a.hOut || b.hIn) {
      const c1 = a.hOut ?? a;
      const c2 = b.hIn ?? b;
      let prev = a;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        const cur = {
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
        };
        const hit = closestOnSegment(pt, prev, cur);
        if (!best || hit.dist < best.dist) best = { edge: i, ...hit };
        prev = cur;
      }
    } else {
      const hit = closestOnSegment(pt, a, b);
      if (!best || hit.dist < best.dist) best = { edge: i, ...hit };
    }
  }
  return best;
}
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
function polygonArea(poly) {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return Math.abs(area / 2);
}
function isClockwise(poly) {
  if (poly.length < 3) return false;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    sum += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  }
  return sum > 0;
}
function pointInPolygon(p, poly) {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function normalizePolygon(poly) {
  if (poly.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  return poly.map((p) => {
    const out = {
      x: (p.x - minX) / w,
      y: (p.y - minY) / h
    };
    if (p.hIn) out.hIn = { x: (p.hIn.x - minX) / w, y: (p.hIn.y - minY) / h };
    if (p.hOut) out.hOut = { x: (p.hOut.x - minX) / w, y: (p.hOut.y - minY) / h };
    return out;
  });
}
function polygonYRange(poly) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  return [lo, hi];
}
function polygonSignedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
function interpolateSection(sections, y, targetN) {
  if (sections.length === 0) return [];
  const sorted = [...sections].sort((a2, b2) => a2.y - b2.y);
  const ys = sorted.map((s) => s.y);
  const lo = ys[0];
  const hi = ys[ys.length - 1];
  const yc = Math.max(lo, Math.min(hi, y));
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].y < yc) i++;
  const a = sorted[i];
  const b = sorted[Math.min(sorted.length - 1, i + 1)];
  const t = b.y - a.y > 1e-9 ? (yc - a.y) / (b.y - a.y) : 0;
  const canonical = (poly) => {
    const pts = poly.map((p) => ({ x: p.x, y: p.y }));
    return polygonSignedArea(pts) < 0 ? pts.reverse() : pts;
  };
  const pa = resampleClosed(canonical(a.polygon), targetN);
  const pb = resampleClosed(canonical(b.polygon), targetN);
  const out = [];
  for (let k = 0; k < targetN; k++) {
    out.push({
      x: pa[k].x + (pb[k].x - pa[k].x) * t,
      y: pa[k].y + (pb[k].y - pa[k].y) * t
    });
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
function scanlineIntervalsAtY(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y === b.y) continue;
    if (a.y > y !== b.y > y) {
      xs.push((b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
    }
  }
  if (xs.length < 2) return [];
  xs.sort((p, q) => p - q);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}
function rasterizePolygon(poly, resolution) {
  const grid = Array.from(
    { length: resolution },
    () => Array(resolution).fill(false)
  );
  if (poly.length < 3) return grid;
  for (let j = 0; j < resolution; j++) {
    const py = (j + 0.5) / resolution;
    for (const [xa, xb] of scanlineIntervalsAtY(poly, py)) {
      const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
      const i1 = Math.min(
        resolution - 1,
        Math.ceil(xb * resolution - 0.5) - 1
      );
      for (let i = i0; i <= i1; i++) grid[i][j] = true;
    }
  }
  return grid;
}
function reconstructVoxels(views, resolution, sections) {
  const curveSteps = Math.max(16, resolution);
  const frontPoly = flattenPolygon(normalizePolygon(views.front), curveSteps);
  const sidePoly = flattenPolygon(normalizePolygon(views.side), curveSteps);
  const topPolyFlat = flattenPolygon(normalizePolygon(views.top), curveSteps);
  const top = rasterizePolygon(topPolyFlat, resolution);
  const useSections = Array.isArray(sections) && sections.length >= 2;
  const sectionsSorted = useSections ? [...sections].sort((a, b) => a.y - b.y).map((s) => {
    let poly = s.polygon;
    if (poly.some((p) => p.hIn || p.hOut)) {
      poly = flattenPolygon(poly, curveSteps);
    }
    return { ...s, polygon: normalizePolygon(poly) };
  }) : [];
  const sectionsTargetN = useSections ? Math.max(...sectionsSorted.map((s) => s.polygon.length)) : 0;
  const sectionsYLo = useSections ? sectionsSorted[0].y : 0;
  const sectionsYHi = useSections ? sectionsSorted[sectionsSorted.length - 1].y : 1;
  const [fLo, fHi] = polygonYRange(frontPoly);
  const [sLo, sHi] = polygonYRange(sidePoly);
  const yLo = Math.min(fLo, sLo);
  const yHi = Math.max(fHi, sHi);
  const span = Math.max(1e-6, yHi - yLo);
  const voxels = Array.from(
    { length: resolution },
    () => Array.from({ length: resolution }, () => Array(resolution).fill(false))
  );
  const rowMask = (poly, yc) => {
    const m = Array(resolution).fill(false);
    for (const [xa, xb] of scanlineIntervalsAtY(poly, yc)) {
      const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
      const i1 = Math.min(
        resolution - 1,
        Math.ceil(xb * resolution - 0.5) - 1
      );
      for (let i = i0; i <= i1; i++) m[i] = true;
    }
    return m;
  };
  for (let y = 0; y < resolution; y++) {
    const yc = yHi - (y + 0.5) * span / resolution;
    const fy = Math.max(fLo, Math.min(fHi, yc));
    const sy = Math.max(sLo, Math.min(sHi, yc));
    const xr = scanlineIntervalsAtY(frontPoly, fy);
    const zr = scanlineIntervalsAtY(sidePoly, sy);
    if (xr.length === 0 || zr.length === 0) continue;
    if (xr.length === 1 && zr.length === 1) {
      const [x0, x1] = xr[0];
      const [z0, z1] = zr[0];
      const kx = x1 - x0;
      const kz = z1 - z0;
      if (kx < 1e-9 || kz < 1e-9) continue;
      let contour;
      if (useSections) {
        const yModel = 1 - yc;
        const yy = Math.max(
          sectionsYLo,
          Math.min(sectionsYHi, yModel)
        );
        contour = interpolateSection(
          sectionsSorted,
          yy,
          sectionsTargetN
        );
        contour = contour.map((q) => ({
          x: x0 + q.x * kx,
          y: z0 + q.y * kz
        }));
      } else {
        contour = topPolyFlat.map((q) => ({
          x: x0 + q.x * kx,
          y: z0 + q.y * kz
        }));
      }
      for (let z = 0; z < resolution; z++) {
        const zc = (z + 0.5) / resolution;
        for (const [xa, xb] of scanlineIntervalsAtY(contour, zc)) {
          const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
          const i1 = Math.min(
            resolution - 1,
            Math.ceil(xb * resolution - 0.5) - 1
          );
          for (let i = i0; i <= i1; i++) voxels[i][y][z] = true;
        }
      }
    } else {
      const fr = rowMask(frontPoly, fy);
      const sr = rowMask(sidePoly, sy);
      let sectionMask = null;
      if (useSections) {
        const yModel = 1 - yc;
        const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
        const contour = interpolateSection(sectionsSorted, yy, sectionsTargetN);
        sectionMask = Array.from(
          { length: resolution },
          () => Array(resolution).fill(false)
        );
        for (let z = 0; z < resolution; z++) {
          const zc = (z + 0.5) / resolution;
          for (const [xa, xb] of scanlineIntervalsAtY(contour, zc)) {
            const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
            const i1 = Math.min(
              resolution - 1,
              Math.ceil(xb * resolution - 0.5) - 1
            );
            for (let i = i0; i <= i1; i++) sectionMask[i][z] = true;
          }
        }
      }
      for (let x = 0; x < resolution; x++) {
        if (!fr[x]) continue;
        for (let z = 0; z < resolution; z++) {
          if (!sr[z]) continue;
          if (sectionMask ? sectionMask[x][z] : top[x][z]) {
            voxels[x][y][z] = true;
          }
        }
      }
    }
  }
  return { voxels, yModel: [1 - 2 * yHi, 1 - 2 * yLo] };
}
function voxelsToMesh(voxels, resolution) {
  const half = resolution / 2;
  const vertices = [];
  const faces = [];
  const idx = (x, y, z) => x * resolution * resolution + y * resolution + z;
  for (let x = 0; x < resolution; x++) {
    for (let y = 0; y < resolution; y++) {
      for (let z = 0; z < resolution; z++) {
        if (!voxels[x][y][z]) continue;
        const fx = x - half;
        const fy = y - half;
        const fz = z - half;
        vertices.push({ x: fx, y: fy, z: fz });
        if (y < resolution - 1) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y + 1, z), idx(x, y + 1, z)]);
        }
        if (y > 0) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y - 1, z), idx(x, y - 1, z)]);
        }
        if (x < resolution - 1) {
          faces.push([idx(x, y, z), idx(x, y + 1, z), idx(x + 1, y + 1, z), idx(x + 1, y, z)]);
        }
        if (x > 0) {
          faces.push([idx(x, y, z), idx(x - 1, y, z), idx(x - 1, y + 1, z), idx(x, y + 1, z)]);
        }
        if (z < resolution - 1) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y + 1, z + 1), idx(x, y + 1, z + 1)]);
        }
        if (z > 0) {
          faces.push([idx(x, y, z), idx(x, y + 1, z), idx(x + 1, y + 1, z), idx(x + 1, y, z)]);
        }
      }
    }
  }
  return { vertices, faces };
}
function meshToVoxels(mesh, resolution = 24) {
  const empty = { voxels: [], resolution: 0 };
  if (!mesh.vertices.length || !mesh.faces.length || resolution < 2) return empty;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const size = Math.max(spanX, spanY, spanZ);
  if (size <= 1e-9) return empty;
  const scale = (resolution - 1) / size;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const voxels = Array.from(
    { length: resolution },
    () => Array.from({ length: resolution }, () => Array(resolution).fill(false))
  );
  let marcados = 0;
  const marcar = (x, y, z) => {
    const ix = Math.round((x - cx) * scale + (resolution - 1) / 2);
    const iy = Math.round((y - cy) * scale + (resolution - 1) / 2);
    const iz = Math.round((z - cz) * scale + (resolution - 1) / 2);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= resolution || iy >= resolution || iz >= resolution) return;
    if (!voxels[ix][iy][iz]) {
      voxels[ix][iy][iz] = true;
      marcados++;
    }
  };
  for (const face of mesh.faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const a = mesh.vertices[face[0]];
      const b = mesh.vertices[face[i]];
      const c = mesh.vertices[face[i + 1]];
      if (!a || !b || !c) continue;
      const lenAB = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * scale;
      const lenAC = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) * scale;
      const lenBC = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) * scale;
      const pasos = Math.min(64, Math.max(1, Math.ceil(Math.max(lenAB, lenAC, lenBC) * 1.5)));
      for (let u = 0; u <= pasos; u++) {
        for (let v = 0; v + u <= pasos; v++) {
          const pu = u / pasos;
          const pv = v / pasos;
          const pw = 1 - pu - pv;
          marcar(
            a.x * pw + b.x * pu + c.x * pv,
            a.y * pw + b.y * pu + c.y * pv,
            a.z * pw + b.z * pu + c.z * pv
          );
        }
      }
    }
  }
  if (marcados === 0) return empty;
  return { voxels, resolution };
}
function voxelsToBoxMesh(voxels, resolution, _greedy = false, yModel = [-1, 1]) {
  const half = resolution / 2;
  const vertices = [];
  const faces = [];
  const vertexMap = /* @__PURE__ */ new Map();
  const vertex = (x, y, z) => {
    const key = `${x},${y},${z}`;
    const existing = vertexMap.get(key);
    if (existing !== void 0) return existing;
    const index = vertices.length;
    vertices.push({
      x: (x - half) / half,
      y: yModel[0] + y / resolution * (yModel[1] - yModel[0]),
      z: (z - half) / half
    });
    vertexMap.set(key, index);
    return index;
  };
  const filled = (x, y, z) => x >= 0 && x < resolution && y >= 0 && y < resolution && z >= 0 && z < resolution && voxels[x][y][z];
  const addFace = (corners) => {
    faces.push(corners.map(([x, y, z]) => vertex(x, y, z)));
  };
  for (let x = 0; x < resolution; x++) {
    for (let y = 0; y < resolution; y++) {
      for (let z = 0; z < resolution; z++) {
        if (!voxels[x][y][z]) continue;
        const px = x + 1;
        const py = y + 1;
        const pz = z + 1;
        if (!filled(x + 1, y, z)) addFace([[px, y, z], [px, py, z], [px, py, pz], [px, y, pz]]);
        if (!filled(x - 1, y, z)) addFace([[x, y, z], [x, y, pz], [x, py, pz], [x, py, z]]);
        if (!filled(x, y + 1, z)) addFace([[x, py, z], [x, py, pz], [px, py, pz], [px, py, z]]);
        if (!filled(x, y - 1, z)) addFace([[x, y, z], [px, y, z], [px, y, pz], [x, y, pz]]);
        if (!filled(x, y, z + 1)) addFace([[x, y, pz], [px, y, pz], [px, py, pz], [x, py, pz]]);
        if (!filled(x, y, z - 1)) addFace([[x, y, z], [x, py, z], [px, py, z], [px, y, z]]);
      }
    }
  }
  return { vertices, faces };
}
var claveVertAnillo = (v) => `${Math.round(v.x * 1e5)}|${Math.round(v.y * 1e5)}|${Math.round(v.z * 1e5)}`;
var claveBordeAnillo = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
function construirAnillos(mesh) {
  const nFaces = mesh.faces.length;
  if (nFaces === 0) return null;
  const canonDe = new Int32Array(mesh.vertices.length).fill(-1);
  const canonPos = [];
  const canonPorClave = /* @__PURE__ */ new Map();
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    if (!v) continue;
    const clave = claveVertAnillo(v);
    let cid = canonPorClave.get(clave);
    if (cid === void 0) {
      cid = canonPos.length;
      canonPorClave.set(clave, cid);
      canonPos.push({ x: v.x, y: v.y, z: v.z });
    }
    canonDe[i] = cid;
  }
  const bordeAFacesConTri = /* @__PURE__ */ new Map();
  const esTri = new Uint8Array(nFaces);
  for (let i = 0; i < nFaces; i++) {
    const face = mesh.faces[i];
    if (!face || face.length !== 3) continue;
    const a = canonDe[face[0]];
    const b = canonDe[face[1]];
    const c = canonDe[face[2]];
    if (a < 0 || b < 0 || c < 0) continue;
    esTri[i] = 1;
    const aristas = [
      [a, b],
      [b, c],
      [c, a]
    ];
    for (const [p, q] of aristas) {
      if (p === q) continue;
      const key = claveBordeAnillo(p, q);
      const lista = bordeAFacesConTri.get(key);
      if (lista) lista.push(i);
      else bordeAFacesConTri.set(key, [i]);
    }
  }
  const incidentes = /* @__PURE__ */ new Map();
  for (const key of bordeAFacesConTri.keys()) {
    const [pa, qa] = key.split("-").map(Number);
    if (!incidentes.has(pa)) incidentes.set(pa, /* @__PURE__ */ new Set());
    if (!incidentes.has(qa)) incidentes.set(qa, /* @__PURE__ */ new Set());
    incidentes.get(pa).add(key);
    incidentes.get(qa).add(key);
  }
  const normalDe = (fi) => {
    const face = mesh.faces[fi];
    const a = mesh.vertices[face[0]];
    const b = mesh.vertices[face[1]];
    const c = mesh.vertices[face[2]];
    if (!a || !b || !c) return null;
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0]
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  };
  const candidatos = [];
  for (const [key, faces] of bordeAFacesConTri) {
    if (faces.length !== 2) continue;
    const [f1, f2] = faces;
    if (!esTri[f1] || !esTri[f2]) continue;
    const n1 = normalDe(f1);
    const n2 = normalDe(f2);
    if (!n1 || !n2) continue;
    const [pa, qa] = key.split("-").map(Number);
    if ((incidentes.get(pa)?.size ?? 0) > 8) continue;
    if ((incidentes.get(qa)?.size ?? 0) > 8) continue;
    const A = canonPos[pa];
    const B = canonPos[qa];
    const len = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    candidatos.push({ t1: f1, t2: f2, dot, len });
  }
  const vecinoMasLargo = new Int32Array(nFaces).fill(-1);
  const vecinoMasLargoLen = new Float64Array(nFaces).fill(-1);
  for (const cand of candidatos) {
    if (cand.len > vecinoMasLargoLen[cand.t1]) {
      vecinoMasLargoLen[cand.t1] = cand.len;
      vecinoMasLargo[cand.t1] = cand.t2;
    }
    if (cand.len > vecinoMasLargoLen[cand.t2]) {
      vecinoMasLargoLen[cand.t2] = cand.len;
      vecinoMasLargo[cand.t2] = cand.t1;
    }
  }
  const pareja = new Int32Array(nFaces).fill(-1);
  for (let fi = 0; fi < nFaces; fi++) {
    const n = vecinoMasLargo[fi];
    if (n < 0 || n <= fi) continue;
    if (vecinoMasLargo[n] === fi && pareja[fi] < 0 && pareja[n] < 0) {
      pareja[fi] = n;
      pareja[n] = fi;
    }
  }
  candidatos.sort((x, y) => y.dot !== x.dot ? y.dot - x.dot : y.len - x.len);
  for (const cand of candidatos) {
    if (pareja[cand.t1] < 0 && pareja[cand.t2] < 0) {
      pareja[cand.t1] = cand.t2;
      pareja[cand.t2] = cand.t1;
    }
  }
  const faceACelda = new Int32Array(nFaces).fill(-1);
  const celdas = [];
  const extremosDe = (key) => {
    const [p, q] = key.split("-").map(Number);
    return /* @__PURE__ */ new Set([p, q]);
  };
  const clasesDe = (bordes) => {
    if (bordes.length !== 4) return null;
    const usados = /* @__PURE__ */ new Set();
    const clases = [[], []];
    let idxClase = 0;
    for (let i0 = 0; i0 < bordes.length; i0++) {
      if (usados.has(i0)) continue;
      const ext = extremosDe(bordes[i0]);
      usados.add(i0);
      clases[idxClase].push(bordes[i0]);
      for (let j0 = i0 + 1; j0 < bordes.length; j0++) {
        if (usados.has(j0)) continue;
        const ext2 = extremosDe(bordes[j0]);
        let comparten = false;
        for (const eVal of ext2) if (ext.has(eVal)) {
          comparten = true;
          break;
        }
        if (!comparten) {
          clases[idxClase].push(bordes[j0]);
          usados.add(j0);
          break;
        }
      }
      idxClase++;
      if (idxClase === 2) break;
    }
    if (clases[0].length === 0 || clases[1].length === 0) return null;
    return clases;
  };
  const bordesDeCara = (fi) => {
    const face = mesh.faces[fi];
    const out = [];
    for (let j = 0; j < face.length; j++) {
      const p = canonDe[face[j]];
      const q = canonDe[face[(j + 1) % face.length]];
      if (p < 0 || q < 0 || p === q) continue;
      out.push(claveBordeAnillo(p, q));
    }
    return out;
  };
  for (let fi = 0; fi < nFaces; fi++) {
    if (pareja[fi] < 0 || pareja[fi] < fi) continue;
    const fj = pareja[fi];
    const c1 = mesh.faces[fi];
    const c2 = mesh.faces[fj];
    const m1 = new Set(c1.map((v) => canonDe[v]));
    const bordesDe = (face) => {
      const out = [];
      for (let j = 0; j < 3; j++) {
        const p = canonDe[face[j]];
        const q = canonDe[face[(j + 1) % 3]];
        if (m1.has(p) && m1.has(q) && bordeAFacesConTri.has(claveBordeAnillo(p, q))) {
          const lista = bordeAFacesConTri.get(claveBordeAnillo(p, q));
          if (lista.includes(fi) && lista.includes(fj)) continue;
        }
        out.push([p, q]);
      }
      return out;
    };
    const b1 = bordesDe(c1);
    const b2 = bordesDe(c2);
    if (b1.length !== 2 || b2.length !== 2) continue;
    const todos = [
      ...b1.map((e) => claveBordeAnillo(e[0], e[1])),
      ...b2.map((e) => claveBordeAnillo(e[0], e[1]))
    ];
    const clases = clasesDe(todos);
    if (!clases || clases[0].length !== 2 || clases[1].length !== 2) continue;
    const celda = celdas.length;
    celdas.push({ tris: [fi, fj], bordes: todos, clases });
    faceACelda[fi] = celda;
    faceACelda[fj] = celda;
  }
  for (let fi = 0; fi < nFaces; fi++) {
    if (faceACelda[fi] >= 0) continue;
    const face = mesh.faces[fi];
    if (!face || face.length !== 4) continue;
    const todos = Array.from(new Set(bordesDeCara(fi)));
    const clases = clasesDe(todos);
    if (!clases || clases[0].length !== 2 || clases[1].length !== 2) continue;
    const celda = celdas.length;
    celdas.push({ tris: [fi], bordes: todos, clases });
    faceACelda[fi] = celda;
  }
  const bordeAFaces = /* @__PURE__ */ new Map();
  for (let i = 0; i < nFaces; i++) {
    const face = mesh.faces[i];
    if (!face || face.length < 3) continue;
    const canon = face.map((v) => canonDe[v]);
    if (canon.some((v) => v < 0)) continue;
    for (let j = 0; j < face.length; j++) {
      const va = canon[j];
      const vb = canon[(j + 1) % face.length];
      if (va === vb) continue;
      const key = claveBordeAnillo(va, vb);
      const lista = bordeAFaces.get(key);
      if (lista) lista.push(i);
      else bordeAFaces.set(key, [i]);
    }
  }
  return { faceACelda, celdas, bordeAFaces, canonPos };
}
function carasAnilloDe(malla, faceIdx, claseBloqueo) {
  const celda0 = malla.faceACelda[faceIdx];
  if (celda0 < 0) return null;
  const celdas = malla.celdas;
  const visitadas = /* @__PURE__ */ new Set([celda0]);
  const caras = /* @__PURE__ */ new Set();
  for (const t of celdas[celda0].tris) caras.add(t);
  const cola = [
    { celda: celda0, clase: claseBloqueo }
  ];
  while (cola.length > 0) {
    const { celda, clase } = cola.pop();
    const celdaAct = celdas[celda];
    const bloqueadas = celdaAct.clases[clase];
    for (const borde of celdaAct.bordes) {
      if (bloqueadas.includes(borde)) continue;
      const faces = malla.bordeAFaces.get(borde) || [];
      for (const f of faces) {
        if (caras.has(f)) continue;
        const tc = malla.faceACelda[f];
        if (tc === celda) continue;
        if (tc >= 0) {
          if (!visitadas.has(tc)) {
            visitadas.add(tc);
            const c2 = celdas[tc];
            for (const t of c2.tris) caras.add(t);
            cola.push({
              celda: tc,
              // La clase BLOQUEADA de la celda vecina es la OPUESTA al borde
              // de entrada: lo que se cruzó (el borde de entrada) es justamente
              // lo que hay que seguir cruzando para avanzar por el anillo.
              clase: c2.clases[0].includes(borde) ? 1 : 0
            });
          }
        } else {
          caras.add(f);
        }
      }
    }
  }
  return caras.size > 0 ? Array.from(caras).sort((a, b) => a - b) : null;
}
function extremosBordeAnillo(malla, borde) {
  const [pa, qa] = borde.split("-").map(Number);
  const A = malla.canonPos[pa];
  const B = malla.canonPos[qa];
  if (!A || !B) return null;
  return [A, B];
}
function meshToTriangles(mesh) {
  const faces = [];
  const outColors = mesh.faceColors ? [] : void 0;
  const outOpacities = mesh.faceOpacities ? [] : void 0;
  mesh.faces.forEach((face, faceIdx) => {
    for (let i = 1; i < face.length - 1; i++) {
      faces.push([face[0], face[i], face[i + 1]]);
      outColors?.push(mesh.faceColors[faceIdx] ?? null);
      outOpacities?.push(mesh.faceOpacities[faceIdx] ?? 1);
    }
  });
  const out = { ...mesh, faces };
  if (outColors) out.faceColors = outColors;
  if (outOpacities) out.faceOpacities = outOpacities;
  if (mesh.opacity !== void 0) {
    out.opacity = mesh.opacity;
  }
  return out;
}
var DEFAULT_VIEWS = {
  front: [],
  side: [],
  top: []
};
function latheProfileLoop(poly) {
  const points = poly.map((p) => ({ x: p.x, y: p.y }));
  if (points.length <= 2) return { points, closed: false };
  const first = points[0];
  const last = points[points.length - 1];
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let perimeter = 0;
  for (let i = 1; i < points.length; i++) {
    perimeter += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }
  const avgEdge = Math.max(perimeter / (points.length - 1), 1e-12);
  const seam = Math.hypot(last.x - first.x, last.y - first.y);
  if (seam <= avgEdge * 3) {
    if (last.x === first.x && last.y === first.y) points.pop();
    return { points, closed: true };
  }
  return { points, closed: false };
}
function buildLatheMesh(profile, segments = 32, clamp = true, textureProjection = "cylindrical") {
  if (profile.length < 3) return { vertices: [], faces: [] };
  const safeSegments = Math.max(3, Math.round(Number.isFinite(segments) ? segments : 32));
  const vertices = [];
  const faces = [];
  const colors = [];
  const profileLoop = latheProfileLoop(profile);
  const normalized = profileLoop.points;
  const closedLoop = profileLoop.closed;
  const curvedProfile = [];
  const curveSteps = 16;
  for (let i = 0; i < normalized.length; i++) {
    const point = normalized[i];
    if (i === 0) curvedProfile.push({ x: point.x, y: point.y });
    if (i >= normalized.length - 1) continue;
    const next = normalized[i + 1];
    const c1 = point.hOut ?? point;
    const c2 = next.hIn ?? next;
    for (let step = 1; step <= curveSteps; step++) {
      const t = step / curveSteps;
      const inverse = 1 - t;
      curvedProfile.push({
        x: inverse * inverse * inverse * point.x + 3 * inverse * inverse * t * c1.x + 3 * inverse * t * t * c2.x + t * t * t * next.x,
        y: inverse * inverse * inverse * point.y + 3 * inverse * inverse * t * c1.y + 3 * inverse * t * t * c2.y + t * t * t * next.y
      });
    }
  }
  if (closedLoop && normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const c1 = last.hOut ?? last;
    const c2 = first.hIn ?? first;
    for (let step = 1; step < curveSteps; step++) {
      const t = step / curveSteps;
      const inverse = 1 - t;
      curvedProfile.push({
        x: inverse * inverse * inverse * last.x + 3 * inverse * inverse * t * c1.x + 3 * inverse * t * t * c2.x + t * t * t * first.x,
        y: inverse * inverse * inverse * last.y + 3 * inverse * inverse * t * c1.y + 3 * inverse * t * t * c2.y + t * t * t * first.y
      });
    }
  }
  const safeProfile = curvedProfile.map((p) => {
    const screenY = Number(p.y.toFixed(6));
    const y = 1 - screenY;
    const x = Math.max(0.01, Number.isFinite(p.x) ? p.x : 0.01);
    return { x, y };
  });
  if (safeProfile.length < 2) return { vertices: [], faces: [] };
  for (let i = 0; i < safeProfile.length; i++) {
    const p = safeProfile[i];
    for (let j = 0; j < safeSegments; j++) {
      const theta = j / safeSegments * Math.PI * 2;
      const x = p.x * Math.cos(theta);
      const z = p.x * Math.sin(theta);
      vertices.push({ x, y: p.y, z });
    }
  }
  for (let i = 0; i < safeProfile.length - 1; i++) {
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      const idx = i * safeSegments + j;
      const idxNext = i * safeSegments + jNext;
      const idxBelow = (i + 1) * safeSegments + j;
      const idxBelowNext = (i + 1) * safeSegments + jNext;
      faces.push([idx, idxNext, idxBelow]);
      faces.push([idxNext, idxBelowNext, idxBelow]);
    }
  }
  if (closedLoop) {
    const lastRow = (safeProfile.length - 1) * safeSegments;
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      const idx = lastRow + j;
      const idxNext = lastRow + jNext;
      faces.push([idx, idxNext, j]);
      faces.push([idxNext, jNext, j]);
    }
  }
  const axisEpsilon = 0.06;
  const topProfile = safeProfile[safeProfile.length - 1];
  const bottomProfile = safeProfile[0];
  if (clamp && !closedLoop && topProfile.x <= axisEpsilon) {
    const topIdx = (safeProfile.length - 1) * safeSegments;
    const centerTopIdx = vertices.length;
    vertices.push({ x: 0, y: topProfile.y, z: 0 });
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      faces.push([centerTopIdx, topIdx + j, topIdx + jNext]);
    }
  }
  if (clamp && bottomProfile.x <= axisEpsilon) {
    const bottomIdx = 0;
    const centerBottomIdx = vertices.length;
    vertices.push({ x: 0, y: bottomProfile.y, z: 0 });
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      faces.push([centerBottomIdx, bottomIdx + jNext, bottomIdx + j]);
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  let maxRadius = 0;
  for (const vertex of vertices) {
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.y > maxY) maxY = vertex.y;
    const radius = Math.hypot(vertex.x, vertex.z);
    if (radius > maxRadius) maxRadius = radius;
  }
  const height = Math.max(1e-6, maxY - minY);
  maxRadius = Math.max(1e-6, maxRadius);
  const uvs = vertices.map((vertex) => {
    const angle = Math.atan2(vertex.z, vertex.x);
    const cylindricalU = (angle / (Math.PI * 2) + 1) % 1;
    const planarU = (vertex.x / maxRadius + 1) / 2;
    const v = (vertex.y - minY) / height;
    if (textureProjection === "planar") return [planarU, v];
    if (textureProjection === "spherical") {
      const radius = Math.max(1e-6, Math.hypot(vertex.x, vertex.y, vertex.z));
      return [cylindricalU, 1 - Math.acos(vertex.y / radius) / Math.PI];
    }
    return [cylindricalU, v];
  });
  return { vertices, faces, faceColors: colors, uvs };
}
function rotatePolygon(poly, x, y, z) {
  if (poly.length === 0) return [];
  const center = { x: 0.5, y: 0.5, z: 0 };
  const rotatePoint = (point) => {
    const xRotated = {
      x: point.x * Math.cos(x) + point.z * Math.sin(x),
      y: point.y,
      z: point.z * Math.cos(x) - point.x * Math.sin(x)
    };
    const yRotated = {
      x: xRotated.x * Math.cos(y) + xRotated.z * Math.sin(y),
      y: xRotated.y,
      z: xRotated.z * Math.cos(y) - xRotated.x * Math.sin(y)
    };
    return {
      x: yRotated.x * Math.cos(z) - yRotated.y * Math.sin(z) + center.x,
      y: yRotated.x * Math.sin(z) + yRotated.y * Math.cos(z) + center.y,
      z: yRotated.z
    };
  };
  const rotatePoint2D = (point) => {
    const rotated = rotatePoint({ x: point.x - center.x, y: point.y - center.y, z: 0 });
    return { x: rotated.x, y: rotated.y };
  };
  return poly.map((point) => ({
    ...rotatePoint2D(point),
    ...point.hIn ? { hIn: rotatePoint2D(point.hIn) } : {},
    ...point.hOut ? { hOut: rotatePoint2D(point.hOut) } : {}
  }));
}
export {
  DEFAULT_HANDLE_LEN,
  DEFAULT_VIEWS,
  GRID_SIZE,
  HIGH_FIDELITY_RES,
  VOXEL_COUNT,
  buildLatheMesh,
  carasAnilloDe,
  closestEdgeHit,
  construirAnillos,
  estamparGrupoTextura,
  extremosBordeAnillo,
  flattenPolygon,
  holeDepth,
  holePolygon,
  interpolateSection,
  isClockwise,
  latheProfileLoop,
  meshToTriangles,
  meshToVoxels,
  normalizePolygon,
  nuevoGrupoTextura,
  pointInPolygon,
  polygonArea,
  polygonYRange,
  rasterizePolygon,
  reconstructVoxels,
  resampleClosed,
  rotatePolygon,
  roundedPolygonPath,
  scanlineIntervalsAtY,
  voxelsToBoxMesh,
  voxelsToMesh
};
