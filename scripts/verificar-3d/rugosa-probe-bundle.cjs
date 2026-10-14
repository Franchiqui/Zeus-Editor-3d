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

// lib/extrusion-seleccion.ts
var extrusion_seleccion_exports = {};
__export(extrusion_seleccion_exports, {
  aristasDeMalla: () => aristasDeMalla,
  extrudeRegionMesh: () => extrudeRegionMesh,
  normalesSuavizadasDeRegion: () => normalesSuavizadasDeRegion,
  regionSegunObjetivo: () => regionSegunObjetivo
});
module.exports = __toCommonJS(extrusion_seleccion_exports);
function claveArista(a, b) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
}
function clavePunto(v) {
  return `${v.x.toFixed(6)}|${v.y.toFixed(6)}|${v.z.toFixed(6)}`;
}
function normalesSuavizadasDeRegion(mesh, carasRegion) {
  const totalCaras = mesh.faces.length;
  const region = carasRegion.filter((f) => f >= 0 && f < totalCaras);
  const salida = /* @__PURE__ */ new Map();
  if (region.length === 0) return salida;
  const clusterDeVert = /* @__PURE__ */ new Map();
  const puntosDeCluster = /* @__PURE__ */ new Map();
  const cidDePunto = /* @__PURE__ */ new Map();
  for (const idx of region) {
    for (const v of mesh.faces[idx]) {
      if (clusterDeVert.has(v)) continue;
      const p = mesh.vertices[v];
      if (!p) continue;
      const key = clavePunto(p);
      let cid = cidDePunto.get(key);
      if (cid === void 0) {
        cid = puntosDeCluster.size;
        puntosDeCluster.set(cid, p);
        cidDePunto.set(key, cid);
      }
      clusterDeVert.set(v, cid);
    }
  }
  const caraClusters = region.map((idx) => mesh.faces[idx].map((v) => clusterDeVert.get(v)));
  const normalBruta = /* @__PURE__ */ new Map();
  for (let i = 0; i < region.length; i++) {
    const cara = mesh.faces[region[i]];
    if (cara.length < 3) continue;
    const a = mesh.vertices[cara[0]];
    const b = mesh.vertices[cara[1]];
    const c = mesh.vertices[cara[2]];
    if (!a || !b || !c) continue;
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    normalBruta.set(i, { x: nx, y: ny, z: nz });
  }
  const aristasRegion = /* @__PURE__ */ new Map();
  for (let i = 0; i < region.length; i++) {
    const cl = caraClusters[i];
    for (let k = 0; k < cl.length; k++) {
      const ca = cl[k];
      const cb = cl[(k + 1) % cl.length];
      if (ca === cb) continue;
      const key = claveArista(ca, cb);
      const sentido = ca < cb ? 1 : -1;
      const lista = aristasRegion.get(key) ?? [];
      lista.push({ cara: i, sentido });
      aristasRegion.set(key, lista);
    }
  }
  const vecinosDe = (i) => {
    const salidaL = [];
    const cl = caraClusters[i];
    for (let k = 0; k < cl.length; k++) {
      const ca = cl[k];
      const cb = cl[(k + 1) % cl.length];
      if (ca === cb) continue;
      const key = claveArista(ca, cb);
      const lista = aristasRegion.get(key) ?? [];
      for (const otro of lista) {
        if (otro.cara === i) continue;
        const miSentido = ca < cb ? 1 : -1;
        salidaL.push({ cara: otro.cara, consistente: miSentido !== otro.sentido });
      }
    }
    return salidaL;
  };
  const volteada = /* @__PURE__ */ new Map();
  for (let i = 0; i < region.length; i++) volteada.set(i, false);
  const vista = /* @__PURE__ */ new Set([0]);
  const cola = [0];
  while (cola.length > 0) {
    const i = cola.shift();
    for (const { cara: j, consistente } of vecinosDe(i)) {
      const caraBruta = normalBruta.get(j);
      if (!caraBruta || vista.has(j)) continue;
      vista.add(j);
      const miVolteada = volteada.get(i);
      volteada.set(j, consistente ? miVolteada : !miVolteada);
      cola.push(j);
    }
  }
  const normalCoherente = (i) => {
    const n = normalBruta.get(i);
    if (!n) return void 0;
    if (!volteada.get(i)) return n;
    return { x: -n.x, y: -n.y, z: -n.z };
  };
  const setRegion = new Set(region);
  const carasDeArista = /* @__PURE__ */ new Map();
  for (let i = 0; i < mesh.faces.length; i++) {
    const cara = mesh.faces[i];
    for (let k = 0; k < cara.length; k++) {
      const ca = clusterDeVert.get(cara[k]);
      const cb = clusterDeVert.get(cara[(k + 1) % cara.length]);
      if (ca === void 0 || cb === void 0 || ca === cb) continue;
      const key = claveArista(ca, cb);
      const lista = carasDeArista.get(key) ?? [];
      lista.push(i);
      carasDeArista.set(key, lista);
    }
  }
  let votosSalida = 0, votosEntrada = 0;
  for (const [key, lista] of aristasRegion) {
    if (lista.length !== 1) continue;
    const n = normalCoherente(lista[0].cara);
    if (!n) continue;
    const fc = centroideCara(mesh, mesh.faces[region[lista[0].cara]]);
    if (!fc) continue;
    for (const vecina of carasDeArista.get(key) ?? []) {
      if (setRegion.has(vecina)) continue;
      const cn = centroideCara(mesh, mesh.faces[vecina]);
      if (!cn) continue;
      const dx = cn.x - fc.x, dy = cn.y - fc.y, dz = cn.z - fc.z;
      const dot = dx * n.x + dy * n.y + dz * n.z;
      if (dot > 1e-9) votosEntrada++;
      else if (dot < -1e-9) votosSalida++;
      break;
    }
  }
  const invertirTodo = votosEntrada > votosSalida;
  const normalAlineada = (i) => {
    const n = normalCoherente(i);
    if (!n) return void 0;
    if (!invertirTodo) return n;
    return { x: -n.x, y: -n.y, z: -n.z };
  };
  const sumaCluster = /* @__PURE__ */ new Map();
  for (let i = 0; i < region.length; i++) {
    const n = normalAlineada(i);
    if (!n) continue;
    for (const cid of caraClusters[i]) {
      const s = sumaCluster.get(cid) ?? { ax: 0, ay: 0, az: 0, n: 0 };
      s.ax += n.x;
      s.ay += n.y;
      s.az += n.z;
      s.n++;
      sumaCluster.set(cid, s);
    }
  }
  const normalDeCluster = /* @__PURE__ */ new Map();
  for (const [cid, s] of sumaCluster) {
    const l = Math.hypot(s.ax, s.ay, s.az);
    if (l < 1e-12) continue;
    normalDeCluster.set(cid, { x: s.ax / l, y: s.ay / l, z: s.az / l });
  }
  for (const [v, cid] of clusterDeVert) {
    const n = normalDeCluster.get(cid);
    if (n) salida.set(v, n);
  }
  return salida;
}
function centroideCara(mesh, cara) {
  let ax = 0, ay = 0, az = 0, n = 0;
  for (const v of cara) {
    const p = mesh.vertices[v];
    if (!p) return null;
    ax += p.x;
    ay += p.y;
    az += p.z;
    n++;
  }
  return n === 0 ? null : { x: ax / n, y: ay / n, z: az / n };
}
function aristasDeMalla(mesh) {
  const vistas = /* @__PURE__ */ new Set();
  const lista = [];
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
function regionSegunObjetivo(mesh, objetivo, carasSel, verticesSel, aristasSel) {
  const total = mesh.faces.length;
  if (objetivo === "cara") {
    return carasSel.filter((f) => f >= 0 && f < total);
  }
  if (objetivo === "vertice") {
    const sel = new Set(verticesSel);
    return mesh.faces.map((_, i) => i).filter((i) => mesh.faces[i].every((v) => sel.has(v)));
  }
  if (objetivo === "segmento") {
    const sel = new Set(aristasSel);
    return mesh.faces.map((_, i) => i).filter((i) => {
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
function extrudeRegionMesh(mesh, carasRegion, delta) {
  const totalCaras = mesh.faces.length;
  const region = carasRegion.filter((f) => f >= 0 && f < totalCaras);
  if (region.length === 0) return null;
  const grado = /* @__PURE__ */ new Map();
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
  const vmap = /* @__PURE__ */ new Map();
  const verticesDuplicados = [];
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
      nx += cxp / l1;
      ny += cyp / l1;
      nz += czp / l1;
      cuenta++;
    }
    if (cuenta > 0) {
      const largo = Math.hypot(nx, ny, nz);
      if (largo > 1e-9) {
        const dot = delta.x * (nx / largo) + delta.y * (ny / largo) + delta.z * (nz / largo);
        dentro = dot < -1e-6;
      }
    }
  }
  const mapaAristas = /* @__PURE__ */ new Map();
  const tapas = [];
  for (const idx of region) {
    const cara = mesh.faces[idx];
    const copia = cara.map((v) => vmap.get(v) ?? v);
    tapas.push({ copia, base: idx });
  }
  const nuevasParedes = [];
  const basesDePared = [];
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
  const regionSet = new Set(region);
  const coloresVieja = mesh.faceColors ?? null;
  const opacidadesVieja = mesh.faceOpacities ?? null;
  const texturasVieja = mesh.faceTextures ?? null;
  const gruposVieja = mesh.faceTextureGroups ?? null;
  const facesFinal = [];
  const colores = coloresVieja ? [] : null;
  const opacidades = opacidadesVieja ? [] : null;
  const texturas = texturasVieja ? [] : null;
  const grupos = gruposVieja ? [] : null;
  for (let i = 0; i < mesh.faces.length; i++) {
    if (dentro && regionSet.has(i)) continue;
    facesFinal.push(mesh.faces[i]);
    if (colores) colores.push(coloresVieja[i] ?? null);
    if (opacidades) opacidades.push(opacidadesVieja[i] ?? 1);
    if (texturas) texturas.push(texturasVieja[i] ?? null);
    if (grupos) grupos.push(gruposVieja[i] ?? null);
  }
  const carasNuevas = [];
  const paredes = [];
  const hereda = (nueva, base) => {
    if (colores) colores[nueva] = coloresVieja[base] ?? null;
    if (opacidades) opacidades[nueva] = opacidadesVieja[base] ?? 1;
    if (texturas) texturas[nueva] = texturasVieja[base] ?? null;
    if (grupos) grupos[nueva] = gruposVieja[base] ?? null;
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
  let uvs;
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    uvs = [...mesh.uvs];
    for (const [orig, dup] of vmap) {
      uvs[dup] = uvs[orig] ?? uvs[dup];
    }
  }
  const resultado = {
    ...mesh,
    vertices,
    faces: facesFinal
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
    haciaDentro: dentro
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  aristasDeMalla,
  extrudeRegionMesh,
  normalesSuavizadasDeRegion,
  regionSegunObjetivo
});
