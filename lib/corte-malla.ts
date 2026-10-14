import * as THREE from 'three';
import type { Mesh, Vertex3D } from '@/lib/geometry';

/**
 * CORTE POR TRAZADO (botón «Corte», cuchillo): el usuario dibuja una
 * polilínea discontinua sobre la ventana; cada segmento consecutivo
 * define el PLANO que pasa por la cámara y las dos direcciones de rayo, y
 * cada plano parte las caras FRONTALES que atraviesa — en SECUENCIA (cada
 * plano ve el resultado del anterior, así los rincones del polígono dentro
 * de una cara emergen como cruces de la cuerda del plano anterior y se
 * sueldan con la otra mitad: el lazo cierra solo).
 *
 * Al cerrar el lazo, el interior queda seleccionado: caras finales
 * frontales cuyo centroide proyecta dentro de la figura en pantalla (la
 * misma semántica del polígono del botón «Seleccionar»).
 *
 * Los vértices SOLO crecen (arrays por vértice intactos); los arrays por
 * cara (color/opacidad/textura/grupo) viajan por antepasado con el patrón
 * de borrarCarasRegion (lib/seleccion-operaciones.ts). Los cruces
 * coincidentes se SUELDAN por celda cuantizada: mismos índices en aristas
 * compartidas entre caras vecinas.
 */

export type RayoCorte = { o: [number, number, number]; d: [number, number, number] };

export type TrazadoCorte = {
  /** Posición de la cámara en espacio LOCAL de la malla. */
  camara: [number, number, number];
  /**
   * Rayo por punto dibujado (origen + dirección NORMALIZADA, espacio
   * local). Objeto aparte por punto: en ortográfica (ventana 2D) los
   * rayos son PARALELOS y el plano del segmento vive entre sus orígenes.
   */
  rayos: RayoCorte[];
  /** Puntos dibujados en px del CANVAS (clientX − rect.left, etc.). */
  pantalla: Array<{ x: number; y: number }>;
  /** 16 números (Matrix4.elements, columna mayor): local → px del canvas. */
  matriz: number[];
  /** Trazado cerrado (≥ 3 puntos): corta Y selecciona el interior. */
  cerrado: boolean;
};

export type ResultadoCorte = {
  mesh: Mesh;
  /** Caras del INTERIOR del lazo en la malla NUEVA. */
  carasInterior: number[];
  /** Toda arista de corte nueva (cuerdas del trazado), clave «min-max». */
  aristasCorte: string[];
  /** Aristas «a-b» de las caras interiores (selección objetivo «todo»). */
  aristasInterior: string[];
  /** Unión de los anillos de las caras interiores. */
  verticesCorte: number[];
};

/** Datos por cara que viajan con cada pieza del corte (por antepasado). */
type DatosCara = {
  color?: string | null;
  op?: number;
  tex?: string | null;
  grupo?: string | null;
  origen: number;
};

/** Reja de alcance (px): cruce válido solo junto al segmento dibujado. */
const REJILLA_PX = 24;
/** Rescate de PARES (px): los dos extremos de un par de cruces admiten
 * hasta 4× de reja — sin rescate, un lazo cerrado sobre una cara GRANDE no
 * cortaría nada (los cruces caen a los lados del span del segmento). */
const RESCUE_PX = REJILLA_PX * 4;

export function cortarMallaPorTrazado(
  mesh: Mesh,
  trazado: TrazadoCorte
): ResultadoCorte | { error: string } {
  if (!mesh.vertices.length || !mesh.faces.length) {
    return { error: 'malla-vacia' };
  }
  const pantalla = trazado.pantalla ?? [];
  if (!trazado.rayos || trazado.rayos.length !== pantalla.length) {
    return { error: 'sin-trazado' };
  }
  // Dedupe: dos puntos casi idénticos (doble clic) = mismo punto.
  const puntos: Array<{ x: number; y: number }> = [];
  for (const p of pantalla) {
    const ult = puntos[puntos.length - 1];
    if (!ult || Math.hypot(p.x - ult.x, p.y - ult.y) > 0.5) {
      puntos.push({ x: p.x, y: p.y });
    }
  }
  const rayos = trazado.rayos.slice(0, puntos.length);
  if (puntos.length < 2) return { error: 'sin-trazado' };
  const cerrado = trazado.cerrado === true && puntos.length >= 3;

  const camara = new THREE.Vector3(trazado.camara[0], trazado.camara[1], trazado.camara[2]);
  const dirDe = (k: number) => {
    const d = rayos[k].d;
    return new THREE.Vector3(d[0], d[1], d[2]);
  };
  const origEn = (k: number) => {
    const o = rayos[k].o;
    return new THREE.Vector3(o[0], o[1], o[2]);
  };

  // ── Soldadura global: celda cuantizada, vecinos en las 27 celdas ────────
  let diag = 0;
  for (const v of mesh.vertices) {
    diag = Math.max(diag, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  }
  const eps = Math.max(1e-6, 1e-6 * diag);
  const snapR = Math.max(eps * 2, 1e-5 * diag); // pega el cruce al vértice cercano

  const vertices: Vertex3D[] = mesh.vertices.map((v) => ({ ...v }));
  const nuevosUvs: Array<[number, number]> = [];
  const celdaDe = (p: THREE.Vector3) =>
    `${Math.round(p.x / eps)},${Math.round(p.y / eps)},${Math.round(p.z / eps)}`;
  const celdas = new Map<string, number>(); // celda → índice de vértice
  vertices.forEach((v, i) =>
    celdas.set(celdaDe(new THREE.Vector3(v.x, v.y, v.z)), i)
  );

  /**
   * Devuelve el índice del vértice en «punto»: reusa el existente si hay
   * uno dentro de snapR (evita T-vértices y suelda cruces coincidentes de
   * segmentos distintos), o inserta uno nuevo con UV interpolada.
   */
  const verticeEn = (
    punto: THREE.Vector3,
    uv: (() => [number, number]) | null
  ): number => {
    const cx = Math.round(punto.x / eps);
    const cy = Math.round(punto.y / eps);
    const cz = Math.round(punto.z / eps);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const idx = celdas.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (idx === undefined) continue;
          const w = vertices[idx];
          if (
            Math.abs(w.x - punto.x) <= snapR &&
            Math.abs(w.y - punto.y) <= snapR &&
            Math.abs(w.z - punto.z) <= snapR
          ) {
            return idx;
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

  // ── Estado por cara: anillos + datos por antepasado ─────────────────────
  const anillos: number[][] = mesh.faces.map((f) => f.slice());
  const uvsOk = !!mesh.uvs && mesh.uvs.length === mesh.vertices.length;
  const datos: DatosCara[] = mesh.faces.map((_, i) => ({
    origen: i,
    color: mesh.faceColors?.[i] ?? null,
    op: mesh.faceOpacities?.[i] ?? 1,
    tex: mesh.faceTextures?.[i] ?? null,
    grupo: mesh.faceTextureGroups?.[i] ?? null,
  }));
  const uvsDe = (idx: number): [number, number] => {
    const uv = mesh.uvs?.[idx];
    return uv ? [uv[0], uv[1]] : [0, 0];
  };

  const aristasCorte = new Set<string>();

  /**
   * Parta el anillo con índice `fi` según los cruces en orden (cada cruce
   * vive en una ARISTA del anillo: entre el vértice en posición «arista» y
   * el siguiente). Par de cruces: dos anillos hijos + arista de corte;
   * impar: el trazado TERMINA dentro de la cara — solo queda el vértice.
   */
  const parteAnillo = (
    fi: number,
    eventos: Array<{ arista: number; vert: number; prevVert?: boolean }>
  ) => {
    if (eventos.length === 0) return;
    eventos.sort((a, b) => a.arista - b.arista);
    const anillo = anillos[fi];
    const len = anillo.length;

    if (eventos.length % 2 === 1) {
      // Línea abierta que acaba dentro de la cara: los puntos dibujados
      // quedan como vértices del anillo (el «dibujo en vértices»). Un
      // cruce que recae en un vértice DEL ANILLO ya está: no se reinserta.
      const nuevo = anillo.slice();
      for (let i = eventos.length - 1; i >= 0; i--) {
        if (eventos[i].prevVert) continue;
        nuevo.splice(eventos[i].arista + 1, 0, eventos[i].vert);
      }
      anillos[fi] = nuevo;
      return;
    }
    // >2 cruces (anillos no convexos): ordenarlos A LO LARGO de la línea
    // de corte y emparejar en serie.
    let orden = eventos;
    if (eventos.length > 2) {
      const n = normalDe(anillo.map((v) => vertices[v]));
      if (n && normalPlanoActual) {
        const u = new THREE.Vector3().crossVectors(normalPlanoActual, n);
        if (u.lengthSq() > 1e-12) {
          u.normalize();
          orden = eventos
            .map((ev) => ({
              ev,
              t: new THREE.Vector3(
                vertices[ev.vert].x,
                vertices[ev.vert].y,
                vertices[ev.vert].z
              ).dot(u),
            }))
            .sort((a, b) => a.t - b.t)
            .map((x) => x.ev);
        }
      }
    }
    for (let i = 0; i < orden.length; i += 2) {
      const p = orden[i];
      const q = orden[i + 1];
      const vp = p.vert;
      const vq = q.vert;
      if (vp === vq) continue; // el trazo toca y sale por el mismo punto
      if (p.arista % len === q.arista % len) continue; // ambos en la MISMA arista: nada que partir
      // Camina del cruce p al cruce q (y vuelta) por el anillo ORIGINAL.
      // INCLUSIVO: ring[q.arista] es el VÉRTICE INICIAL de la arista de q —
      // está ENTRE los dos cruces por este lado (p va hacia q por ahí). El
      // fragmento de la arista de q DESPUÉS de q pertenece a la otra pieza.
      const cadenaA: number[] = [vp];
      for (let j = p.arista + 1; ; j++) {
        const jj = j % len;
        cadenaA.push(anillo[jj]);
        if (jj === q.arista % len) break;
      }
      cadenaA.push(vq);
      const cadenaB: number[] = [vq];
      for (let j = q.arista + 1; ; j++) {
        const jj = j % len;
        cadenaB.push(anillo[jj]);
        if (jj === p.arista % len) break;
      }
      cadenaB.push(vp);
      // Un lado vacío (el corte coincide con una arista existente) no
      // aporta: descartado.
      if (cadenaA.length < 3 || cadenaB.length < 3) continue;
      const clave = `${Math.min(vp, vq)}-${Math.max(vp, vq)}`;
      aristasCorte.add(clave);
      const propio = datos[fi];
      anillos[fi] = cadenaA;
      anillos.push(cadenaB);
      datos.push({ ...propio });
    }
  };

  // ── Corte secuencial por cada segmento del trazado ──────────────────────
  const totalSegs = cerrado ? rayos.length : rayos.length - 1;
  let normalPlanoActual: THREE.Vector3 | null = null;
  for (let k = 0; k < totalSegs; k++) {
    const k1 = (k + 1) % rayos.length;
    const da = dirDe(k);
    const db = dirDe(k1);
    const oa = origEn(k);
    // Normal del plano de los DOS rayos: perspectiva comparte origen
    // (cross de direcciones); ortográfica va paralela (cross de una
    // dirección con el offset entre orígenes).
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
    // Segmento degenerado (dos clics casi iguales en pantalla): sin plano.
    if (nPlano.lengthSq() < 1e-9) continue;
    nPlano.normalize();
    normalPlanoActual = nPlano;

    // Segmento en pantalla: la distancia del cruce (px) al segmento
    // dibujado es la REJA — sin ella el plano infinito cortaría lejos del
    // trazado (por ejemplo en el lado opuesto del objeto).
    const sa = puntos[k];
    const sb = puntos[k1];
    const distSeg = (px: number, py: number) => {
      const vx = sb.x - sa.x;
      const vy = sb.y - sa.y;
      const l2 = vx * vx + vy * vy;
      const t = l2 > 0 ? ((px - sa.x) * vx + (py - sa.y) * vy) / l2 : 0;
      const tc = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (sa.x + tc * vx), py - (sa.y + tc * vy));
    };

    const matriz = new THREE.Matrix4().fromArray(trazado.matriz);
    const proyectaPx = (v: Vertex3D) => {
      const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matriz);
      return { x: p.x, y: p.y };
    };

    const nCaras = anillos.length;
    for (let fi = 0; fi < nCaras; fi++) {
      const anillo = anillos[fi];
      if (anillo.length < 3) continue;
      // FRONT: solo caras que miran a la cámara (la parte trasera queda
      // intacta — el usuario dibuja sobre lo que ve).
      const nCara = normalDe(anillo.map((v) => vertices[v]));
      if (!nCara) continue;
      const v0 = vertices[anillo[0]];
      const aCam = new THREE.Vector3(camara.x - v0.x, camara.y - v0.y, camara.z - v0.z);
      if (nCara.dot(aCam) <= 0) continue;

      // Distancias con signo en una pasada (el plano no atraviesa? fuera).
      const dists: number[] = [];
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

      // Cruces sobre las aristas del anillo (exactos: t = da/(da−db)).
      const eventos: Array<{
        arista: number;
        vert: number;
        px: number;
        py: number;
        prevVert?: boolean;
      }> = [];
      const len2 = anillo.length;
      for (let j = 0; j < len2; j++) {
        const ja = anillo[j];
        const jb = anillo[(j + 1) % len2];
        const dja = dists[j];
        const djb = dists[(j + 1) % len2];
        if (dja === 0) {
          // El vértice YA está en el plano: cruza por él (la arista que
          // entra también lo vería: solo cuenta una vez, la de salida).
          const prev = dists[(j - 1 + len2) % len2];
          if (prev !== 0) {
            const pt = proyectaPx(vertices[ja]);
            if (distSeg(pt.x, pt.y) <= RESCUE_PX) {
              eventos.push({ arista: j, vert: ja, px: pt.x, py: pt.y, prevVert: true });
            }
          }
          continue;
        }
        if (djb === 0) continue; // cuenta como cruce en la arista siguiente
        if (dja < 0 === djb < 0) continue; // mismo lado
        const t = dja / (dja - djb);
        const va = vertices[ja];
        const vb = vertices[jb];
        const punto = new THREE.Vector3(
          va.x + (vb.x - va.x) * t,
          va.y + (vb.y - va.y) * t,
          va.z + (vb.z - va.z) * t
        );
        const ptPx = proyectaPx(punto);
        // Reja gruesa temprana (evita crear vértices que se descartan).
        if (distSeg(ptPx.x, ptPx.y) > RESCUE_PX) continue;
        const vert = verticeEn(
          punto,
          uvsOk
            ? () => {
                const ua = uvsDe(ja);
                const ub = uvsDe(jb);
                return [ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t];
              }
            : null
        );
        eventos.push({ arista: j, vert, px: ptPx.x, py: ptPx.y });
      }
      // REJA de alcance + rescate de pares: solo cruces junto al segmento
      // dibujado; un par de cruces cercano (aunque caiga a ambos lados del
      // span) mantiene la cuerda completa — así el siguiente segmento
      // encuentra su esquina sobre la cuerda y el lazo cierra soldado.
      const distanciaDe = (ev: { px: number; py: number }) => distSeg(ev.px, ev.py);
      let elegidos = eventos.filter((ev) => distanciaDe(ev) <= REJILLA_PX);
      if (elegidos.length === 0) {
        if (
          eventos.length === 2 &&
          eventos.every((ev) => distanciaDe(ev) <= RESCUE_PX)
        ) {
          elegidos = eventos; // par de extremos: cuerda completa (cara grande)
        }
      } else if (elegidos.length % 2 === 1) {
        const resto = eventos
          .filter((ev) => distanciaDe(ev) > REJILLA_PX && distanciaDe(ev) <= RESCUE_PX)
          .sort((a, b) => distanciaDe(a) - distanciaDe(b));
        if (resto.length > 0) {
          elegidos = [...elegidos, resto[0]]; // completa el par con el vecino
        }
      }
      if (elegidos.length === 0) continue;
      parteAnillo(
        fi,
        elegidos.map((ev) => ({ arista: ev.arista, vert: ev.vert }))
      );
    }
  }

  // ── Malla final ──────────────────────────────────────────────────────────
  const resultado: Mesh = { ...mesh, vertices, faces: anillos };
  if (mesh.faceColors) resultado.faceColors = datos.map((d) => d.color ?? null);
  if (mesh.faceOpacities) resultado.faceOpacities = datos.map((d) => d.op ?? 1);
  if (mesh.faceTextures) resultado.faceTextures = datos.map((d) => d.tex ?? null);
  if (mesh.faceTextureGroups) {
    resultado.faceTextureGroups = datos.map((d) => d.grupo ?? null);
  }
  if (uvsOk) {
    // Agujeros = cruce REUSADO (su UV ya existe): relleno neutro.
    while (nuevosUvs.length < vertices.length - mesh.vertices.length) {
      nuevosUvs.push([0, 0]);
    }
    resultado.uvs = [...mesh.uvs!, ...nuevosUvs];
  }

  // ── Interior (solo lazo cerrado) ─────────────────────────────────────────
  const carasInterior: number[] = [];
  let verticesCorte: number[] = [];
  let aristasInterior: string[] = [];
  if (cerrado) {
    const lazo = puntos;
    const dentro = (px: number, py: number) => {
      let ans = false;
      for (let i = 0, j = lazo.length - 1; i < lazo.length; j = i++) {
        const xi = lazo[i].x;
        const yi = lazo[i].y;
        const xj = lazo[j].x;
        const yj = lazo[j].y;
        if (
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
          ans = !ans;
        }
      }
      return ans;
    };
    const matriz = new THREE.Matrix4().fromArray(trazado.matriz);
    const proyectaPx = (v: Vertex3D) => {
      const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matriz);
      return { x: p.x, y: p.y };
    };
    // Primario: centroide del anillo dentro (la pieza del INTERIOR);
    // repliegue: todas las esquinas dentro (concavidad extrema).
    const primario: number[] = [];
    const repliegue: number[] = [];
    for (let fi = 0; fi < anillos.length; fi++) {
      const anillo = anillos[fi];
      if (anillo.length < 3) continue;
      const nCara = normalDe(anillo.map((v) => vertices[v]));
      if (!nCara) continue;
      const v0 = vertices[anillo[0]];
      if (nCara.dot(new THREE.Vector3(v0.x - camara.x, v0.y - camara.y, v0.z - camara.z)) >= 0) {
        continue; // cara trasera: no se ve, no se selecciona
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
      } else if (
        anillo.every((vi) => {
          const p = proyectaPx(vertices[vi]);
          return dentro(p.x, p.y);
        })
      ) {
        repliegue.push(fi);
      }
    }
    const elegidas = primario.length > 0 ? primario : repliegue;
    carasInterior.push(...elegidas);
    const vSet = new Set<number>();
    const aSet = new Set<string>();
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
    return { error: 'nada-cortado' };
  }

  return {
    mesh: resultado,
    carasInterior,
    aristasCorte: [...aristasCorte],
    aristasInterior,
    verticesCorte,
  };
}

/** Normal del anillo (regla de Newell) en espacio local. */
function normalDe(anillo: Vertex3D[]): THREE.Vector3 | null {
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