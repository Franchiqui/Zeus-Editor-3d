"""
Aplica una textura SVG a TODOS los glyphs de una fuente TTF.

Uso:
    python aplicar_textura_completa.py
    python aplicar_textura_completa.py --font mi_fuente.ttf --svg Texturas/textura.svg --output fonts/salida.ttf

El script:
  1. Carga la fuente TTF indicada.
  2. Lee todos los glyphs que tienen contornos (excluye .notdef, espacio, etc.).
  3. Crea un glyph de textura compartido ("font.texture") para toda la fuente.
  4. Construye TexturedGlyph con dos capas: color base + textura.
  5. Guarda la fuente COLR/CPAL resultante.
"""

import os
import argparse
import sys
from fontTools.ttLib import TTFont

from simple_api import (
    FontTextureAPI,
    ColorPalette,
    TexturedGlyph,
    TextureLayer,
    VectorTexture,
    FontTextures,
)


# ---------------------------------------------------------------------------
# Configuración por defecto — cambia estos valores según tu proyecto
# ---------------------------------------------------------------------------

DEFAULT_FONT_CANDIDATES = [
    "input.ttf",
    "fonts/input_font.ttf",
    "fonts/Input.ttf",
    "C:/Windows/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

DEFAULT_SVG_PATH  = "Texturas/textura.svg"
DEFAULT_OUTPUT    = "fonts/output_textura_completa.ttf"

# Paleta de colores: añade o modifica los colores que quieras.
# Índice 0 → color base del glyph, Índice 1 → color de la textura.
DEFAULT_PALETTE = ColorPalette(
    colors=[
        (30,  30,  30,  255),   # 0 – Negro/oscuro (relleno base)
        (255, 180,  50,  200),  # 1 – Dorado semitransparente (textura)
        (255, 255, 255, 255),   # 2 – Blanco (reserva)
        (200,  50,  50, 255),   # 3 – Rojo (reserva)
    ],
    name="paleta_textura_completa",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_font(path: str) -> str:
    """Devuelve el path de la fuente; lanza SystemExit si no se encuentra."""
    if os.path.exists(path):
        return path
    for candidate in DEFAULT_FONT_CANDIDATES:
        if os.path.exists(candidate):
            print(f"[INFO] Fuente no encontrada en '{path}', usando: {candidate}")
            return candidate
    print(
        "[ERROR] No se encontró ninguna fuente TTF.\n"
        "  Coloca tu fuente en el directorio actual como 'input.ttf', o\n"
        "  usa --font para indicar la ruta correcta."
    )
    sys.exit(1)


def get_renderable_glyphs(font_path: str) -> list:
    """
    Devuelve la lista de nombres de glyphs que tienen contornos reales.
    Se excluyen automáticamente: .notdef, glyph vacíos, glyph de espacio,
    y cualquier glyph auxiliar que ya sea una textura previa (*.texture).
    """
    font      = TTFont(font_path)
    glyfTable = font.get("glyf")      # None en fuentes CFF/OTF
    hmtx      = font["hmtx"].metrics  # {name: (advance, lsb)}

    renderable = []

    for name in font.getGlyphOrder():
        # Saltar glyphs auxiliares de texturas previas y de efectos de iluminación
        if name.endswith(".texture") or name.endswith(".effect"):
            continue

        if glyfTable is not None:
            # Fuente TrueType (glyf)
            g = glyfTable[name]
            if g is None:
                continue
            # numberOfContours == 0  → glyph vacío (espacio, etc.)
            # numberOfContours == -1 → compuesto (lo incluimos)
            if hasattr(g, "numberOfContours") and g.numberOfContours == 0:
                continue
        else:
            # Fuente CFF — comprobamos que tenga advance razonable
            advance, _ = hmtx.get(name, (0, 0))
            if advance == 0:
                continue

        renderable.append(name)

    font.close()
    return renderable


# ---------------------------------------------------------------------------
# Script principal
# ---------------------------------------------------------------------------

def apply_texture_to_all(
    font_path,
    svg_path,
    output_path,
    palette,
    scale=1.0,
    color_base_index=0,
    color_texture_index=1,
    verbose=True,
    effect_svg_path=None,
    effect_color=None,
    effect_name=None,
):
    """
    Aplica la textura SVG a todos los glyphs con contorno de la fuente,
    y opcionalmente un efecto de iluminación encima de la textura.

    Args:
        font_path:            Ruta a la fuente TTF de entrada.
        svg_path:             Ruta al archivo SVG con la textura (None si solo hay efecto).
        output_path:          Ruta donde se guardará la fuente resultante.
        palette:              ColorPalette con los colores RGBA.
        scale:                Escala de la textura (1.0 = tamaño UPM).
        color_base_index:     Índice de color del relleno base del glyph.
        color_texture_index:  Índice de color de la capa de textura.
        verbose:              Si True, imprime progreso detallado.
        effect_svg_path:      Ruta al SVG del efecto de iluminación (opcional).
        effect_color:         Color RGBA del efecto como tupla (r,g,b,a).
                              Default: (255, 255, 255, 80) blanco translúcido.

    Returns:
        True si se completó sin errores, False en caso contrario.
    """

    # --- 1. Validaciones previas -------------------------------------------
    font_path = find_font(font_path)

    if svg_path is not None and not os.path.exists(svg_path):
        print(f"[ERROR] No se encontró el SVG: {svg_path}")
        return False

    if svg_path is None and effect_svg_path is None:
        print("[ERROR] Se necesita al menos una textura SVG o un efecto de iluminación.")
        return False

    if effect_svg_path is not None and not os.path.exists(effect_svg_path):
        print(f"[ERROR] No se encontró el SVG del efecto: {effect_svg_path}")
        return False

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # --- 2. Obtener glyphs renderizables -----------------------------------
    if verbose:
        print(f"\n[1/4] Leyendo glyphs de: {font_path}")

    glyph_names = get_renderable_glyphs(font_path)

    if not glyph_names:
        print("[ERROR] No se encontraron glyphs con contorno en la fuente.")
        return False

    if verbose:
        print(f"       {len(glyph_names)} glyphs encontrados.")

    # --- 2b. ¿La fuente ya tiene textura/color previo? ---------------------
    # Si la fuente de entrada ya es COLR (p.ej. una textura aplicada antes),
    # se preservan sus capas y paleta, y los colores nuevos se añaden al final.
    has_prev_colr = False
    palette_offset = 0
    try:
        with TTFont(font_path) as prev_font:
            has_prev_colr = "COLR" in prev_font
            cpal_prev = prev_font.get("CPAL")
            if cpal_prev is not None and cpal_prev.palettes:
                palette_offset = len(cpal_prev.palettes[0])
    except Exception as e:
        print(f"[WARN] No se pudo inspeccionar la fuente previa: {e}")

    # --- 3. Construir configuración ----------------------------------------
    if verbose:
        print(f"\n[2/4] Construyendo configuración de texturas...")

    # Un único glyph de textura compartido para toda la fuente.
    # Esto es lo más eficiente: la textura SVG se convierte una sola vez.
    TEXTURE_GLYPH_NAME = "font.texture"

    vector_textures = {}
    if svg_path is not None:
        vector_textures[TEXTURE_GLYPH_NAME] = VectorTexture(
            svg_path=svg_path,
            glyph_name=TEXTURE_GLYPH_NAME,
            scale=scale,
        )

    # Índices absolutos en la paleta final (desplazados si se preserva la previa)
    idx_base = color_base_index + palette_offset
    idx_texture = color_texture_index + palette_offset
    idx_effect = None
    if effect_svg_path is not None:
        # El color del efecto se añade al final de la paleta de la UI
        if isinstance(effect_color, str):
            effect_rgba = tuple(int(x) for x in effect_color.split(','))
        else:
            effect_rgba = effect_color if effect_color is not None else (255, 255, 255, 140)
        palette.colors = list(palette.colors) + [effect_rgba]
        idx_effect = (len(palette.colors) - 1) + palette_offset

    textured_glyphs = {}
    # Determinar modo del efecto según el nombre del archivo
    effect_mode = "default"
    if effect_name:
        name_lower = effect_name.lower()
        if "outline" in name_lower:
            effect_mode = "outline"
        elif "glow" in name_lower or "neon" in name_lower:
            effect_mode = "glow"
    if effect_svg_path is not None and verbose:
        print(f"       Modo de efecto: {effect_mode}")
    for name in glyph_names:
        layers = []
        if effect_svg_path is not None:
            # El efecto va PRIMERO (debajo) para que la letra tape la parte
            # interior del halo y solo se vea la iluminación exterior.
            halo_name = f"{name}.halo"
            layers.append(TextureLayer(
                glyph_name=name,
                color_index=idx_effect,
                clip_glyph=halo_name,
                effect_mode=effect_mode,
            ))
        if svg_path is not None:
            layers.append(TextureLayer(glyph_name=name, color_index=idx_base))
            layers.append(TextureLayer(glyph_name=TEXTURE_GLYPH_NAME, color_index=idx_texture))
        elif effect_svg_path is not None and not has_prev_colr:
            # Fuente limpia + solo efecto: base sólida para que la letra se vea
            layers.append(TextureLayer(glyph_name=name, color_index=idx_base))
        textured_glyphs[name] = TexturedGlyph(
            base_glyph=name,
            layers=layers,
        )

    if verbose:
        if svg_path is not None:
            print(f"       Textura compartida: '{TEXTURE_GLYPH_NAME}'")
        if effect_svg_path is not None:
            print(f"       Efecto de iluminación: halo expandido (color {palette.colors[-1]})")
        if has_prev_colr:
            print(f"       Fuente ya texturizada: preservando {palette_offset} colores previos + capas COLR existentes")
        print(f"       Glyphs a texturizar: {len(textured_glyphs)}")

    textures = FontTextures(
        font_path=font_path,
        output_path=output_path,
        palettes=[palette],
        textured_glyphs=textured_glyphs,
        vector_textures=vector_textures,
        metadata={
            "generator": "aplicar_textura_completa.py",
            "total_glyphs": len(textured_glyphs),
        },
    )

    # --- 4. Aplicar texturas -----------------------------------------------
    if verbose:
        print(f"\n[3/4] Aplicando texturas (esto puede tardar un momento)...")

    api = FontTextureAPI()

    try:
        api.load_font(font_path)
    except Exception as e:
        print(f"[ERROR] No se pudo cargar la fuente: {e}")
        return False

    # Crear glyphs halo expandidos para cada letra (para el efecto exterior)
    if effect_svg_path is not None:
        # Expansión mayor para glow (más room para el degradado radial),
        # menor para outline (borde fino) y default.
        if effect_mode == "glow":
            halo_expansion = 0.015  # fino — las 24 capas escaladas hacen el difuminado
        else:
            halo_expansion = 0.015  # 1.5% del UPM = borde fino
        if verbose:
            print(f"       Creando glyphs halo para {len(glyph_names)} letras (expansion={halo_expansion})...")
        for name in glyph_names:
            halo_name = f"{name}.halo"
            try:
                api.create_halo_glyph(name, halo_name, expansion=halo_expansion)
            except Exception as e:
                if verbose:
                    print(f"       [WARN] Halo para '{name}': {e}")

    try:
        api.apply_textures(textures)
        if verbose:
            print("       Texturas aplicadas correctamente.")
    except Exception as e:
        print(f"[ERROR] Error aplicando texturas: {e}")
        return False

    # --- 5. Guardar resultado -----------------------------------------------
    if verbose:
        print(f"\n[4/4] Guardando fuente en: {output_path}")

    try:
        api.save_font(output_path)
    except Exception as e:
        print(f"[ERROR] Error guardando fuente: {e}")
        return False

    # --- 6. Validación rápida ----------------------------------------------
    validation = api.validate_font()
    if verbose:
        print(f"\n       Validación: {validation}")

    return True


# ---------------------------------------------------------------------------
# Entrada por línea de comandos
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(
        description="Aplica una textura SVG a TODOS los glyphs de una fuente TTF."
    )
    p.add_argument(
        "--font", "-f",
        default="input.ttf",
        help="Ruta a la fuente TTF de entrada (default: input.ttf).",
    )
    p.add_argument(
        "--svg", "-s",
        default=None,
        help="Ruta al archivo SVG de textura (opcional si solo hay efecto).",
    )
    p.add_argument(
        "--output", "-o",
        default=DEFAULT_OUTPUT,
        help=f"Ruta de salida de la fuente texturizada (default: {DEFAULT_OUTPUT}).",
    )
    p.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Escala de la textura (1.0 = tamaño UPM). Default: 1.0.",
    )
    p.add_argument(
        "--base-color",
        type=int,
        default=0,
        metavar="INDEX",
        help="Índice de color de la paleta para el relleno base. Default: 0.",
    )
    p.add_argument(
        "--texture-color",
        type=int,
        default=1,
        metavar="INDEX",
        help="Índice de color de la paleta para la textura. Default: 1.",
    )
    p.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suprime la salida detallada.",
    )
    p.add_argument(
        "--palette",
        type=str,
        default=None,
        help="Ruta a un archivo JSON con la paleta de colores (lista de [r,g,b,a]).",
    )
    p.add_argument(
        "--effect-svg",
        default=None,
        help="SVG del efecto de iluminación (opcional). Se dibuja encima de la textura",
    )
    p.add_argument(
        "--effect-color",
        default=None,
        help="Color RGBA del efecto de iluminación: 'r,g,b,a' (default: 255,255,255,80)",
    )
    p.add_argument(
        "--effect-name",
        default=None,
        help="Nombre del archivo de efecto (para determinar modo: glow/outline/...)",
    )
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()

    # Load custom palette if provided
    palette = DEFAULT_PALETTE
    if args.palette:
        import json
        with open(args.palette, 'r') as f:
            palette_data = json.load(f)
        # Convert to ColorPalette
        from simple_api import ColorPalette
        palette = ColorPalette(
            colors=[tuple(c) for c in palette_data],
            name="custom_palette"
        )

    print("=" * 60)
    print("  APLICAR TEXTURA A FUENTE COMPLETA")
    print("=" * 60)

    success = apply_texture_to_all(
        font_path=args.font,
        svg_path=args.svg if args.svg else None,
        output_path=args.output,
        palette=palette,
        scale=args.scale,
        color_base_index=args.base_color,
        color_texture_index=args.texture_color,
        verbose=not args.quiet,
        effect_svg_path=args.effect_svg,
        effect_color=args.effect_color,
        effect_name=args.effect_name,
    )

    print()
    if success:
        print(f"[SUCCESS] Fuente texturizada guardada en: {args.output}")
    else:
        print("[FAIL] El proceso terminó con errores. Revisa los mensajes anteriores.")
        sys.exit(1)
