"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/corte-malla.ts
var corte_malla_exports = {};
__export(corte_malla_exports, {
  cortarMallaPorTrazado: () => cortarMallaPorTrazado
});
module.exports = __toCommonJS(corte_malla_exports);
var THREE = __toESM(require("three"));
var REJILLA_PX = 24;
var RESCUE_PX = REJILLA_PX * 4;
function cortarMallaPorTrazado(mesh, trazado) {
  if (!mesh.vertices.length || !mesh.faces.length) {
    return { error: "malla-vacia" };
  }
  const pantalla = trazado.pantalla ?? [];
  if (!trazado.rayos || trazado.rayos.length !== pantalla.length) {
    return { error: "sin-trazado" };
  }
  const puntos = [];
  for (const p of pantalla) {
    const ult = puntos[puntos.length - 1];
    if (!ult || Math.hypot(p.x - ult.x, p.y - ult.y) > 0.5) {
      puntos.push({ x: p.x, y: p.y });
    }
  }
  const rayos = trazado.rayos.slice(0, puntos.length);
  if (puntos.length < 2) return { error: "sin-trazado" };
  const cerrado = trazado.cerrado === true && puntos.length >= 3;
  const camara = new THREE.Vector3(trazado.camara[0], trazado.camara[1], trazado.camara[2]);
  const dirDe = (k) => {
    const d = rayos[k].d;
    return new THREE.Vector3(d[0], d[1], d[2]);
  };
  const origEn = (k) => {
    const o = rayos[k].o;
    return new THREE.Vector3(o[0], o[1], o[2]);
  };
  let diag = 0;
  for (const v of mesh.vertices) {
    diag = Math.max(diag, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  }
  const eps = Math.max(1e-6, 1e-6 * diag);
  const snapR = Math.max(eps * 2, 1e-5 * diag);
  const vertices = mesh.vertices.map((v) => ({ ...v }));
  const nuevosUvs = [];
  const celdaDe = (p) => `${Math.round(p.x / eps)},${Math.round(p.y / eps)},${Math.round(p.z / eps)}`;
  const celdas = /* @__PURE__ */ new Map();
  vertices.forEach(
    (v, i) => celdas.set(celdaDe(new THREE.Vector3(v.x, v.y, v.z)), i)
  );
  const verticeEn = (punto, uv) => {
    const cx = Math.round(punto.x / eps);
    const cy = Math.round(punto.y / eps);
    const cz = Math.round(punto.z / eps);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const idx2 = celdas.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (idx2 === void 0) continue;
          const w = vertices[idx2];
          if (Math.abs(w.x - punto.x) <= snapR && Math.abs(w.y - punto.y) <= snapR && Math.abs(w.z - punto.z) <= snapR) {
            return idx2;
          }
        }
      }
    }
    const idx = vertices.length;
    vertices.push({ x: punto.x, y: punto.y, z: punto.z });
    if (uv) nuevosUvs[idx - mesh.vertices.length] = uv();
    celdas.set(`${cx},${cy},${cz}`, idx);
    return idx;
  };
  const anillos = mesh.faces.map((f) => f.slice());
  const uvsOk = !!mesh.uvs && mesh.uvs.length === mesh.vertices.length;
  const datos = mesh.faces.map((_, i) => ({
    origen: i,
    color: mesh.faceColors?.[i] ?? null,
    op: mesh.faceOpacities?.[i] ?? 1,
    tex: mesh.faceTextures?.[i] ?? null,
    grupo: mesh.faceTextureGroups?.[i] ?? null
  }));
  const uvsDe = (idx) => {
    const uv = mesh.uvs?.[idx];
    return uv ? [uv[0], uv[1]] : [0, 0];
  };
  const aristasCorte = /* @__PURE__ */ new Set();
  const parteAnillo = (fi, eventos) => {
    if (eventos.length === 0) return;
    eventos.sort((a, b) => a.arista - b.arista);
    const anillo = anillos[fi];
    const len = anillo.length;
    if (eventos.length % 2 === 1) {
      const nuevo = anillo.slice();
      for (let i = eventos.length - 1; i >= 0; i--) {
        if (eventos[i].prevVert) continue;
        nuevo.splice(eventos[i].arista + 1, 0, eventos[i].vert);
      }
      anillos[fi] = nuevo;
      return;
    }
    let orden = eventos;
    if (eventos.length > 2) {
      const n = normalDe(anillo.map((v) => vertices[v]));
      if (n && normalPlanoActual) {
        const u = new THREE.Vector3().crossVectors(normalPlanoActual, n);
        if (u.lengthSq() > 1e-12) {
          u.normalize();
          orden = eventos.map((ev) => ({
            ev,
            t: new THREE.Vector3(
              vertices[ev.vert].x,
              vertices[ev.vert].y,
              vertices[ev.vert].z
            ).dot(u)
          })).sort((a, b) => a.t - b.t).map((x) => x.ev);
        }
      }
    }
    for (let i = 0; i < orden.length; i += 2) {
      const p = orden[i];
      const q = orden[i + 1];
      const vp = p.vert;
      const vq = q.vert;
      if (vp === vq) continue;
      if (p.arista % len === q.arista % len) continue;
      const cadenaA = [vp];
      for (let j = p.arista + 1; ; j++) {
        const jj = j % len;
        cadenaA.push(anillo[jj]);
        if (jj === q.arista % len) break;
      }
      cadenaA.push(vq);
      const cadenaB = [vq];
      for (let j = q.arista + 1; ; j++) {
        const jj = j % len;
        cadenaB.push(anillo[jj]);
        if (jj === p.arista % len) break;
      }
      cadenaB.push(vp);
      if (cadenaA.length < 3 || cadenaB.length < 3) continue;
      const clave = `${Math.min(vp, vq)}-${Math.max(vp, vq)}`;
      aristasCorte.add(clave);
      const propio = datos[fi];
      anillos[fi] = cadenaA;
      anillos.push(cadenaB);
      datos.push({ ...propio });
    }
  };
  const totalSegs = cerrado ? rayos.length : rayos.length - 1;
  let normalPlanoActual = null;
  for (let k = 0; k < totalSegs; k++) {
    const k1 = (k + 1) % rayos.length;
    const da = dirDe(k);
    const db = dirDe(k1);
    const oa = origEn(k);
    let nPlano = new THREE.Vector3().crossVectors(da, db);
    if (nPlano.lengthSq() < 1e-9) {
      nPlano = new THREE.Vector3().crossVectors(
        da,
        origEn(k1).sub(oa)
      );
    }
    if (nPlano.lengthSq() < 1e-9) {
      nPlano = new THREE.Vector3().crossVectors(
        db,
        origEn(k1).sub(oa)
      );
    }
    if (nPlano.lengthSq() < 1e-9) continue;
    nPlano.normalize();
    normalPlanoActual = nPlano;
    const sa = puntos[k];
    const sb = puntos[k1];
    const distSeg = (px, py) => {
      const vx = sb.x - sa.x;
      const vy = sb.y - sa.y;
      const l2 = vx * vx + vy * vy;
      const t = l2 > 0 ? ((px - sa.x) * vx + (py - sa.y) * vy) / l2 : 0;
      const tc = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (sa.x + tc * vx), py - (sa.y + tc * vy));
    };
    const matriz = new THREE.Matrix4().fromArray(trazado.matriz);
    const proyectaPx = (v) => {
      const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matriz);
      return { x: p.x, y: p.y };
    };
    const nCaras = anillos.length;
    for (let fi = 0; fi < nCaras; fi++) {
      const anillo = anillos[fi];
      if (anillo.length < 3) continue;
      const nCara = normalDe(anillo.map((v) => vertices[v]));
      if (!nCara) continue;
      const v0 = vertices[anillo[0]];
      const aCam = new THREE.Vector3(camara.x - v0.x, camara.y - v0.y, camara.z - v0.z);
      if (nCara.dot(aCam) <= 0) continue;
      const dists = [];
      let dMin = Infinity;
      let dMax = -Infinity;
      for (const vi of anillo) {
        const v = vertices[vi];
        const dv = nPlano.dot(
          new THREE.Vector3(v.x - oa.x, v.y - oa.y, v.z - oa.z)
        );
        dists.push(dv);
        if (dv < dMin) dMin = dv;
        if (dv > dMax) dMax = dv;
      }
      if (dMin > 0 || dMax < 0) continue;
      const eventos = [];
      const len2 = anillo.length;
      for (let j = 0; j < len2; j++) {
        const ja = anillo[j];
        const jb = anillo[(j + 1) % len2];
        const dja = dists[j];
        const djb = dists[(j + 1) % len2];
        if (dja === 0) {
          const prev = dists[(j - 1 + len2) % len2];
          if (prev !== 0) {
            const pt = proyectaPx(vertices[ja]);
            if (distSeg(pt.x, pt.y) <= RESCUE_PX) {
              eventos.push({ arista: j, vert: ja, px: pt.x, py: pt.y, prevVert: true });
            }
          }
          continue;
        }
        if (djb === 0) continue;
        if (dja < 0 === djb < 0) continue;
        const t = dja / (dja - djb);
        const va = vertices[ja];
        const vb = vertices[jb];
        const punto = new THREE.Vector3(
          va.x + (vb.x - va.x) * t,
          va.y + (vb.y - va.y) * t,
          va.z + (vb.z - va.z) * t
        );
        const ptPx = proyectaPx(punto);
        if (distSeg(ptPx.x, ptPx.y) > RESCUE_PX) continue;
        const vert = verticeEn(
          punto,
          uvsOk ? () => {
            const ua = uvsDe(ja);
            const ub = uvsDe(jb);
            return [ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t];
          } : null
        );
        eventos.push({ arista: j, vert, px: ptPx.x, py: ptPx.y });
      }
      const distanciaDe = (ev) => distSeg(ev.px, ev.py);
      let elegidos = eventos.filter((ev) => distanciaDe(ev) <= REJILLA_PX);
      if (elegidos.length === 0) {
        if (eventos.length === 2 && eventos.every((ev) => distanciaDe(ev) <= RESCUE_PX)) {
          elegidos = eventos;
        }
      } else if (elegidos.length % 2 === 1) {
        const resto = eventos.filter((ev) => distanciaDe(ev) > REJILLA_PX && distanciaDe(ev) <= RESCUE_PX).sort((a, b) => distanciaDe(a) - distanciaDe(b));
        if (resto.length > 0) {
          elegidos = [...elegidos, resto[0]];
        }
      }
      if (elegidos.length === 0) continue;
      parteAnillo(
        fi,
        elegidos.map((ev) => ({ arista: ev.arista, vert: ev.vert }))
      );
    }
  }
  const resultado = { ...mesh, vertices, faces: anillos };
  if (mesh.faceColors) resultado.faceColors = datos.map((d) => d.color ?? null);
  if (mesh.faceOpacities) resultado.faceOpacities = datos.map((d) => d.op ?? 1);
  if (mesh.faceTextures) resultado.faceTextures = datos.map((d) => d.tex ?? null);
  if (mesh.faceTextureGroups) {
    resultado.faceTextureGroups = datos.map((d) => d.grupo ?? null);
  }
  if (uvsOk) {
    while (nuevosUvs.length < vertices.length - mesh.vertices.length) {
      nuevosUvs.push([0, 0]);
    }
    resultado.uvs = [...mesh.uvs, ...nuevosUvs];
  }
  const carasInterior = [];
  let verticesCorte = [];
  let aristasInterior = [];
  if (cerrado) {
    const lazo = puntos;
    const dentro = (px, py) => {
      let ans = false;
      for (let i = 0, j = lazo.length - 1; i < lazo.length; j = i++) {
        const xi = lazo[i].x;
        const yi = lazo[i].y;
        const xj = lazo[j].x;
        const yj = lazo[j].y;
        if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
          ans = !ans;
        }
      }
      return ans;
    };
    const matriz = new THREE.Matrix4().fromArray(trazado.matriz);
    const proyectaPx = (v) => {
      const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matriz);
      return { x: p.x, y: p.y };
    };
    const primario = [];
    const repliegue = [];
    for (let fi = 0; fi < anillos.length; fi++) {
      const anillo = anillos[fi];
      if (anillo.length < 3) continue;
      const nCara = normalDe(anillo.map((v) => vertices[v]));
      if (!nCara) continue;
      const v0 = vertices[anillo[0]];
      if (nCara.dot(new THREE.Vector3(v0.x - camara.x, v0.y - camara.y, v0.z - camara.z)) >= 0) {
        continue;
      }
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const vi of anillo) {
        cx += vertices[vi].x;
        cy += vertices[vi].y;
        cz += vertices[vi].z;
      }
      const px = proyectaPx({ x: cx / anillo.length, y: cy / anillo.length, z: cz / anillo.length });
      if (dentro(px.x, px.y)) {
        primario.push(fi);
      } else if (anillo.every((vi) => {
        const p = proyectaPx(vertices[vi]);
        return dentro(p.x, p.y);
      })) {
        repliegue.push(fi);
      }
    }
    const elegidas = primario.length > 0 ? primario : repliegue;
    carasInterior.push(...elegidas);
    const vSet = /* @__PURE__ */ new Set();
    const aSet = /* @__PURE__ */ new Set();
    for (const fi of elegidas) {
      const anillo = anillos[fi];
      for (let j = 0; j < anillo.length; j++) {
        const a = anillo[j];
        const b = anillo[(j + 1) % anillo.length];
        vSet.add(a);
        vSet.add(b);
        aSet.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
      }
    }
    verticesCorte = [...vSet];
    aristasInterior = [...aSet];
  }
  if (carasInterior.length === 0 && aristasCorte.size === 0) {
    return { error: "nada-cortado" };
  }
  return {
    mesh: resultado,
    carasInterior,
    aristasCorte: [...aristasCorte],
    aristasInterior,
    verticesCorte
  };
}
function normalDe(anillo) {
  const n = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < anillo.length; i++) {
    const a = anillo[i];
    const b = anillo[(i + 1) % anillo.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.lengthSq() > 1e-18 ? n : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cortarMallaPorTrazado
});
