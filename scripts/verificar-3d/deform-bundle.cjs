"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/deformadores.ts
var deformadores_exports = {};
__export(deformadores_exports, {
  DEFORMADORES_DIRECTOS: () => DEFORMADORES_DIRECTOS,
  aplicarDeformador: () => aplicarDeformador,
  aplicarTransformacion: () => aplicarTransformacion,
  aplicarTransformacionInversa: () => aplicarTransformacionInversa,
  deformadorPorId: () => deformadorPorId,
  deformarGrupoCadena: () => deformarGrupoCadena,
  deformarGrupoComoUnidad: () => deformarGrupoComoUnidad,
  repartirGrupoDeformado: () => repartirGrupoDeformado,
  unirMallasComoGrupo: () => unirMallasComoGrupo
});
module.exports = __toCommonJS(deformadores_exports);

// lib/geometry.ts
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
  return { faceACelda, celdas, bordeAFaces, canonDe, canonPos };
}

// lib/mesh-smooth.ts
var posKey = (p) => `${p[0].toFixed(4)}|${p[1].toFixed(4)}|${p[2].toFixed(4)}`;
function smoothVoxelMesh(mesh, iterations = 2) {
  const n = mesh.vertices.length;
  if (n === 0 || mesh.faces.length === 0) return { vertices: [], faces: [] };
  const weldId = new Int32Array(n);
  const positions = [];
  const weldMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const v = mesh.vertices[i];
    const p = [v.x, v.y, v.z];
    const k = posKey(p);
    let id = weldMap.get(k);
    if (id === void 0) {
      id = positions.length;
      positions.push(p);
      weldMap.set(k, id);
    }
    weldId[i] = id;
  }
  const m = positions.length;
  const neighbors = Array.from({ length: m }, () => []);
  const addLink = (a, b) => {
    if (a === b) return;
    if (!neighbors[a].includes(b)) {
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  };
  for (const face of mesh.faces) {
    const len = face.length;
    for (let i = 0; i < len; i++) {
      addLink(weldId[face[i]], weldId[face[(i + 1) % len]]);
    }
  }
  const step = (pos2, factor) => {
    const out = new Array(m);
    for (let i = 0; i < m; i++) {
      const nb = neighbors[i];
      if (nb.length === 0) {
        out[i] = pos2[i];
        continue;
      }
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const j of nb) {
        ax += pos2[j][0];
        ay += pos2[j][1];
        az += pos2[j][2];
      }
      ax /= nb.length;
      ay /= nb.length;
      az /= nb.length;
      const p = pos2[i];
      out[i] = [
        p[0] + factor * (ax - p[0]),
        p[1] + factor * (ay - p[1]),
        p[2] + factor * (az - p[2])
      ];
    }
    return out;
  };
  const LAMBDA = 0.5;
  const MU = -0.53;
  let pos = positions;
  for (let it = 0; it < iterations; it++) {
    pos = step(step(pos, LAMBDA), MU);
  }
  const lineMaps = [
    /* @__PURE__ */ new Map(),
    /* @__PURE__ */ new Map(),
    /* @__PURE__ */ new Map()
  ];
  for (let i = 0; i < m; i++) {
    const p = positions[i];
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const lk = `${p[a].toFixed(4)}|${p[b].toFixed(4)}`;
      let arr = lineMaps[axis].get(lk);
      if (!arr) {
        arr = [];
        lineMaps[axis].set(lk, arr);
      }
      arr.push(i);
    }
  }
  const constraints = Array.from({ length: m }, () => []);
  for (const face of mesh.faces) {
    const len = face.length;
    for (let e = 0; e < len; e++) {
      const a0 = weldId[face[e]];
      const b0 = weldId[face[(e + 1) % len]];
      if (a0 === b0) continue;
      const pa = positions[a0];
      const pb = positions[b0];
      let axis = -1;
      for (let d = 0; d < 3; d++) {
        if (Math.abs(pa[d] - pb[d]) > 1e-6) {
          if (axis !== -1) {
            axis = -2;
            break;
          }
          axis = d;
        }
      }
      if (axis < 0) continue;
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const lk = `${pa[a1].toFixed(4)}|${pa[a2].toFixed(4)}`;
      const line = lineMaps[axis].get(lk);
      if (!line) continue;
      for (const c of line) {
        if (c === a0 || c === b0) continue;
        const t = (positions[c][axis] - pa[axis]) / (pb[axis] - pa[axis]);
        if (t > 1e-6 && t < 1 - 1e-6) {
          constraints[c].push({ a: a0, b: b0, t });
        }
      }
    }
  }
  const finalPos = pos.map((p, i) => {
    const cs = constraints[i];
    if (cs.length === 0) return p;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const c of cs) {
      const pa = pos[c.a];
      const pb = pos[c.b];
      x += pa[0] + c.t * (pb[0] - pa[0]);
      y += pa[1] + c.t * (pb[1] - pa[1]);
      z += pa[2] + c.t * (pb[2] - pa[2]);
    }
    return [x / cs.length, y / cs.length, z / cs.length];
  });
  const vertices = mesh.vertices.map((_, i) => {
    const p = finalPos[weldId[i]];
    return { x: p[0], y: p[1], z: p[2] };
  });
  return { vertices, faces: mesh.faces, faceColors: mesh.faceColors };
}

// lib/plugins/builtin/deformadores.ts
var EJES = [
  { valor: "x", etiqueta: "X (horizontal)" },
  { valor: "y", etiqueta: "Y (vertical)" },
  { valor: "z", etiqueta: "Z (profundidad)" }
];
var leerEje = (v, e) => e === "x" ? v.x : e === "y" ? v.y : v.z;
function conEje(v, e, valor) {
  const copia = { ...v };
  if (e === "x") copia.x = valor;
  else if (e === "y") copia.y = valor;
  else copia.z = valor;
  return copia;
}
function ejesTransversales(e) {
  if (e === "x") return ["y", "z"];
  if (e === "y") return ["x", "z"];
  return ["x", "y"];
}
function caja(mesh, e) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of mesh.vertices) {
    const a = leerEje(v, e);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return { min, max, centro: (min + max) / 2, extension: max - min };
}
var num = (params, id, porDefecto = 0) => {
  const v = params[id];
  return typeof v === "number" && Number.isFinite(v) ? v : porDefecto;
};
var ejeDe = (params, id, porDefecto) => {
  const v = params[id];
  return v === "x" || v === "y" || v === "z" ? v : porDefecto;
};
var doblar = {
  id: "doblar",
  nombre: "Doblar (Bend)",
  categoria: "deformadores",
  descripcion: "Curva la figura en un arco a lo largo del eje elegido.",
  params: [
    {
      tipo: "slider",
      id: "angulo",
      etiqueta: "\xC1ngulo total",
      min: -720,
      max: 720,
      paso: 1,
      valor: 45,
      unidad: "\xB0"
    },
    {
      tipo: "slider",
      id: "diametro",
      etiqueta: "Di\xE1metro de la curva",
      min: 0,
      max: 500,
      paso: 5,
      valor: 0,
      unidad: "%",
      descripcion: "0 = autom\xE1tico (el propio objeto manda). Si lo tocas, el arco usa ESE di\xE1metro (% de la longitud del objeto) y el objeto se estira o encoge para seguirlo: medio punto \u2248 64, c\xEDrculo entero \u2248 32."
    },
    {
      tipo: "select",
      id: "eje",
      etiqueta: "Eje de curvatura",
      opciones: EJES,
      valor: "y"
    }
  ],
  aplicar(mesh, params) {
    const anguloDeg = num(params, "angulo", 45);
    const eje = ejeDe(params, "eje", "y");
    const theta = anguloDeg * Math.PI / 180;
    const cajaEje = caja(mesh, eje);
    if (Math.abs(theta) < 1e-6 || cajaEje.max - cajaEje.min < 1e-9) {
      return mesh;
    }
    const [e1] = ejesTransversales(eje);
    const extent = cajaEje.max - cajaEje.min;
    const diametroPct = num(params, "diametro", 0);
    const RManual = diametroPct > 0 ? diametroPct / 200 * extent : 0;
    const R = Math.max(RManual, extent / theta);
    const k = R * theta / extent;
    if (!Number.isFinite(R) || R < 1e-9) return mesh;
    const centroTransversal = caja(mesh, e1).centro;
    const vertices = mesh.vertices.map((v) => {
      const s = (leerEje(v, eje) - cajaEje.min) * k;
      const d = leerEje(v, e1) - centroTransversal;
      const phi = s / R;
      const radial = R - d;
      const d2 = R - radial * Math.cos(phi);
      const h2 = radial * Math.sin(phi);
      let nuevo = conEje(v, eje, cajaEje.min + h2);
      nuevo = conEje(nuevo, e1, centroTransversal + d2);
      return nuevo;
    });
    return { ...mesh, vertices };
  }
};
var torcionar = {
  id: "torcer",
  nombre: "Torsi\xF3n (Twist)",
  categoria: "deformadores",
  descripcion: "Gira la figura progresivamente alrededor del eje elegido.",
  params: [
    {
      tipo: "slider",
      id: "angulo",
      etiqueta: "\xC1ngulo total",
      min: -720,
      max: 720,
      paso: 1,
      valor: 90,
      unidad: "\xB0"
    },
    {
      tipo: "select",
      id: "eje",
      etiqueta: "Eje de giro",
      opciones: EJES,
      valor: "y"
    }
  ],
  aplicar(mesh, params) {
    const anguloDeg = num(params, "angulo", 90);
    const eje = ejeDe(params, "eje", "y");
    const theta = anguloDeg * Math.PI / 180;
    const cajaEje = caja(mesh, eje);
    if (Math.abs(theta) < 1e-6 || cajaEje.max - cajaEje.min < 1e-9) {
      return mesh;
    }
    const [e1, e2] = ejesTransversales(eje);
    const c1 = caja(mesh, e1).centro;
    const c2 = caja(mesh, e2).centro;
    const vertices = mesh.vertices.map((v) => {
      const t = (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
      const phi = theta * t;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      const d1 = leerEje(v, e1) - c1;
      const d2 = leerEje(v, e2) - c2;
      let nuevo = conEje(v, e1, c1 + d1 * cos - d2 * sin);
      nuevo = conEje(nuevo, e2, c2 + d1 * sin + d2 * cos);
      return nuevo;
    });
    return { ...mesh, vertices };
  }
};
var afilar = {
  id: "afilar",
  nombre: "Afilado (Taper)",
  categoria: "deformadores",
  descripcion: "Engorda o afina la figura de forma progresiva por un extremo.",
  params: [
    {
      tipo: "slider",
      id: "escalaInicio",
      etiqueta: "Escala en la base",
      min: 1,
      max: 300,
      paso: 1,
      valor: 100,
      unidad: "%"
    },
    {
      tipo: "slider",
      id: "escalaFin",
      etiqueta: "Escala en la cima",
      min: 1,
      max: 300,
      paso: 1,
      valor: 30,
      unidad: "%"
    },
    {
      tipo: "select",
      id: "eje",
      etiqueta: "Eje de afilado",
      opciones: EJES,
      valor: "y"
    }
  ],
  aplicar(mesh, params) {
    const fInicio = num(params, "escalaInicio", 100) / 100;
    const fFin = num(params, "escalaFin", 30) / 100;
    const eje = ejeDe(params, "eje", "y");
    const cajaEje = caja(mesh, eje);
    if (cajaEje.max - cajaEje.min < 1e-9) return mesh;
    const [e1, e2] = ejesTransversales(eje);
    const c1 = caja(mesh, e1).centro;
    const c2 = caja(mesh, e2).centro;
    const vertices = mesh.vertices.map((v) => {
      const t = (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
      const f = fInicio + (fFin - fInicio) * t;
      let nuevo = conEje(v, e1, c1 + (leerEje(v, e1) - c1) * f);
      nuevo = conEje(nuevo, e2, c2 + (leerEje(v, e2) - c2) * f);
      return nuevo;
    });
    return { ...mesh, vertices };
  }
};
var ruido = {
  id: "ruido",
  nombre: "Ruido (Noise)",
  categoria: "deformadores",
  descripcion: "Deforma la superficie con ondas suaves (rugosidad org\xE1nica).",
  params: [
    {
      tipo: "slider",
      id: "amplitud",
      etiqueta: "Amplitud",
      min: 0,
      max: 200,
      paso: 1,
      valor: 20,
      unidad: "%"
    },
    {
      tipo: "slider",
      id: "escala",
      etiqueta: "Tama\xF1o de la onda",
      min: 1,
      max: 100,
      paso: 1,
      valor: 25,
      unidad: "%"
    },
    {
      tipo: "slider",
      id: "semilla",
      etiqueta: "Semilla",
      min: 0,
      max: 999,
      paso: 1,
      valor: 7
    },
    {
      tipo: "check",
      id: "deformarEjes",
      etiqueta: "Deformar en los 3 ejes",
      descripcion: "Si se desactiva, el desplazamiento solo empuja hacia arriba (\xFAtil para terrenos).",
      valor: true
    }
  ],
  aplicar(mesh, params) {
    const amplitud = num(params, "amplitud", 20) / 100;
    const escala = num(params, "escala", 25) / 100 + 0.01;
    const semilla = num(params, "semilla", 7);
    const tresEjes = params["deformarEjes"] !== false;
    if (amplitud <= 0) return mesh;
    const f1 = 0.045 / escala;
    const vertices = mesh.vertices.map((v) => {
      const px = v.x * f1 + semilla * 12.9898;
      const py = v.y * f1 + semilla * 78.233;
      const pz = v.z * f1 + semilla * 37.719;
      const dx = Math.sin(py) * Math.cos(pz * 1.31);
      const dy = Math.sin(pz) * Math.cos(px * 1.17);
      const dz = Math.sin(px) * Math.cos(py * 1.43);
      if (tresEjes) {
        return {
          x: v.x + dx * amplitud,
          y: v.y + dy * amplitud,
          z: v.z + dz * amplitud
        };
      }
      return {
        x: v.x,
        y: v.y + dy * amplitud,
        z: v.z
      };
    });
    return { ...mesh, vertices };
  }
};
var DEFORMADORES = [doblar, torcionar, afilar, ruido];

// lib/deformadores.ts
var EJES2 = [
  { valor: "x", etiqueta: "X (horizontal)" },
  { valor: "y", etiqueta: "Y (vertical)" },
  { valor: "z", etiqueta: "Z (profundidad)" }
];
var num2 = (params, id, porDefecto = 0) => {
  const v = params[id];
  return typeof v === "number" && Number.isFinite(v) ? v : porDefecto;
};
var ejeDe2 = (params, id, porDefecto) => {
  const v = params[id];
  return v === "x" || v === "y" || v === "z" ? v : porDefecto;
};
var leerEje2 = (v, e) => e === "x" ? v.x : e === "y" ? v.y : v.z;
function conEje2(v, e, valor) {
  const copia = { ...v };
  if (e === "x") copia.x = valor;
  else if (e === "y") copia.y = valor;
  else copia.z = valor;
  return copia;
}
function ejesTransversales2(e) {
  if (e === "x") return ["y", "z"];
  if (e === "y") return ["x", "z"];
  return ["x", "y"];
}
function caja2(mesh, e) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of mesh.vertices) {
    const a = leerEje2(v, e);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return { min, max, centro: (min + max) / 2, extension: max - min };
}
function pluginAplicar(id, mesh, params) {
  const p = DEFORMADORES.find((d) => d.id === id);
  return p ? p.aplicar(mesh, params) : mesh;
}
function bisel(mesh, params) {
  const radioPct = num2(params, "radio", 10);
  if (radioPct <= 0) return mesh;
  if (mesh.vertices.length === 0 || mesh.faces.length === 0) return mesh;
  const topo = construirAnillos(mesh);
  if (!topo) return mesh;
  const { canonDe, canonPos, bordeAFaces } = topo;
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
  const radioAbs = radioPct / 100 * diagonal * 0.5;
  if (radioAbs < 1e-9) return mesh;
  const nuevaVertices = [...mesh.vertices];
  const nuevaUvs = mesh.uvs ? [...mesh.uvs] : void 0;
  const colorSi = mesh.faceColors ? [...mesh.faceColors] : void 0;
  const opSi = mesh.faceOpacities ? [...mesh.faceOpacities] : void 0;
  const texSi = mesh.faceTextures ? [...mesh.faceTextures] : void 0;
  const caras = [];
  const coloresFinales = [];
  const opacidadesFinales = [];
  const texturasFinales = [];
  const gruposFinales = [];
  const emite = (face, donanteIdx) => {
    caras.push(face);
    coloresFinales.push(colorSi ? colorSi[donanteIdx] ?? null : null);
    opacidadesFinales.push(opSi ? opSi[donanteIdx] ?? 1 : 1);
    texturasFinales.push(texSi ? texSi[donanteIdx] ?? null : null);
    if (mesh.faceTextureGroups) gruposFinales.push(mesh.faceTextureGroups[donanteIdx] ?? null);
  };
  const insetDe = /* @__PURE__ */ new Map();
  const donanteDe = /* @__PURE__ */ new Map();
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const cara = mesh.faces[fi];
    if (cara.length < 3) continue;
    const canonUnicos = [];
    const vistos = /* @__PURE__ */ new Set();
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
    if (largoNormal < 1e-12) continue;
    const normal = { x: nx / largoNormal, y: ny / largoNormal, z: nz / largoNormal };
    const centro = { x: cx / n, y: cy / n, z: cz / n };
    const insetFace = [];
    for (const vi of cara) {
      const c = canonDe[vi];
      const clave = `${fi}:${c}`;
      let idx = insetDe.get(clave);
      if (idx === void 0) {
        const pos = canonPos[c];
        let dx = centro.x - pos.x;
        let dy = centro.y - pos.y;
        let dz = centro.z - pos.z;
        const dn = dx * normal.x + dy * normal.y + dz * normal.z;
        dx -= normal.x * dn;
        dy -= normal.y * dn;
        dz -= normal.z * dn;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const paso = Math.min(radioAbs, dist * 0.45);
        if (paso < 1e-9 || dist < 1e-12) {
          idx = mesh.vertices.length;
          nuevaVertices.push({ x: pos.x, y: pos.y, z: pos.z });
          if (nuevaUvs) nuevaUvs.push([...mesh.uvs?.[vi] ?? [0, 0]]);
        } else {
          const f = paso / dist;
          idx = nuevaVertices.length;
          nuevaVertices.push({
            x: pos.x + dx * f,
            y: pos.y + dy * f,
            z: pos.z + dz * f
          });
          if (nuevaUvs) nuevaUvs.push([...mesh.uvs?.[vi] ?? [0, 0]]);
        }
        insetDe.set(clave, idx);
        donanteDe.set(idx, fi);
      }
      insetFace.push(idx);
    }
    if (insetFace.length === cara.length) emite(insetFace, fi);
  }
  for (const [arista, faces] of bordeAFaces) {
    if (faces.length !== 2) continue;
    const [f1, f2] = faces;
    const guion = arista.indexOf("-");
    const pa = Number(arista.slice(0, guion));
    const qa = Number(arista.slice(guion + 1));
    if (!Number.isFinite(pa) || !Number.isFinite(qa)) continue;
    const ia1 = insetDe.get(`${f1}:${pa}`);
    const ib1 = insetDe.get(`${f1}:${qa}`);
    const ia2 = insetDe.get(`${f2}:${pa}`);
    const ib2 = insetDe.get(`${f2}:${qa}`);
    if (ia1 === void 0 || ib1 === void 0 || ia2 === void 0 || ib2 === void 0) {
      continue;
    }
    emite([ia1, ib1, ib2, ia2], f1);
  }
  const incidentes = /* @__PURE__ */ new Map();
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
      continue;
    }
    const pos = canonPos[c];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const puntosInset = [];
    for (const fi of faces) {
      const cara = mesh.faces[fi];
      const canon = cara.map((vi) => canonDe[vi]);
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
      if (idx === void 0) continue;
      const pin = nuevaVertices[idx];
      puntosInset.push({
        idx,
        x: pin.x,
        y: pin.y,
        z: pin.z,
        donante: fi
      });
    }
    const largoV = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (largoV < 1e-12 || puntosInset.length < 3) {
      for (let i = 1; i + 1 < puntosInset.length; i++) {
        emite(
          [puntosInset[0].idx, puntosInset[i].idx, puntosInset[i + 1].idx],
          puntosInset[i].donante
        );
      }
      continue;
    }
    const nrm = { x: nx / largoV, y: ny / largoV, z: nz / largoV };
    let ref;
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
    const orden = puntosInset.map((p) => {
      const wx = p.x - pos.x;
      const wy = p.y - pos.y;
      const wz = p.z - pos.z;
      const a = wx * ux + wy * uy + wz * uz;
      const b = wx * vx + wy * vy + wz * vz;
      return { p, ang: Math.atan2(b, a) };
    }).sort((r1, r2) => r1.ang - r2.ang);
    for (let i = 1; i + 1 < orden.length; i++) {
      emite(
        [orden[0].p.idx, orden[i].p.idx, orden[i + 1].p.idx],
        orden[i].p.donante
      );
    }
  }
  const salida = { ...mesh, vertices: nuevaVertices, faces: caras };
  if (caras.length === 0 || caras.length < mesh.faces.length) return mesh;
  if (nuevaUvs) salida.uvs = nuevaUvs;
  if (colorSi) salida.faceColors = coloresFinales;
  if (opSi) salida.faceOpacities = opacidadesFinales;
  if (texSi) salida.faceTextures = texturasFinales;
  if (mesh.faceTextureGroups) salida.faceTextureGroups = gruposFinales;
  return salida;
}
function hinchar(mesh, params) {
  const amplitud = num2(params, "amplitud", 20) / 100;
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
  const normales = /* @__PURE__ */ new Map();
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
  const desplaz = /* @__PURE__ */ new Map();
  for (const [c, n] of normales) {
    const largo = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (largo < 1e-12) continue;
    const pos = canonPos[c];
    desplaz.set(c, {
      x: pos.x + n[0] / largo * paso,
      y: pos.y + n[1] / largo * paso,
      z: pos.z + n[2] / largo * paso
    });
  }
  const vertices = mesh.vertices.map((v, i) => {
    const nuevo = desplaz.get(canonDe[i]);
    return nuevo ? { x: nuevo.x, y: nuevo.y, z: nuevo.z } : { ...v };
  });
  return { ...mesh, vertices };
}
function sesgar(mesh, params) {
  const desplazamiento = num2(params, "desplazamiento", 20) / 100;
  const eje = ejeDe2(params, "eje", "y");
  const cajaEje = caja2(mesh, eje);
  if (desplazamiento === 0 || cajaEje.max - cajaEje.min < 1e-9) return mesh;
  const [e1] = ejesTransversales2(eje);
  const cajaT = caja2(mesh, e1);
  const total = desplazamiento * cajaT.extension;
  if (!Number.isFinite(total)) return mesh;
  const vertices = mesh.vertices.map((v) => {
    const t = (leerEje2(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
    return conEje2(v, e1, leerEje2(v, e1) + total * t);
  });
  return { ...mesh, vertices };
}
function derretir(mesh, params) {
  const caida = num2(params, "caida", 40) / 100;
  const ensanche = num2(params, "ensanche", 20) / 100;
  const eje = ejeDe2(params, "eje", "y");
  const cajaEje = caja2(mesh, eje);
  if (cajaEje.max - cajaEje.min < 1e-9) return mesh;
  if (caida === 0 && ensanche === 0) return mesh;
  const [e1, e2] = ejesTransversales2(eje);
  const c1 = caja2(mesh, e1).centro;
  const c2 = caja2(mesh, e2).centro;
  const caidaAbs = caida * (cajaEje.max - cajaEje.min);
  const ensancheAbs = Math.max(
    caja2(mesh, e1).extension,
    caja2(mesh, e2).extension
  ) * ensanche;
  const vertices = mesh.vertices.map((v) => {
    const t = (leerEje2(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
    const d1 = leerEje2(v, e1) - c1;
    const d2 = leerEje2(v, e2) - c2;
    let nuevo = conEje2(v, eje, leerEje2(v, eje) - caidaAbs * t * t);
    if (ensancheAbs !== 0) {
      const dist = Math.sqrt(d1 * d1 + d2 * d2);
      if (dist > 1e-9) {
        const f = ensancheAbs * (1 - t) * (1 - t) / dist;
        nuevo = conEje2(nuevo, e1, leerEje2(nuevo, e1) + d1 * f);
        nuevo = conEje2(nuevo, e2, leerEje2(nuevo, e2) + d2 * f);
      }
    }
    return nuevo;
  });
  return { ...mesh, vertices };
}
function mulberryDeform(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var giraVector = (v, ax, ay, az, seno, cos) => {
  if (seno === 0 && cos === 1) return { ...v };
  const cxr = ay * v.z - az * v.y;
  const cyr = az * v.x - ax * v.z;
  const czr = ax * v.y - ay * v.x;
  const k = (1 - cos) * (ax * v.x + ay * v.y + az * v.z);
  return {
    x: v.x * cos + cxr * seno + ax * k,
    y: v.y * cos + cyr * seno + ay * k,
    z: v.z * cos + czr * seno + az * k
  };
};
var puntoRomper = (p, t) => {
  let q = {
    x: (p.x - t.centro.x) * t.escala,
    y: (p.y - t.centro.y) * t.escala,
    z: (p.z - t.centro.z) * t.escala
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
    z: q.z + t.centro.z + t.dz
  };
};
var normalDeCaras = (mesh, lista) => {
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
function romper(mesh, params) {
  const fuerza = num2(params, "fuerza", 0);
  if (fuerza <= 0) return mesh;
  const caras = mesh.faces.length;
  if (caras < 3 || mesh.vertices.length === 0) return mesh;
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
  const suX = num2(params, "sueloUx", NaN);
  const suY = num2(params, "sueloUy", NaN);
  const suZ = num2(params, "sueloUz", NaN);
  const sueloD = num2(params, "sueloD", NaN);
  const lonU = Math.hypot(suX, suY, suZ);
  const usaSuelo = Number.isFinite(suX) && Number.isFinite(suY) && Number.isFinite(suZ) && Number.isFinite(sueloD) && lonU > 1e-9;
  const uS = usaSuelo ? { x: suX / lonU, y: suY / lonU, z: suZ / lonU } : { x: 0, y: 1, z: 0 };
  const planoD = usaSuelo ? sueloD : baseY;
  const altoDe = (v) => v.x * uS.x + v.y * uS.y + v.z * uS.z;
  const giro = Math.max(0, num2(params, "giroVelocidad", 90));
  const escala = Math.max(0.02, num2(params, "tamanoFinal", 100) / 100);
  const aleat = Math.min(100, Math.max(0, num2(params, "aleatoriedad", 50))) / 100;
  const caida = Math.min(100, Math.max(0, num2(params, "caida", 0))) / 100;
  const rnd = mulberryDeform(Math.round(num2(params, "semilla", 42)));
  const centCara = new Array(caras);
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
  const centroObj = { x: cxTotal / caras, y: cyTotal / caras, z: czTotal / caras };
  const piezas = Math.max(2, Math.min(Math.round(caras / 1.4), 2e3));
  const pesos = [];
  let sumaPesos = 0;
  for (let i = 0; i < piezas; i++) {
    const w = (1 - aleat + rnd() * 2 * aleat) ** 3;
    pesos.push(Math.max(0.01, w));
    sumaPesos += w;
  }
  const cuota = new Array(piezas);
  let usadas = 0;
  for (let i = 0; i < piezas; i++) {
    const q = Math.max(1, Math.round(caras * pesos[i] / sumaPesos));
    cuota[i] = q;
    usadas += q;
  }
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
  let vecinas = null;
  try {
    const topo = construirAnillos(mesh);
    if (topo) {
      vecinas = mesh.faces.map(() => []);
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
  const semillasUsadas = /* @__PURE__ */ new Set();
  while (semillasUsadas.size < Math.min(piezas, caras)) {
    semillasUsadas.add(Math.floor(rnd() * caras));
  }
  const pedazoDe = new Array(caras).fill(-1);
  const carasDe = Array.from({ length: piezas }, () => []);
  const colas = Array.from({ length: piezas }, () => []);
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
        const f = cola.shift();
        const tomada = (vecinas?.[f] ?? []).find((g) => pedazoDe[g] === -1);
        if (tomada === void 0) continue;
        pedazoDe[tomada] = p;
        carasDe[p].push(tomada);
        cola.push(tomada);
        sueltasRestantes--;
        avanza = true;
        break;
      }
    }
    if (!avanza) break;
  }
  for (let f = 0; f < caras; f++) {
    if (pedazoDe[f] !== -1) continue;
    const p = Math.floor(rnd() * piezas);
    pedazoDe[f] = p;
    carasDe[p].push(f);
  }
  const pedazos = carasDe.map((lista) => {
    const nC = Math.max(1, lista.length);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const f of lista) {
      px += centCara[f].x;
      py += centCara[f].y;
      pz += centCara[f].z;
    }
    const centro = { x: px / nC, y: py / nC, z: pz / nC };
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
    const angulo = giro * Math.PI / 180 * rnd() * rnd();
    const seno = Math.sin(angulo);
    const cosA = Math.cos(angulo);
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
      const cruzLon = Math.hypot(nxu, nyu, nzu);
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
    const mag = fuerza / 100 * diagonal * (0.3 + rnd());
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
      dz: vz * mag
    };
  });
  const nuevosVertices = [];
  const nuevasCaras = new Array(caras);
  const nuevosUvs = mesh.uvs ? [] : void 0;
  const indicesDe = pedazos.map(() => []);
  for (let f = 0; f < caras; f++) {
    const t = pedazos[pedazoDe[f]];
    const cara = mesh.faces[f];
    const nueva = [];
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
var paramsDePlugin = (id) => {
  const p = DEFORMADORES.find((d) => d.id === id);
  return p ? p.params : [];
};
var conValor = (params, cambios) => params.map(
  (p) => p.tipo === "slider" && cambios[p.id] !== void 0 ? { ...p, valor: cambios[p.id] } : p
);
var biselParams = [
  {
    tipo: "slider",
    id: "radio",
    etiqueta: "Radio",
    min: 0,
    max: 50,
    paso: 1,
    valor: 0,
    unidad: "%",
    descripcion: "Tama\xF1o del chafl\xE1n relativo a la caja del objeto (0 = sin bisel). En figuras muy voxelizadas puede no apretar."
  }
];
var DEFORMADORES_DIRECTOS = [
  {
    id: "doblar",
    nombre: "Doblar",
    icono: "/icons/Doblar.png",
    // Neutro al entrar: el usuario dobla desde 0 con el campo.
    params: conValor(paramsDePlugin("doblar"), { angulo: 0 }),
    aplicar: (mesh, params) => {
      if (Math.abs(num2(params, "angulo", 0)) < 1e-9) return mesh;
      return pluginAplicar("doblar", mesh, params);
    }
  },
  {
    id: "enroscar",
    nombre: "Enroscar",
    icono: "/icons/Enroscar.png",
    params: conValor(paramsDePlugin("torcer"), { angulo: 0 }),
    aplicar: (mesh, params) => {
      if (Math.abs(num2(params, "angulo", 0)) < 1e-9) return mesh;
      return pluginAplicar("torcer", mesh, params);
    }
  },
  {
    id: "bisel",
    nombre: "Bisel",
    icono: "/icons/Bisel.png",
    params: biselParams,
    aplicar: (mesh, params) => bisel(mesh, params)
  },
  {
    id: "hinchar",
    nombre: "Hinchar",
    icono: "/icons/Hinchar.png",
    params: [
      {
        tipo: "slider",
        id: "amplitud",
        etiqueta: "Amplitud",
        min: -100,
        max: 200,
        paso: 1,
        valor: 0,
        unidad: "%"
      }
    ],
    aplicar: (mesh, params) => hinchar(mesh, params)
  },
  {
    id: "sesgar",
    nombre: "Sesgar",
    icono: "/icons/Sesgar.png",
    params: [
      {
        tipo: "slider",
        id: "desplazamiento",
        etiqueta: "Desplazamiento",
        min: -100,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: "%"
      },
      {
        tipo: "select",
        id: "eje",
        etiqueta: "Eje de sesgado",
        opciones: EJES2,
        valor: "y"
      }
    ],
    aplicar: (mesh, params) => sesgar(mesh, params)
  },
  {
    id: "suavizado",
    nombre: "Suavizado",
    icono: "/icons/Suavizado.png",
    params: [
      {
        tipo: "slider",
        id: "iteraciones",
        etiqueta: "Intensidad",
        min: 0,
        max: 10,
        paso: 1,
        valor: 0
      }
    ],
    aplicar: (mesh, params) => {
      const iteraciones = Math.round(num2(params, "iteraciones", 0));
      if (iteraciones <= 0) return mesh;
      return smoothVoxelMesh(mesh, iteraciones);
    }
  },
  {
    id: "afilar",
    nombre: "Afilar",
    icono: "/icons/Afilar.png",
    // Neutro: base y cima a 100% (el usuario afina él).
    params: conValor(paramsDePlugin("afilar"), { escalaFin: 100 }),
    aplicar: (mesh, params) => pluginAplicar("afilar", mesh, params)
  },
  {
    id: "derretir",
    nombre: "Derretir",
    icono: "/icons/Derretir.png",
    params: [
      {
        tipo: "slider",
        id: "caida",
        etiqueta: "Ca\xEDda",
        min: 0,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: "%"
      },
      {
        tipo: "slider",
        id: "ensanche",
        etiqueta: "Ensanche en la base",
        min: 0,
        max: 100,
        paso: 1,
        valor: 0,
        unidad: "%"
      },
      {
        tipo: "select",
        id: "eje",
        etiqueta: "Eje vertical",
        opciones: EJES2,
        valor: "y"
      }
    ],
    aplicar: (mesh, params) => derretir(mesh, params)
  },
  {
    id: "romper",
    nombre: "Romper",
    icono: "/icons/Romper.png",
    params: [
      {
        tipo: "slider",
        id: "fuerza",
        etiqueta: "Fuerza",
        min: 0,
        max: 300,
        paso: 1,
        valor: 0,
        unidad: "%",
        descripcion: "Con cu\xE1nta violencia se esparcen los pedazos (0 = sin romper; 100 = dispersi\xF3n del tama\xF1o del objeto). Cuantos m\xE1s segmentos tenga la pieza, m\xE1s pedazos salen (cada uno del tama\xF1o de una cara, no todos iguales)."
      },
      {
        tipo: "slider",
        id: "caida",
        etiqueta: "Ca\xEDda",
        min: 0,
        max: 100,
        paso: 1,
        // 0 por defecto: la FUERZA solo dispersa (explosión congelada);
        // caer al suelo lo manda SU campo, Caída — antes con 100 de
        // default CUALQUIER fuerza (hasta 1) tiraba todo al suelo.
        valor: 0,
        unidad: "%",
        descripcion: "0% = los pedazos se quedan flotando por el aire, como una explosi\xF3n congelada. 100% = caen al suelo y se tumban: TODOS quedan apoyados planos, ninguno flotando. Los intermedios caen y se tumban a medias."
      },
      {
        tipo: "slider",
        id: "giroVelocidad",
        etiqueta: "Velocidad de \xE1ngulo",
        min: 0,
        max: 720,
        paso: 5,
        valor: 90,
        unidad: "\xB0",
        descripcion: "Giro que sale volando cada pedazo (cada uno gira distinto, hasta ese \xE1ngulo)."
      },
      {
        tipo: "slider",
        id: "tamanoFinal",
        etiqueta: "Tama\xF1o final",
        min: 5,
        max: 100,
        paso: 1,
        valor: 100,
        unidad: "%",
        descripcion: "Escala de cada pedazo: 100% los deja intactos, 50% los deja a la mitad."
      },
      {
        tipo: "slider",
        id: "aleatoriedad",
        etiqueta: "Aleatoriedad",
        min: 0,
        max: 100,
        paso: 1,
        valor: 50,
        unidad: "%",
        descripcion: "Lo desigual del reparto: tama\xF1os y vuelos distintos entre pedazos."
      },
      {
        tipo: "slider",
        id: "semilla",
        etiqueta: "Semilla",
        min: 1,
        max: 999,
        paso: 1,
        valor: 42
      }
    ],
    aplicar: (mesh, params) => romper(mesh, params)
  }
];
function deformadorPorId(id) {
  return DEFORMADORES_DIRECTOS.find((d) => d.id === id) ?? null;
}
function aplicarDeformador(id, mesh, params) {
  const def = deformadorPorId(id);
  if (!def) return mesh;
  const llenos = { ...params };
  for (const p of def.params) {
    if (llenos[p.id] === void 0) llenos[p.id] = p.valor;
  }
  try {
    return def.aplicar(mesh, llenos);
  } catch (error) {
    console.warn("[deformadores] Fall\xF3 el deformador, se deja la malla tal cual:", error);
    return mesh;
  }
}
function rotacionXYZ(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy
  ];
}
function aplicarTransformacion(t, v) {
  const r = rotacionXYZ(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  const x = (t.sx ?? 1) * v.x, y = (t.sy ?? 1) * v.y, z = (t.sz ?? 1) * v.z;
  return {
    x: r[0] * x + r[1] * y + r[2] * z + (t.px ?? 0),
    y: r[3] * x + r[4] * y + r[5] * z + (t.py ?? 0),
    z: r[6] * x + r[7] * y + r[8] * z + (t.pz ?? 0)
  };
}
function aplicarTransformacionInversa(t, v) {
  const r = rotacionXYZ(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  const dx = v.x - (t.px ?? 0), dy = v.y - (t.py ?? 0), dz = v.z - (t.pz ?? 0);
  const x = r[0] * dx + r[3] * dy + r[6] * dz;
  const y = r[1] * dx + r[4] * dy + r[7] * dz;
  const z = r[2] * dx + r[5] * dy + r[8] * dz;
  return { x: x / (t.sx || 1), y: y / (t.sy || 1), z: z / (t.sz || 1) };
}
function unirMallasComoGrupo(miembros, marco) {
  const vertices = [];
  const faces = [];
  const faceColors = [];
  const faceOpacities = [];
  const faceTextures = [];
  const faceTextureGroups = [];
  const uvs = [];
  const hayUVs = miembros.some((m) => !!m.mesh.uvs);
  const partes = miembros.map((miembro) => {
    const vinicio = vertices.length;
    const finicio = faces.length;
    for (const v of miembro.mesh.vertices) {
      const enMarco = aplicarTransformacion(miembro.transform, v);
      vertices.push(aplicarTransformacionInversa(marco, enMarco));
    }
    for (const f of miembro.mesh.faces) {
      faces.push(f.map((indice) => indice + vinicio));
    }
    const caras = miembro.mesh.faces.length;
    for (let c = 0; c < caras; c++) {
      faceColors.push(miembro.mesh.faceColors?.[c] ?? null);
      faceOpacities.push(miembro.mesh.faceOpacities?.[c] ?? 1);
      faceTextures.push(miembro.mesh.faceTextures?.[c] ?? null);
      faceTextureGroups.push(miembro.mesh.faceTextureGroups?.[c] ?? null);
    }
    if (hayUVs) {
      const uvsMiembro = miembro.mesh.uvs;
      for (let vi = 0; vi < miembro.mesh.vertices.length; vi++) {
        uvs.push(uvsMiembro?.[vi] ?? [0, 0]);
      }
    }
    return {
      id: miembro.id,
      vinicio,
      finicio,
      base: miembro.mesh,
      transform: miembro.transform,
      teniaUVs: !!miembro.mesh.uvs,
      teniaColores: !!miembro.mesh.faceColors,
      teniaOpacidades: !!miembro.mesh.faceOpacities,
      teniaTexturas: !!miembro.mesh.faceTextures,
      teniaGruposT: !!miembro.mesh.faceTextureGroups
    };
  });
  const unida = {
    vertices,
    faces,
    ...faceColors.length ? { faceColors } : {},
    ...faceOpacities.length ? { faceOpacities } : {},
    ...faceTextures.length ? { faceTextures } : {},
    ...faceTextureGroups.length ? { faceTextureGroups } : {},
    ...hayUVs && uvs.length ? { uvs } : {},
    // Campos de malla (nivel objeto): los del primer miembro (el marco).
    ...deNivelObjeto(miembros[0]?.mesh)
  };
  return { unida, partes, marco };
}
function repartirGrupoDeformado(union, deformada) {
  const total = deformada.vertices.length;
  return union.partes.map((parte, i) => {
    const sigV = i + 1 < union.partes.length ? union.partes[i + 1].vinicio : total;
    const sigF = i + 1 < union.partes.length ? union.partes[i + 1].finicio : deformada.faces.length;
    const vertices = deformada.vertices.slice(parte.vinicio, sigV).map(
      (p) => aplicarTransformacionInversa(
        parte.transform,
        aplicarTransformacion(union.marco, p)
      )
    );
    const mallaLocal = {
      ...deNivelObjeto(parte.base),
      vertices,
      faces: deformada.faces.slice(parte.finicio, sigF).map((f) => f.map((indice) => indice - parte.vinicio)),
      // SOLO los arrays que el miembro LLEVABA: inventarlos (de nulls o
      // de 1s) cambia la RAMA del visual — uvs [0,0] colapsan la textura
      // proyectada, faceColors de nulls puede tapar el color del objeto…
      ...parte.teniaColores ? { faceColors: deformada.faceColors?.slice(parte.finicio, sigF) } : {},
      ...parte.teniaOpacidades ? { faceOpacities: deformada.faceOpacities?.slice(parte.finicio, sigF) ?? [] } : {},
      ...parte.teniaTexturas ? { faceTextures: deformada.faceTextures?.slice(parte.finicio, sigF) } : {},
      ...parte.teniaGruposT ? { faceTextureGroups: deformada.faceTextureGroups?.slice(parte.finicio, sigF) } : {},
      // UVs SOLO si el miembro LLEVABA: los [0,0] inventados mandan sobre
      // la proyección y la textura colapsa a un texel.
      ...union.unida.uvs && parte.teniaUVs ? { uvs: deformada.uvs?.slice(parte.vinicio, sigV) ?? [] } : {}
    };
    return { id: parte.id, mesh: mallaLocal, transform: parte.transform };
  });
}
function deNivelObjeto(m) {
  if (!m) return {};
  const { vertices: _v, faces: _f, faceColors: _c, faceOpacities: _o, faceTextures: _t, faceTextureGroups: _g, uvs: _u, ...resto } = m;
  return resto;
}
function deformarGrupoComoUnidad(id, marco, miembros, params) {
  return deformarGrupoCadena(marco, miembros, [{ tipo: id, params }]);
}
function deformarGrupoCadena(marco, miembros, cadena) {
  if (miembros.length === 0) return null;
  const union = unirMallasComoGrupo(miembros, marco);
  let m = union.unida;
  for (const paso of cadena) {
    const salida = aplicarDeformador(paso.tipo, m, paso.params);
    if (salida && salida.vertices.length > 0 && salida.faces.length > 0) m = salida;
  }
  if (m === union.unida) {
    return { porMiembro: miembros.map((mi) => ({ id: mi.id, mesh: mi.mesh, transform: mi.transform })), unida: union.unida };
  }
  return { porMiembro: repartirGrupoDeformado(union, m), unida: m };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFORMADORES_DIRECTOS,
  aplicarDeformador,
  aplicarTransformacion,
  aplicarTransformacionInversa,
  deformadorPorId,
  deformarGrupoCadena,
  deformarGrupoComoUnidad,
  repartirGrupoDeformado,
  unirMallasComoGrupo
});
