"""Mini-renderizador COLR v1: compone capas con fontTools + freetype-py.
Clasifica Paints por ATRIBUTOS (no por Format: spec vs enum son inconsistentes)."""
import sys
import freetype
from fontTools.ttLib import TTFont
from PIL import Image

SIZE = 240

def main():
    path, text, out = sys.argv[1], sys.argv[2], sys.argv[3]

    font = TTFont(path)
    colr = font["COLR"].table
    cpal = font["CPAL"].palettes[0]
    order = font.getGlyphOrder()
    ll = colr.LayerList.Paint if colr.LayerList else []
    records = {r.BaseGlyph: r.Paint for r in colr.BaseGlyphList.BaseGlyphPaintRecord}

    def layer_of(p, clip=None):
        """Devuelve [(clip_gid, paint_gid, pal_idx, alpha)] para un Paint."""
        out = []
        if hasattr(p, "FirstLayerIndex"):  # PaintColrLayers
            for sub in ll[p.FirstLayerIndex : p.FirstLayerIndex + p.NumLayers]:
                out += layer_of(sub, clip)
        elif hasattr(p, "PaletteIndex"):  # PaintSolid
            out.append((clip, clip, p.PaletteIndex, getattr(p, "Alpha", None)))
        elif hasattr(p, "Paint"):  # PaintGlyph
            new_clip = clip if clip is not None else p.Glyph
            out += layer_of(p.Paint, new_clip)
        elif hasattr(p, "Glyph"):  # PaintColrGlyph
            out.append((clip, p.Glyph, None, None))
        return out

    # --- rasterizar un glyph -> PIL mask (grayscale) + offset (x, y) ---
    cache = {}
    def raster(gid_name):
        if gid_name in cache:
            return cache[gid_name]
        gid = order.index(gid_name)
        face = freetype.Face(path)
        face.set_pixel_sizes(0, SIZE)
        face.load_glyph(gid, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
        bmp = face.glyph.bitmap
        w, h = bmp.width, bmp.rows
        data = bytes(bmp.buffer)
        if bmp.pitch != w:
            # pitch puede ser mayor que width; extraer filas
            rows = [data[i * bmp.pitch : i * bmp.pitch + w] for i in range(h)]
            data = b"".join(rows)
        img = Image.frombytes("L", (w, h), data)
        x = face.glyph.bitmap_left
        y = face.glyph.metrics.horiBearingY // 64  # approx
        # Posicion real en canvas: offset desde el origen (0 = baseline)
        # bitmap_top: filas desde arriba del bitmap hasta la baseline
        top = face.glyph.bitmap_top
        cache[gid_name] = (img, x, top)
        return cache[gid_name]

    # --- canvas ---
    W, H = 900, 700
    canvas = Image.new("RGBA", (W, H), (34, 34, 34, 255))
    ORIGIN_X, ORIGIN_Y = 80, 540  # baseline en canvas

    painted = 0
    for ch in text:
        rec = records.get(ch)
        if rec is None:
            print(f"(sin COLR para '{ch}')")
            continue
        layers = layer_of(rec)
        for (clip_g, paint_g, pal_idx, alpha) in layers:
            if pal_idx is None or pal_idx >= len(cpal):
                continue
            c = cpal[pal_idx]
            color = (c.red, c.green, c.blue, c.alpha)
            # glyph a pintar
            paint_gid = paint_g if paint_g in order else clip_g
            mask, bx, btop = raster(paint_gid)
            # blend
            layer_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            solid = Image.new("RGBA", mask.size, color)
            layer_img.paste(solid, (ORIGIN_X + bx, ORIGIN_Y - btop), mask)
            # clip: recortar por el contorno del clip glyph
            cmask, cx, ctop = raster(clip_g)
            clip_layer = Image.new("L", (W, H), 0)
            clip_layer.paste(255, (ORIGIN_X + cx, ORIGIN_Y - ctop), cmask)
            layer_img.putalpha(Image.composite(layer_img.getchannel("A"), Image.new("L", (W, H), 0), clip_layer))
            # alpha global del color
            if alpha is not None and alpha < 1.0:
                a = layer_img.getchannel("A").point(lambda v: int(v * alpha))
                layer_img.putalpha(a)
            canvas = Image.alpha_composite(canvas, layer_img)
            painted += 1

    canvas.save(out)
    print(f"OK {out} | {painted} capas pintadas")

if __name__ == "__main__":
    main()
