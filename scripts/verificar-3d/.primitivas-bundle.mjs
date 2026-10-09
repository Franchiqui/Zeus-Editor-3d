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
  }
}
export {
  construirMallaPrimitiva,
  normalizarParams,
  paramsDeArchivo
};
