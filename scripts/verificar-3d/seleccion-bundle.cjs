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

// lib/seleccion-operaciones.ts
var seleccion_operaciones_exports = {};
__export(seleccion_operaciones_exports, {
  borrarCarasRegion: () => borrarCarasRegion,
  hornearEnMundo: () => hornearEnMundo,
  submallaDeRegion: () => submallaDeRegion
});
module.exports = __toCommonJS(seleccion_operaciones_exports);
var THREE = __toESM(require("three"));
function borrarCarasRegion(mesh, carasRegion) {
  const total = mesh.faces.length;
  const region = [...new Set(carasRegion.filter((f) => f >= 0 && f < total))];
  if (region.length === 0 || region.length === total) return null;
  const regionSet = new Set(region);
  const colores = mesh.faceColors ?? null;
  const opacidades = mesh.faceOpacities ?? null;
  const texturas = mesh.faceTextures ?? null;
  const grupos = mesh.faceTextureGroups ?? null;
  const faces = [];
  const coloresFinal = colores ? [] : null;
  const opacidadesFinal = opacidades ? [] : null;
  const texturasFinal = texturas ? [] : null;
  const gruposFinal = grupos ? [] : null;
  for (let i = 0; i < total; i++) {
    if (regionSet.has(i)) continue;
    faces.push(mesh.faces[i]);
    if (coloresFinal) coloresFinal.push(colores[i] ?? null);
    if (opacidadesFinal) opacidadesFinal.push(opacidades[i] ?? 1);
    if (texturasFinal) texturasFinal.push(texturas[i] ?? null);
    if (gruposFinal) gruposFinal.push(grupos[i] ?? null);
  }
  const resultado = { ...mesh, faces };
  if (coloresFinal) resultado.faceColors = coloresFinal;
  if (opacidadesFinal) resultado.faceOpacities = opacidadesFinal;
  if (texturasFinal) resultado.faceTextures = texturasFinal;
  if (gruposFinal) resultado.faceTextureGroups = gruposFinal;
  return resultado;
}
function submallaDeRegion(mesh, carasRegion) {
  const total = mesh.faces.length;
  const region = [...new Set(carasRegion.filter((f) => f >= 0 && f < total))];
  if (region.length === 0) return null;
  if (mesh.vertices.length === 0) return null;
  const mapaVertices = /* @__PURE__ */ new Map();
  const vertices = [];
  for (const idx of region) {
    for (const v of mesh.faces[idx]) {
      if (mapaVertices.has(v)) continue;
      mapaVertices.set(v, vertices.length);
      vertices.push(mesh.vertices[v] ?? { x: 0, y: 0, z: 0 });
    }
  }
  if (vertices.length === 0) return null;
  const colores = mesh.faceColors ?? null;
  const opacidades = mesh.faceOpacities ?? null;
  const texturas = mesh.faceTextures ?? null;
  const grupos = mesh.faceTextureGroups ?? null;
  const faces = [];
  const coloresFinal = colores ? [] : null;
  const opacidadesFinal = opacidades ? [] : null;
  const texturasFinal = texturas ? [] : null;
  const gruposFinal = grupos ? [] : null;
  for (const idx of region) {
    const cara = mesh.faces[idx];
    const remap = cara.map((v) => mapaVertices.get(v));
    if (remap.some((v) => v === void 0)) continue;
    faces.push(remap);
    if (coloresFinal) coloresFinal.push(colores[idx] ?? null);
    if (opacidadesFinal) opacidadesFinal.push(opacidades[idx] ?? 1);
    if (texturasFinal) texturasFinal.push(texturas[idx] ?? null);
    if (gruposFinal) gruposFinal.push(grupos[idx] ?? null);
  }
  if (faces.length === 0) return null;
  let uvs;
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    const origDeNuevo = /* @__PURE__ */ new Map();
    for (const [orig, nuevo] of mapaVertices) origDeNuevo.set(nuevo, orig);
    uvs = vertices.map((_, nuevo) => mesh.uvs[origDeNuevo.get(nuevo) ?? 0] ?? [0, 0]);
  }
  const resultado = { ...mesh, vertices, faces };
  if (coloresFinal) resultado.faceColors = coloresFinal;
  if (opacidadesFinal) resultado.faceOpacities = opacidadesFinal;
  if (texturasFinal) resultado.faceTextures = texturasFinal;
  if (gruposFinal) resultado.faceTextureGroups = gruposFinal;
  if (uvs) resultado.uvs = uvs;
  return { mesh: resultado, mapaVertices };
}
function hornearEnMundo(mesh, transform) {
  if (mesh.vertices.length === 0) {
    return { mesh: { ...mesh }, transform: { ...transform ?? {} } };
  }
  const p = new THREE.Vector3(
    transform?.px ?? 0,
    transform?.py ?? 0,
    transform?.pz ?? 0
  );
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(transform?.rx ?? 0, transform?.ry ?? 0, transform?.rz ?? 0)
  );
  const s = new THREE.Vector3(
    transform?.sx ?? 1,
    transform?.sy ?? 1,
    transform?.sz ?? 1
  );
  const mundo = mesh.vertices.map(
    (v) => new THREE.Vector3(v.x * s.x, v.y * s.y, v.z * s.z).applyQuaternion(quat).add(p)
  );
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const w of mundo) {
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.z < minZ) minZ = w.z;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
    if (w.z > maxZ) maxZ = w.z;
  }
  const centro = new THREE.Vector3(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2
  );
  const vertices = mundo.map((w) => ({
    x: w.x - centro.x,
    y: w.y - centro.y,
    z: w.z - centro.z
  }));
  const resultado = { ...mesh, vertices };
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    resultado.uvs = [...mesh.uvs];
  }
  return {
    mesh: resultado,
    transform: {
      px: centro.x,
      py: centro.y,
      pz: centro.z,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 1,
      sy: 1,
      sz: 1
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  borrarCarasRegion,
  hornearEnMundo,
  submallaDeRegion
});
