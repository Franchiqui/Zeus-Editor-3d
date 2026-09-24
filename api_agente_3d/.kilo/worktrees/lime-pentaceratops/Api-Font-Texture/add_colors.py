#!/usr/bin/env python3
"""
Añade colores COLR v1 + CPAL a una fuente TTF existente.

Recibe:
  --font        Ruta a la TTF base (sin colores, generada por opentype.js)
  --output      Ruta de salida
  --colors      JSON con el mapeo de colores por glyph y contorno:
                {
                  "A": {
                    "contours": ["#ff0000", "#00ff00"],   // fill por contorno
                    "stroke": "#000000",
                    "stroke_width": 20
                  },
                  ...
                }
  --effect-svg  (opcional) SVG del efecto (glow/outline/grunge)
  --effect-color (opcional) "r,g,b,a"
  --effect-name  (opcional) nombre del efecto para determinar modo

El script:
1. Carga la TTF base
2. Construye la paleta CPAL con todos los colores únicos
3. Para cada glyph, extrae los contornos individuales (con fontTools)
4. Crea un sub-glyph por contorno (contorno individual como glyph separado)
5. Crea COLR v1: una capa PaintGlyph por contorno, cada una con su color
6. Si hay efecto, lo aplica como capa adicional (halo expandido)
7. Guarda la TTF con COLR v1 + CPAL
"""

import sys
import os
import json
import argparse
from typing import Dict, List, Tuple, Optional

# Bootstrap: asegurar que el directorio del script está en sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.otTables import PaintFormat
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen


def hex_to_rgba(hex_str: str) -> Tuple[int, int, int, int]:
    """Convierte #rrggbb o #rrggbbaa a (r, g, b, a)."""
    h = hex_str.lstrip('#')
    if len(h) == 6:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
        return (r, g, b, 255)
    elif len(h) == 8:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
        a = int(h[6:8], 16)
        return (r, g, b, a)
    else:
        # Intentar como color nombrado o devolver negro
        return (0, 0, 0, 255)


def extract_contours_as_glyphs(font: TTFont, glyph_name: str) -> List[Tuple[str, object]]:
    """
    Extrae cada contorno del glyph como un sub-glyph independiente.
    Devuelve una lista de (sub_glyph_name, glyph_object).
    """
    if glyph_name not in font.getGlyphOrder():
        return []

    glyf_table = font["glyf"]
    glyph = glyf_table[glyph_name]

    # Usar RecordingPen para capturar los contornos
    recording = RecordingPen()
    glyph.draw(recording, glyf_table)

    # Agrupar comandos por contorno (cada "moveTo" inicia un nuevo contorno)
    contours_cmds = []
    current = []
    for cmd in recording.value:
        if cmd[0] == "moveTo" and current:
            contours_cmds.append(current)
            current = []
        current.append(cmd)
    if current:
        contours_cmds.append(current)

    sub_glyphs = []
    for i, cmds in enumerate(contours_cmds):
        sub_name = f"{glyph_name}.c{i}"
        pen = TTGlyphPen(font.getGlyphSet())
        for cmd in cmds:
            if cmd[0] == "moveTo":
                pen.moveTo(cmd[1][0])
            elif cmd[0] == "lineTo":
                pen.lineTo(cmd[1][0])
            elif cmd[0] == "curveTo":
                pen.curveTo(*cmd[1])
            elif cmd[0] == "qCurveTo":
                pen.qCurveTo(*cmd[1])
            elif cmd[0] == "closePath":
                pen.closePath()
            elif cmd[0] == "endPath":
                pen.endPath()
        try:
            sub_glyph = pen.glyph()
            sub_glyphs.append((sub_name, sub_glyph))
        except Exception:
            pass

    return sub_glyphs


def build_palette(colors_map: Dict, effect_color: Optional[str] = None) -> Tuple[List[Tuple[int, int, int, int]], Dict[str, int]]:
    """
    Construye la paleta de colores únicos desde el mapa de colores.
    Devuelve (lista_colores, mapa_hex_a_indice).
    """
    unique_colors = []
    color_to_index = {}

    def add_color(hex_str: str):
        if hex_str and hex_str not in color_to_index:
            rgba = hex_to_rgba(hex_str)
            color_to_index[hex_str] = len(unique_colors)
            unique_colors.append(rgba)

    for glyph_name, info in colors_map.items():
        contours = info.get("contours", [])
        for c in contours:
            add_color(c)
        stroke = info.get("stroke")
        if stroke:
            add_color(stroke)
        fill = info.get("fill")
        if fill:
            add_color(fill)

    # Añadir color del efecto al final
    if effect_color:
        rgba = hex_to_rgba(effect_color)
        # Buscar si ya existe
        for i, c in enumerate(unique_colors):
            if c == rgba:
                color_to_index[f"__effect__"] = i
                break
        else:
            color_to_index[f"__effect__"] = len(unique_colors)
            unique_colors.append(rgba)

    return unique_colors, color_to_index


def create_cpal(font: TTFont, colors: List[Tuple[int, int, int, int]]):
    """Crea la tabla CPAL con la paleta de colores."""
    from fontTools.ttLib.tables.C_P_A_L_ import Color, table_C_P_A_L_

    cpal = table_C_P_A_L_()
    # Color constructor: (blue, green, red, alpha)
    colors_bgra = [Color(b, g, r, a) for (r, g, b, a) in colors]
    cpal.palettes = [colors_bgra]
    cpal.paletteTypes = [0]
    cpal.paletteLabels = [b'']
    cpal.paletteEntryLabels = [[b''] * len(colors_bgra)]
    cpal.version = 0
    cpal.numPaletteEntries = len(colors_bgra)
    font["CPAL"] = cpal


def create_colr_v1(
    font: TTFont,
    colors_map: Dict,
    color_to_index: Dict[str, int],
    effect_svg_path: Optional[str] = None,
    effect_color: Optional[str] = None,
    effect_name: Optional[str] = None,
):
    """
    Crea la tabla COLR v1 usando buildCOLR de fontTools (igual que simple_api.py).
    Para cada glyph:
    - Si tiene contours con colores diferentes: crea sub-glyphs por contorno
    - Si solo tiene un color: usa el glyph completo con ese color
    - Si hay efecto: lo añade como capa halo
    """
    from fontTools.ttLib.tables.otTables import PaintFormat as PF
    from fontTools.colorLib.builder import buildCOLR

    glyf_table = font["glyf"]
    glyph_order = font.getGlyphOrder()

    # Crear sub-glyphs por contorno cuando un glyph tiene múltiples colores
    sub_glyph_map = {}  # glyph_name -> [(sub_name, sub_glyph), ...]
    for glyph_name, info in colors_map.items():
        if glyph_name not in glyph_order:
            continue
        contours = info.get("contours", [])
        if len(contours) <= 1:
            continue
        unique_contour_colors = set(c for c in contours if c)
        if len(unique_contour_colors) <= 1:
            continue

        # Obtener el advance width del glyph original
        hmtx = font["hmtx"]
        glyph_advance = hmtx[glyph_name][0] if glyph_name in hmtx.metrics else 0

        sub_glyphs = extract_contours_as_glyphs(font, glyph_name)
        sub_glyph_map[glyph_name] = sub_glyphs
        for sub_name, sub_glyph_obj in sub_glyphs:
            if sub_name not in glyph_order:
                glyph_order.append(sub_name)
            glyf_table[sub_name] = sub_glyph_obj
            if sub_name not in hmtx.metrics:
                hmtx.metrics[sub_name] = (glyph_advance, 0)

    font.setGlyphOrder(glyph_order)

    # Construir color_glyphs usando el mismo formato que simple_api.py
    color_glyphs = {}
    for glyph_name, info in colors_map.items():
        if glyph_name not in font.getGlyphOrder():
            continue

        contours = info.get("contours", [])
        fill = info.get("fill")

        layers = []

        # Capa de efecto (halo) — debajo de todo
        if effect_name and effect_color:
            effect_idx = color_to_index.get("__effect__", 0)
            effect_mode = "default"
            if effect_name:
                name_lower = effect_name.lower()
                if "outline" in name_lower:
                    effect_mode = "outline"
                elif "glow" in name_lower or "neon" in name_lower:
                    effect_mode = "glow"

            halo_name = f"{glyph_name}.halo"
            try:
                _create_halo(font, glyph_name, halo_name, expansion=0.015)
                if halo_name not in font.getGlyphOrder():
                    font.getGlyphOrder().append(halo_name)

                if effect_mode == "outline":
                    layers.append({
                        "Format": int(PF.PaintGlyph),
                        "Glyph": halo_name,
                        "Paint": {
                            "Format": int(PF.PaintSolid),
                            "PaletteIndex": effect_idx,
                            "Alpha": 0.9,
                        },
                    })
                elif effect_mode == "glow":
                    # Calcular centro del glyph desde sus puntos (xMin/xMax
                    # pueden no estar disponibles si no se ha recalcBounds)
                    from fontTools.pens.recordingPen import RecordingPen as RP
                    rp = RP()
                    glyf_table[glyph_name].draw(rp, glyf_table)
                    xs = []
                    ys = []
                    for cmd in rp.value:
                        if cmd[1]:
                            for pt in cmd[1]:
                                if pt is not None:
                                    xs.append(pt[0])
                                    ys.append(pt[1])
                    if xs and ys:
                        cx = (min(xs) + max(xs)) / 2.0
                        cy = (min(ys) + max(ys)) / 2.0
                    else:
                        cx, cy = 0.0, 0.0
                    n_layers = 24
                    max_scale = 1.24
                    glow_layers = []
                    for i in range(n_layers):
                        t = i / (n_layers - 1)
                        s = 1.0 + t * (max_scale - 1.0)
                        alpha = round(0.08 * (1.0 - t) ** 1.5, 4)
                        if alpha <= 0.001:
                            continue
                        halo_paint = {
                            "Format": int(PF.PaintGlyph),
                            "Glyph": halo_name,
                            "Paint": {
                                "Format": int(PF.PaintSolid),
                                "PaletteIndex": effect_idx,
                                "Alpha": alpha,
                            },
                        }
                        if s == 1.0:
                            glow_layers.append(halo_paint)
                        else:
                            tx = cx * (1 - s)
                            ty = cy * (1 - s)
                            glow_layers.append({
                                "Format": int(PF.PaintTransform),
                                "Paint": halo_paint,
                                "Transform": (s, 0, 0, s, tx, ty),
                            })
                    paint = {
                        "Format": int(PF.PaintColrLayers),
                        "Layers": glow_layers,
                    }
                    layers.append(paint)
                else:
                    layers.append({
                        "Format": int(PF.PaintGlyph),
                        "Glyph": halo_name,
                        "Paint": {
                            "Format": int(PF.PaintSolid),
                            "PaletteIndex": effect_idx,
                            "Alpha": 0.6,
                        },
                    })
            except Exception as e:
                print(f"[WARN] Halo para '{glyph_name}': {e}")

        # Capas de contornos con colores
        if glyph_name in sub_glyph_map and len(sub_glyph_map[glyph_name]) > 1:
            subs = sub_glyph_map[glyph_name]
            for i, (sub_name, _) in enumerate(subs):
                color_hex = contours[i] if i < len(contours) and contours[i] else fill
                if not color_hex:
                    continue
                idx = color_to_index.get(color_hex, 0)
                layers.append({
                    "Format": int(PF.PaintGlyph),
                    "Glyph": sub_name,
                    "Paint": {
                        "Format": int(PF.PaintSolid),
                        "PaletteIndex": idx,
                        "Alpha": 1.0,
                    },
                })
        else:
            color_hex = contours[0] if contours and contours[0] else fill
            if not color_hex:
                color_hex = "#000000"
            idx = color_to_index.get(color_hex, 0)
            layers.append({
                "Format": int(PF.PaintGlyph),
                "Glyph": glyph_name,
                "Paint": {
                    "Format": int(PF.PaintSolid),
                    "PaletteIndex": idx,
                    "Alpha": 1.0,
                },
            })

        if layers:
            if len(layers) == 1:
                color_glyphs[glyph_name] = layers[0]
            else:
                color_glyphs[glyph_name] = {
                    "Format": int(PF.PaintColrLayers),
                    "Layers": layers,
                }

    # Usar buildCOLR igual que simple_api.py
    glyph_map = font.getReverseGlyphMap()
    colr = buildCOLR(color_glyphs, version=1, glyphMap=glyph_map)
    try:
        colr.table.computeClipBoxes(font["glyf"], glyph_map)
    except Exception:
        pass
    font["COLR"] = colr


def _create_halo(font: TTFont, base_name: str, halo_name: str, expansion: float = 0.015):
    """Crea un glyph halo expandido desde el glyph base."""
    glyf_table = font["glyf"]
    if base_name not in glyf_table:
        raise ValueError(f"Glyph '{base_name}' no encontrado")

    glyph = glyf_table[base_name]
    upm = font["head"].unitsPerEm

    recording = RecordingPen()
    glyph.draw(recording, glyf_table)

    contours = []
    current = []
    for cmd in recording.value:
        if cmd[0] == "moveTo" and current:
            contours.append(current)
            current = []
        current.append(cmd)
    if current:
        contours.append(current)

    expand_units = int(upm * expansion)
    pen = TTGlyphPen(font.getGlyphSet())
    for contour_cmds in contours:
        points = []
        for cmd in contour_cmds:
            if cmd[0] == "moveTo":
                points.append(cmd[1][0])
            elif cmd[0] == "lineTo":
                points.append(cmd[1][0])
            elif cmd[0] == "curveTo":
                for p in cmd[1]:
                    points.append(p)
            elif cmd[0] == "qCurveTo":
                for p in cmd[1]:
                    if p is not None:
                        points.append(p)

        if not points:
            continue

        cx = sum(p[0] for p in points) / len(points)
        cy = sum(p[1] for p in points) / len(points)

        for cmd in contour_cmds:
            if cmd[0] == "moveTo":
                x, y = cmd[1][0]
                dx = x - cx
                dy = y - cy
                import math
                d = math.sqrt(dx * dx + dy * dy)
                if d > 0:
                    nx = x + (dx / d) * expand_units
                    ny = y + (dy / d) * expand_units
                else:
                    nx = x
                    ny = y
                pen.moveTo((nx, ny))
            elif cmd[0] == "lineTo":
                x, y = cmd[1][0]
                dx = x - cx
                dy = y - cy
                import math
                d = math.sqrt(dx * dx + dy * dy)
                if d > 0:
                    nx = x + (dx / d) * expand_units
                    ny = y + (dy / d) * expand_units
                else:
                    nx = x
                    ny = y
                pen.lineTo((nx, ny))
            elif cmd[0] == "curveTo":
                pts = []
                for p in cmd[1]:
                    dx = p[0] - cx
                    dy = p[1] - cy
                    import math
                    d = math.sqrt(dx * dx + dy * dy)
                    if d > 0:
                        pts.append((p[0] + (dx / d) * expand_units, p[1] + (dy / d) * expand_units))
                    else:
                        pts.append(p)
                pen.curveTo(*pts)
            elif cmd[0] == "qCurveTo":
                pts = []
                for p in cmd[1]:
                    if p is None:
                        pts.append(None)
                        continue
                    dx = p[0] - cx
                    dy = p[1] - cy
                    import math
                    d = math.sqrt(dx * dx + dy * dy)
                    if d > 0:
                        pts.append((p[0] + (dx / d) * expand_units, p[1] + (dy / d) * expand_units))
                    else:
                        pts.append(p)
                pen.qCurveTo(*pts)
            elif cmd[0] == "closePath":
                pen.closePath()
            elif cmd[0] == "endPath":
                pen.endPath()

    try:
        halo_glyph = pen.glyph()
        glyf_table[halo_name] = halo_glyph
        hmtx = font["hmtx"]
        if halo_name not in hmtx.metrics:
            hmtx.metrics[halo_name] = (hmtx[base_name][0] if base_name in hmtx.metrics else 0, 0)
    except Exception as e:
        raise ValueError(f"Error creando halo: {e}")


def main():
    parser = argparse.ArgumentParser(description="Añade colores COLR v1 a una fuente TTF")
    parser.add_argument("--font", "-f", required=True, help="Ruta a la TTF base")
    parser.add_argument("--output", "-o", required=True, help="Ruta de salida")
    parser.add_argument("--colors", "-c", required=True, help="JSON con el mapeo de colores por glyph")
    parser.add_argument("--effect-svg", default=None, help="SVG del efecto (opcional)")
    parser.add_argument("--effect-color", default=None, help="Color RGBA del efecto: 'r,g,b,a'")
    parser.add_argument("--effect-name", default=None, help="Nombre del efecto (glow/outline/...)")
    args = parser.parse_args()

    # Cargar colores
    with open(args.colors, 'r') as f:
        colors_map = json.load(f)

    print(f"{'=' * 60}")
    print("  AÑADIR COLORES COLR v1 A FUENTE TTF")
    print(f"{'=' * 60}")
    print(f"  Fuente: {args.font}")
    print(f"  Glyphs con colores: {len(colors_map)}")

    # Cargar fuente
    font = TTFont(args.font)
    print(f"  Glyphs en la fuente: {len(font.getGlyphOrder())}")

    # Si la fuente usa CFF (PostScript outlines, generado por opentype.js),
    # convertir a glyf (TrueType outlines) que es lo que usa COLR v1.
    if 'CFF ' in font and 'glyf' not in font:
        from fontTools.pens.ttGlyphPen import TTGlyphPen
        from fontTools.ttLib import newTable
        print("  Convirtiendo CFF -> glyf (TrueType outlines)...")
        glyf_table = newTable('glyf')
        glyf_table.glyphs = {}
        glyf_table.glyphOrder = font.getGlyphOrder()
        gs = font.getGlyphSet()
        for name in font.getGlyphOrder():
            pen = TTGlyphPen(gs)
            gs[name].draw(pen)
            glyf_table.glyphs[name] = pen.glyph()
        font['glyf'] = glyf_table
        # loca: fontTools la genera automáticamente al guardar si existe la tabla
        # pero hay que crearla vacía para que el writer la rellene.
        loca_table = newTable('loca')
        loca_table.locations = []
        font['loca'] = loca_table
        # Actualizar head
        font['head'].macStyle = 0
        font['head'].glyphDataFormat = 0
        font['head'].indexToLocFormat = 0  # short format, fontTools lo ajusta al guardar
        # Actualizar maxp para TrueType
        if 'maxp' in font:
            font['maxp'].version = 0x00010000  # TrueType maxp version
            font['maxp'].maxPoints = 0
            font['maxp'].maxContours = 0
            font['maxp'].maxCompositePoints = 0
            font['maxp'].maxCompositeContours = 0
            font['maxp'].maxZones = 1
            font['maxp'].maxTwilightPoints = 0
            font['maxp'].maxStorage = 0
            font['maxp'].maxFunctionDefs = 0
            font['maxp'].maxInstructionDefs = 0
            font['maxp'].maxStackElements = 0
            font['maxp'].maxSizeOfInstructions = 0
        # Eliminar CFF
        del font['CFF ']
        # Eliminar VORG si existe (solo CFF)
        if 'VORG' in font:
            del font['VORG']
        print("  Conversión completada")

    # Construir paleta
    palette_colors, color_to_index = build_palette(colors_map, args.effect_color)
    print(f"  Colores únicos en paleta: {len(palette_colors)}")
    for i, c in enumerate(palette_colors):
        print(f"    [{i}] RGBA{c}")

    # Crear CPAL
    create_cpal(font, palette_colors)
    print(f"  CPAL creada con {len(palette_colors)} colores")

    # Crear COLR v1
    create_colr_v1(
        font,
        colors_map,
        color_to_index,
        effect_svg_path=args.effect_svg,
        effect_color=args.effect_color,
        effect_name=args.effect_name,
    )
    print(f"  COLR v1 creado")

    # Guardar
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    font.save(args.output)
    print(f"\n[SUCCESS] Fuente con colores guardada en: {args.output}")

    # Validación rápida
    with TTFont(args.output) as check:
        has_cpal = "CPAL" in check
        has_colr = "COLR" in check
        print(f"  Validación: CPAL={has_cpal}, COLR={has_colr}, glyphs={len(check.getGlyphOrder())}")


if __name__ == "__main__":
    main()