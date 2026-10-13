// lib/extrusion-seleccion.ts
function claveArista(a, b) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
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
export {
  aristasDeMalla,
  extrudeRegionMesh,
  regionSegunObjetivo
};
