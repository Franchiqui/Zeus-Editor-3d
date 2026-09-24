import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import * as opentype from 'opentype.js';

// ---------------------------------------------------------------------------
// Proxy de Google Fonts para el editor de fuentes.
// El navegador no puede descargar el TTF directamente (CORS), así que esta
// ruta hace de puente: descarga el TTF (vía google-webfonts-helper, que sirve
// los TTF originales de Google Fonts en un ZIP), lo parsea con opentype.js y
// devuelve el contorno del glifo de una letra en el formato de puntos del
// editor (coordenadas de lienzo 1:1, línea base en y=1000, manijas relativas).
// La fuente parseada se cachea en memoria por familia.
// ---------------------------------------------------------------------------

type Pt = {
  x: number;
  y: number;
  in?: { x: number; y: number };
  out?: { x: number; y: number };
  break?: boolean;
  closePrev?: boolean;
};

const FONT_UNITS = 1000;

const fontCache = new Map<string, any>();
const fetchCache = new Map<string, Promise<any>>();

// "Open Sans" -> "open-sans" (mismo slug que el directorio de Google Fonts)
const slugify = (family: string) =>
  family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

async function loadFont(slug: string): Promise<any> {
  if (fontCache.has(slug)) return fontCache.get(slug);
  if (!fetchCache.has(slug)) {
    const p = (async () => {
      const url =
        `https://gwfh.mranftl.com/api/fonts/${encodeURIComponent(slug)}` +
        `?download=zip&subsets=latin,latin-ext&variants=regular&formats=ttf`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZeusMediaStudio)' },
        // Tiempo máximo razonable; la primera descarga de una familia tarda ~1-3 s.
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`No se pudo descargar la fuente "${slug}" (HTTP ${res.status}). Comprueba el nombre en fonts.google.com`);
      }
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const ttfEntry = Object.values(zip.files).find(
        (f: any) => !f.dir && /\.ttf$/i.test(f.name)
      );
      if (!ttfEntry) throw new Error(`La descarga de "${slug}" no contiene archivos TTF`);
      const buf = await ttfEntry.async('arraybuffer');
      const font = opentype.parse(buf);
      fontCache.set(slug, font);
      return font;
    })().catch((e) => {
      fetchCache.delete(slug);
      throw e;
    });
    fetchCache.set(slug, p);
  }
  return fetchCache.get(slug);
}

// Convierte el path de opentype.js (getPath devuelve Y hacia abajo, línea base
// en 0) a los puntos del editor: Y del lienzo = 1000 + fy*escala, manijas in/out
// relativas. Los contornos TrueType se cierran implícitamente; cada contorno
// nuevo tras el primero lleva break + closePrev (igual que "Unir" del editor).
function glyphToPoints(font: any, char: string) {
  const unitsPerEm = font.unitsPerEm || 1000;
  const scale = FONT_UNITS / unitsPerEm;
  const glyph = font.charToGlyph(char);
  if (!glyph) throw new Error(`No se encontró el glifo "${char}"`);
  const path = glyph.getPath(0, 0, unitsPerEm);
  const cmds: any[] = path?.commands ?? [];
  if (!cmds.length) {
    throw new Error(`La fuente no tiene el glifo "${char}" (puede que la letra no exista en la fuente)`);
  }

  // Agrupar comandos en contornos (cada M abre un subpath).
  const contours: any[][] = [];
  let cur: any[] = [];
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur.length) contours.push(cur);
      cur = [c];
    } else {
      cur.push(c);
    }
  }
  if (cur.length) contours.push(cur);

  const points: Pt[] = [];
  contours.forEach((contour, ci) => {
    const contourPts: Pt[] = [];
    let first: Pt | null = null;
    for (const cmd of contour) {
      if (cmd.type === 'M') continue;
      const tx = cmd.x * scale;
      const ty = FONT_UNITS + cmd.y * scale;
      if (cmd.type === 'L') {
        const pt: Pt = { x: tx, y: ty };
        contourPts.push(pt);
        first = first || pt;
      } else if (cmd.type === 'Q') {
        const c: Pt = { x: cmd.x1 * scale, y: FONT_UNITS + cmd.y1 * scale };
        const pt: Pt = { x: tx, y: ty, in: { x: c.x - tx, y: c.y - ty } };
        if (contourPts.length) {
          const prev = contourPts[contourPts.length - 1];
          prev.out = { x: c.x - prev.x, y: c.y - prev.y };
        }
        contourPts.push(pt);
        first = first || pt;
      } else if (cmd.type === 'C') {
        const c1: Pt = { x: cmd.x1 * scale, y: FONT_UNITS + cmd.y1 * scale };
        const c2: Pt = { x: cmd.x2 * scale, y: FONT_UNITS + cmd.y2 * scale };
        const pt: Pt = { x: tx, y: ty, in: { x: c2.x - tx, y: c2.y - ty } };
        if (contourPts.length) {
          const prev = contourPts[contourPts.length - 1];
          prev.out = { x: c1.x - prev.x, y: c1.y - prev.y };
        }
        contourPts.push(pt);
        first = first || pt;
      }
      // 'Z': cierre (TrueType ya cierra implícitamente; solo marca el flag).
    }

    // TrueType suele terminar el contorno con un segmento de vuelta al primer
    // punto: lo eliminamos pero conservando la manija de entrada a ese primer
    // punto (curva de cierre), si la hubiera.
    if (first && contourPts.length > 1) {
      const last = contourPts[contourPts.length - 1];
      if (Math.abs(last.x - first.x) < 0.01 && Math.abs(last.y - first.y) < 0.01) {
        if (last.in) first.in = last.in;
        contourPts.pop();
      }
    }

    contourPts.forEach((pt, i) => {
      const p: Pt = { ...pt };
      if (ci > 0 && i === 0) {
        p.break = true;
        p.closePrev = true; // el contorno anterior se cierra antes de saltar
      }
      points.push(p);
    });
  });

  if (!points.length) throw new Error(`El glifo "${char}" está vacío`);
  return { points, closed: true, advanceWidth: (glyph.advanceWidth ?? 0) * scale };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const family = (searchParams.get('family') || '').trim();
  const char = (searchParams.get('char') || '').trim().charAt(0);

  if (!family) {
    return NextResponse.json({ ok: false, error: 'Falta el parámetro "family"' }, { status: 400 });
  }
  if (!char) {
    return NextResponse.json({ ok: false, error: 'Falta el parámetro "char" (una letra)' }, { status: 400 });
  }

  const slug = slugify(family);
  if (!slug) {
    return NextResponse.json({ ok: false, error: `Nombre de fuente inválido: "${family}"` }, { status: 400 });
  }

  try {
    const font = await loadFont(slug);
    const { points, closed, advanceWidth } = glyphToPoints(font, char);
    return NextResponse.json({
      ok: true,
      family,
      slug,
      char,
      name: char,
      points,
      closed,
      advanceWidth,
      unitsPerEm: font.unitsPerEm || 1000,
      pointCount: points.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al importar el glifo';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
