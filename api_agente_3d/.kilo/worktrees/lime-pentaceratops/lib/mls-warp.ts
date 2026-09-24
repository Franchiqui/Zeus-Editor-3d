// Deformación Moving Least Squares (Schaefer et al. 2006, "Image Deformation Using
// Moving Least Squares"). Dado un conjunto de puntos de control p[i] (frame 0) y
// sus posiciones deformadas q[i] (frame N), calcula la posición deformada de
// cualquier punto v de forma SUAVE y no-rígida (distinta en cada región): es el
// "puppet warp" estándar. Se aplica a los paths Bézier del lazo para que la
// silueta siga al objeto deformándose (rotación + escala uniforme, sin shear).
//
// Variante SIMILARITY (por defecto): scale+rotación uniforme preservando la forma
// (no shear). Es la mejor para un recorte preciso: la silueta sigue al objeto
// rotando/redimensionándose sin distorsionarse. Fórmula en complejos (2D):
//   z = Σ w_i · q̂_i · conj(p̂_i)  /  Σ w_i · |p̂_i|²     (z = scale·e^{iθ})
//   f(v) = q* + z · (v − p*)
// Variante RIGID: z normalizado a módulo 1 (solo rotación, sin resize).
//
// Los puntos y los paths están en % (0-100) del área de vídeo. Se deforman anclas
// y mangos por igual. Si hay <2 puntos buenos → traslación pura (q* − p*).

import type { BezierAnchor } from '@/types';

export type MLSVariant = 'similarity' | 'rigid';

interface Pt { x: number; y: number }

// Multiplicación compleja: (a) * (b). Representamos z = a.x + a.y·i.
function cmul(a: Pt, b: Pt): Pt {
  return { x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x };
}
// Conjugado.
function conj(a: Pt): Pt { return { x: a.x, y: -a.y }; }

/**
 * Deforma un punto `v` con MLS (variant similarity/rigid) dados los controles
 * p (origen) y q (destino). ε evita división por cero cuando v coincide con un p_i.
 */
function warpPointMLS(v: Pt, p: Pt[], q: Pt[], variant: MLSVariant, eps = 1e-6): Pt {
  const n = p.length;
  if (n === 0) return v;
  if (n === 1) return { x: v.x + (q[0].x - p[0].x), y: v.y + (q[0].y - p[0].y) };

  let W = 0;
  let pStarX = 0, pStarY = 0;
  let qStarX = 0, qStarY = 0;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const dx = p[i].x - v.x;
    const dy = p[i].y - v.y;
    w[i] = 1 / (dx * dx + dy * dy + eps);
    W += w[i];
    pStarX += w[i] * p[i].x; pStarY += w[i] * p[i].y;
    qStarX += w[i] * q[i].x; qStarY += w[i] * q[i].y;
  }
  pStarX /= W; pStarY /= W;
  qStarX /= W; qStarY /= W;

  // num = Σ w_i · q̂_i · conj(p̂_i)  (complejo)
  // den = Σ w_i · |p̂_i|²            (real)
  let numX = 0, numY = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const phx = p[i].x - pStarX;
    const phy = p[i].y - pStarY;
    const qhx = q[i].x - qStarX;
    const qhy = q[i].y - qStarY;
    // q̂_i * conj(p̂_i) = (qhx + qhy·i)(phx − phy·i)
    //   = (qhx*phx + qhy*phy) + (qhy*phx − qhx*phy)·i
    numX += w[i] * (qhx * phx + qhy * phy);
    numY += w[i] * (qhy * phx - qhx * phy);
    den += w[i] * (phx * phx + phy * phy);
  }

  if (den <= 1e-9) {
    // Todos los p̂ alineados en un punto → traslación pura.
    return { x: v.x + (qStarX - pStarX), y: v.y + (qStarY - pStarY) };
  }

  let zX = numX / den;
  let zY = numY / den;
  if (variant === 'rigid') {
    const mag = Math.hypot(zX, zY);
    if (mag > 1e-9) { zX /= mag; zY /= mag; }
  }

  // f(v) = q* + z · (v − p*)
  const d = { x: v.x - pStarX, y: v.y - pStarY };
  const zd = cmul({ x: zX, y: zY }, d);
  return { x: qStarX + zd.x, y: qStarY + zd.y };
}

/**
 * Deforma los paths Bézier del lazo con MLS. p = posiciones de los puntos de
 * control en el frame 0, q = en el frame destino (mismo orden; en % 0-100).
 * Solo se pasan los puntos CON FIABILIDAD (el caller filtra los perdidos).
 * Devuelve nuevos paths (anclas + mangos deformados).
 */
export function warpPathsMLS(
  paths: BezierAnchor[][] | undefined | null,
  p: Pt[],
  q: Pt[],
  variant: MLSVariant = 'similarity',
): BezierAnchor[][] {
  if (!paths || paths.length === 0 || p.length === 0) return paths ?? [];
  return paths.map((anchors) =>
    anchors.map((a) => {
      const pt = warpPointMLS({ x: a.x, y: a.y }, p, q, variant);
      const hIn = warpPointMLS({ x: a.hInX, y: a.hInY }, p, q, variant);
      const hOut = warpPointMLS({ x: a.hOutX, y: a.hOutY }, p, q, variant);
      return {
        x: pt.x, y: pt.y,
        hInX: hIn.x, hInY: hIn.y,
        hOutX: hOut.x, hOutY: hOut.y,
      };
    }),
  );
}