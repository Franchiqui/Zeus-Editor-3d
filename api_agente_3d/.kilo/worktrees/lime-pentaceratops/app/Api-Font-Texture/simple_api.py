"""
API para aplicar texturas a fuentes TTF usando COLRv1/CPAL
Autor: Asistente IA
Versión: 1.0.0
"""
# ===== IMPORTACIONES ADICIONALES PARA FASTAPI =====
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import base64
from pathlib import Path
from typing import Optional
import shutil
import tempfile
import os
import json
import shutil
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Union, Any
from dataclasses import dataclass, field
from enum import Enum
import tempfile
import subprocess
from PIL import Image
import io
import struct

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.C_O_L_R_ import table_C_O_L_R_
from fontTools.ttLib.tables.C_P_A_L_ import table_C_P_A_L_
from fontTools.ttLib.tables._g_l_y_f import table__g_l_y_f
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.pointPen import PointToSegmentPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.misc.transform import Transform
from fontTools.colorLib.builder import buildCOLR
from fontTools.misc.etree import fromstring, tostring
import xml.etree.ElementTree as ET
import traceback

# ============================================================================
# CONSTANTES Y TIPOS
# ============================================================================

class TextureType(Enum):
    """Tipos de textura soportados"""
    VECTOR = "vector"
    RASTER = "raster"
    PATTERN = "pattern"
    GRADIENT = "gradient"

class ColorFormat(Enum):
    """Formatos de color soportados"""
    RGBA = "RGBA"
    RGB = "RGB"
    HEX = "hex"
    HTML = "html"

@dataclass
class ColorPalette:
    """Representa una paleta de colores"""
    colors: List[Tuple[int, int, int, int]]  # RGBA
    palette_type: int = 0  # 0=light background, 1=dark background
    name: str = ""

    def __post_init__(self):
        """Validar colores"""
        for color in self.colors:
            if len(color) != 4:
                raise ValueError(f"Cada color debe ser RGBA (4 valores), recibido: {color}")
            for value in color:
                if not 0 <= value <= 255:
                    raise ValueError(f"Valores de color deben estar entre 0-255, recibido: {value}")

@dataclass
class TextureLayer:
    """Representa una capa de textura"""
    glyph_name: str
    color_index: int
    transform: Optional[Transform] = None
    opacity: float = 1.0
    blend_mode: str = "normal"
    clip_glyph: Optional[str] = None  # Glyph para recortar (halo); None = glyph_name
    effect_mode: str = "default"  # "glow" = blur escalado, "outline" = corte limpio, "default" = halo simple

@dataclass
class TexturedGlyph:
    """Representa un glyph con texturas"""
    base_glyph: str
    layers: List[TextureLayer] = field(default_factory=list)
    name: str = ""

@dataclass
class VectorTexture:
    """Textura vectorial (paths SVG)"""
    svg_path: str  # Path al archivo SVG
    glyph_name: str
    scale: float = 1.0
    transform: Optional[Transform] = None

@dataclass
class RasterTexture:
    """Textura raster (imagen)"""
    image_path: str  # Path a la imagen
    glyph_name: str
    scale: float = 1.0
    position: Tuple[float, float] = (0, 0)

@dataclass
class FontTextures:
    """Configuración completa de texturas para una fuente"""
    font_path: str
    output_path: str
    palettes: List[ColorPalette]
    textured_glyphs: Dict[str, TexturedGlyph]
    vector_textures: Dict[str, VectorTexture] = field(default_factory=dict)
    raster_textures: Dict[str, RasterTexture] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    version: str = "1.0"

# ============================================================================
# EXCEPCIONES PERSONALIZADAS
# ============================================================================

class FontTextureError(Exception):
    """Excepción base para errores de la API"""
    pass

class FontLoadError(FontTextureError):
    """Error al cargar la fuente"""
    pass

class TextureConversionError(FontTextureError):
    """Error al convertir textura"""
    pass

class GlyphNotFoundError(FontTextureError):
    """Glyph no encontrado en la fuente"""
    pass

class TextureValidationError(FontTextureError):
    """Error de validación de textura"""
    pass

# ============================================================================
# PROCESADOR DE TEXTURAS
# ============================================================================

class TextureProcessor:
    """Procesa y convierte diferentes tipos de texturas"""
    
    @staticmethod
    def raster_to_svg(image_path: str, output_svg: str, 
                     threshold: int = 128, colors: int = 2) -> None:
        """
        Convierte una imagen raster a SVG usando potrace
        
        Args:
            image_path: Ruta de la imagen de entrada
            output_svg: Ruta del archivo SVG de salida
            threshold: Umbral para binarización (0-255)
            colors: Número de colores (2-256)
        """
        try:
            # Convertir a BMP para potrace
            with Image.open(image_path) as img:
                # Convertir a escala de grises y binarizar
                img = img.convert('L')
                img = img.point(lambda p: 255 if p > threshold else 0)
                
                # Guardar como BMP temporal
                with tempfile.NamedTemporaryFile(suffix='.bmp', delete=False) as tmp:
                    img.save(tmp.name, 'BMP')
                    tmp_path = tmp.name
            
            # Ejecutar potrace
            result = subprocess.run([
                'potrace', 
                '--svg', 
                '--turdsize', '2',
                '--alphamax', '0',
                '--opttolerance', '0.2',
                '--group',
                '-o', output_svg,
                tmp_path
            ], capture_output=True, text=True)
            
            if result.returncode != 0:
                raise TextureConversionError(f"Potrace falló: {result.stderr}")
            
            # Limpiar archivo temporal
            os.unlink(tmp_path)
            
        except Exception as e:
            raise TextureConversionError(f"Error convirtiendo raster a SVG: {e}")
    
    @staticmethod
    def optimize_svg(svg_path: str, output_path: Optional[str] = None) -> str:
        """
        Optimiza un archivo SVG para uso en fuentes
        
        Args:
            svg_path: Ruta del SVG de entrada
            output_path: Ruta del SVG optimizado (opcional)
        
        Returns:
            Ruta del SVG optimizado
        """
        if output_path is None:
            output_path = svg_path.replace('.svg', '_optimized.svg')
        
        try:
            # Parsear SVG
            tree = ET.parse(svg_path)
            root = tree.getroot()
            
            # Remover elementos no necesarios
            for elem in root.findall('.//*'):
                # Remover atributos no esenciales
                for attr in ['id', 'class', 'style', 'data-*']:
                    if attr in elem.attrib:
                        del elem.attrib[attr]
            
            # Simplificar paths
            for path in root.findall('.//{http://www.w3.org/2000/svg}path'):
                d = path.get('d', '')
                # Simplificar el path (mantener solo esencial)
                # Nota: Esta es una simplificación básica
                if 'stroke' in path.attrib:
                    del path.attrib['stroke']
                if 'stroke-width' in path.attrib:
                    del path.attrib['stroke-width']
            
            # Guardar
            tree.write(output_path, encoding='utf-8', xml_declaration=True)
            return output_path
            
        except Exception as e:
            raise TextureConversionError(f"Error optimizando SVG: {e}")
    
    @staticmethod
    def svg_to_font_glyph(svg_path: str, glyph_name: str,
                          font: TTFont, scale: float = 1.0,
                          transform: Optional[Transform] = None) -> bool:
        """
        Convierte un SVG a un glyph en la fuente.

        Args:
            svg_path: Ruta del archivo SVG
            glyph_name: Nombre del glyph a crear/actualizar
            font: Fuente TTFont
            scale: Factor de escala adicional (se aplica DESPUÉS de la
                   normalización SVG→UPM automática)
            transform: Transformación adicional

        Returns:
            True si se creó el glyph exitosamente
        """
        try:
            # Parsear SVG
            tree = ET.parse(svg_path)
            root = tree.getroot()

            # ── Extraer viewBox/width/height para normalizar coords ──────────
            svg_width = 1.0
            svg_height = 1.0
            vb = root.get('viewBox', '').strip()
            if vb:
                parts = vb.replace(',', ' ').split()
                if len(parts) == 4:
                    try:
                        svg_width  = float(parts[2])
                        svg_height = float(parts[3])
                    except ValueError:
                        pass
            else:
                try:
                    svg_width  = float(root.get('width',  '200').replace('px',''))
                    svg_height = float(root.get('height', '200').replace('px',''))
                except ValueError:
                    pass

            # UPM de la fuente (unidades por em)
            upm = font['head'].unitsPerEm if 'head' in font else 1000

            # Factor de escala total: SVG coords → UPM, luego factor scale adicional
            # También invertimos Y: en SVG Y crece hacia abajo, en fuentes sube.
            scale_x =  (upm / svg_width)  * scale
            scale_y = -(upm / svg_height) * scale   # negativo = flip vertical
            offset_y = upm                           # mover arriba tras el flip

            # Obtener paths - probar con y sin namespace
            paths = []
            # Método 1: con namespace
            for path_elem in root.findall('.//{http://www.w3.org/2000/svg}path'):
                d = path_elem.get('d', '')
                if d:
                    paths.append(d)

            # Método 2: sin namespace (si el SVG no tiene namespace)
            if not paths:
                for path_elem in root.findall('.//path'):
                    d = path_elem.get('d', '')
                    if d:
                        paths.append(d)

            # Método 3: iterar todos los elementos y buscar path
            if not paths:
                for elem in root.iter():
                    tag = elem.tag
                    if '}' in tag:
                        tag = tag.split('}')[-1]
                    if tag == 'path':
                        d = elem.get('d', '')
                        if d:
                            paths.append(d)

            # Convertir otros elementos SVG a paths
            if not paths:
                paths = TextureProcessor._convert_svg_elements_to_paths(root)

            if not paths:
                raise TextureValidationError("No se encontraron paths en el SVG")

            # Crear pen para el glyph
            glyph_set = font.getGlyphSet()
            pen = TTGlyphPen(glyph_set)

            # Procesar cada path
            # FIX: detectar fill-rule="evenodd" (en el root o en cualquier
            # elemento) para respetar agujeros (kiwi.svg, brick-wall.svg...)
            fill_rule = root.get('fill-rule', '')
            if fill_rule != 'evenodd':
                for elem in root.iter():
                    if elem.get('fill-rule') == 'evenodd':
                        fill_rule = 'evenodd'
                        break
            use_evenodd = (fill_rule == 'evenodd')

            # FIX: SVG evalúa fill-rule sobre TODOS los subpaths de TODOS los
            # <path> combinados, no por cada <path> por separado (un agujero
            # puede vivir en un <path> distinto del contorno que lo envuelve,
            # p.ej. ladrillo_recto.svg). Acumulamos los comandos de todos los
            # paths y aplicamos evenodd una sola vez al conjunto completo.
            # Además, los paths dibujados con STROKE (fill="none" + stroke-width)
            # se expanden a formas rellenas con grosor (p.ej. Ladrillo-2.svg).
            all_commands: List[Tuple[str, List[float]]] = []
            for path_elem in root.iter():
                tag = path_elem.tag.split('}')[-1] if '}' in str(path_elem.tag) else str(path_elem.tag)
                if tag != 'path':
                    continue
                d = path_elem.get('d', '')
                if not d:
                    continue
                fill = path_elem.get('fill', '')
                stroke = path_elem.get('stroke', '')
                sw = path_elem.get('stroke-width', '')
                # Solo expandir stroke en paths ABIERTOS (sin 'Z'): los trazos
                # sueltos de esquinas curvas (p.ej. Ladrillo-2.svg). Los paths
                # cerrados con fill="none" + stroke (p.ej. Ladrillo.svg) se
                # mantienen como relleno para no cambiar su aspecto actual.
                is_open_stroke = (
                    fill in ('none', '') and stroke not in ('', 'none') and sw
                    and 'Z' not in d and 'z' not in d
                )
                if is_open_stroke:
                    try:
                        stroke_commands = TextureProcessor._expand_stroke_to_fill(d, float(sw))
                    except ValueError:
                        stroke_commands = []
                    if stroke_commands:
                        all_commands.extend(stroke_commands)
                        continue
                commands = TextureProcessor._parse_svg_path(d)

                # Aplicar transformaciones adicionales del usuario
                if transform:
                    commands = TextureProcessor._apply_transform_to_commands(commands, transform)

                all_commands.extend(commands)

            # FIX: Si el SVG no tenía elementos <path> (solo <rect>, <circle>,
            # <line>, etc. como los efectos metallic.svg y neon.svg), los paths
            # convertidos por _convert_svg_elements_to_paths están en `paths`
            # pero no se procesaron en el bucle anterior (que solo busca <path>
            # en el DOM). Parsearlos directamente para que el glyph no quede vacío.
            if not all_commands and paths:
                for d in paths:
                    commands = TextureProcessor._parse_svg_path(d)
                    if transform:
                        commands = TextureProcessor._apply_transform_to_commands(commands, transform)
                    all_commands.extend(commands)

            if use_evenodd:
                all_commands = TextureProcessor._apply_evenodd(all_commands)

            # Dibujar usando el pen con escala SVG→UPM + flip Y
            TextureProcessor._draw_path_commands(
                pen, all_commands,
                scale_x=scale_x,
                scale_y=scale_y,
                offset_y=offset_y
            )

            # ── Guardar el glyph en la fuente ─────────────────────────────────
            # FIX: solo añadir al orden si el glyph es NUEVO
            glyph_existed = glyph_name in font.getGlyphOrder()
            if not glyph_existed:
                font.setGlyphOrder(font.getGlyphOrder() + [glyph_name])
            font['glyf'].glyphs[glyph_name] = pen.glyph()

            # Agregar métricas hmtx para el nuevo glyph
            if 'hmtx' in font and not glyph_existed:
                if 'A' in font['hmtx'].metrics:
                    font['hmtx'].metrics[glyph_name] = font['hmtx'].metrics['A']
                else:
                    first_metric = next(iter(font['hmtx'].metrics.values()), (500, 0))
                    font['hmtx'].metrics[glyph_name] = first_metric

            return True

        except Exception as e:
            raise TextureConversionError(f"Error convirtiendo SVG a glyph: {e}")
    
    @staticmethod
    def _parse_svg_path(path_data: str) -> List[Tuple[str, List[float]]]:
        """Parsea un path SVG a comandos internos usando svg.path"""
        from svg.path import parse_path
        from svg.path.path import Line, CubicBezier, QuadraticBezier, Arc, Close, Move
        
        commands = []
        try:
            path = parse_path(path_data)
            
            for segment in path:
                if isinstance(segment, Move):
                    commands.append(('M', [segment.end.real, segment.end.imag]))
                elif isinstance(segment, Line):
                    commands.append(('L', [segment.end.real, segment.end.imag]))
                elif isinstance(segment, CubicBezier):
                    commands.append(('C', [
                        segment.control1.real, segment.control1.imag,
                        segment.control2.real, segment.control2.imag,
                        segment.end.real, segment.end.imag
                    ]))
                elif isinstance(segment, QuadraticBezier):
                    commands.append(('Q', [
                        segment.control.real, segment.control.imag,
                        segment.end.real, segment.end.imag
                    ]))
                elif isinstance(segment, Arc):
                    # FIX: aplanar el arco en una polilínea en vez de una sola
                    # línea recta. Antes, un círculo (2 arcos de 180°) colapsaba
                    # a una línea de 2 puntos SIN área -> invisible/deformado
                    # (p.ej. kiwi.svg, bevel-circle.svg).
                    ARC_SAMPLES = 32
                    for i in range(1, ARC_SAMPLES + 1):
                        t = i / ARC_SAMPLES
                        p = segment.point(t)
                        commands.append(('L', [p.real, p.imag]))
                elif isinstance(segment, Close):
                    commands.append(('Z', []))
        
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise
        # FIX: los paths SVG abiertos (sin Z) se cierran implícitamente para el
        # relleno. Sin esto, TTGlyphPen lanza PenError con el siguiente moveTo
        # ("move-type point must begin a new contour") — p.ej. Ladrillo-2.svg
        # del usuario, cuyas esquinas curvas se exportan como segmentos sueltos.
        if commands and commands[-1][0] != 'Z':
            commands.append(('Z', []))
        return commands

    @staticmethod
    def _expand_stroke_to_fill(path_data: str, stroke_width: float) -> List[Tuple[str, List[float]]]:
        """
        Convierte un path dibujado con STROKE (trazos, fill="none") en formas
        rellenas con grosor. Las fuentes TrueType no soportan strokes: una
        línea de 2 puntos abierta tiene área 0 y es invisible. Expandimos cada
        segmento a una cinta (rectángulo) de ancho stroke_width.
        P.ej. Ladrillo-2.svg del usuario: esquinas curvas exportadas como
        segmentos sueltos con stroke="#ffffff" stroke-width="2".
        """
        from svg.path import parse_path
        from svg.path.path import Line, CubicBezier, QuadraticBezier, Arc, Move, Close
        import math

        try:
            path = parse_path(path_data)
        except Exception:
            return []

        commands: List[Tuple[str, List[float]]] = []
        hw = stroke_width / 2.0
        SEG_SAMPLES = 12  # muestras por curva/arco para la cinta

        def emit_ribbon(p0, p1):
            """Cinta (rectángulo girado) entre p0 y p1 con grosor stroke_width."""
            x0, y0 = p0.real, p0.imag
            x1, y1 = p1.real, p1.imag
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length < 1e-9:
                return
            nx, ny = -dy / length * hw, dx / length * hw
            commands.append(('M', [x0 + nx, y0 + ny]))
            commands.append(('L', [x1 + nx, y1 + ny]))
            commands.append(('L', [x1 - nx, y1 - ny]))
            commands.append(('L', [x0 - nx, y0 - ny]))
            commands.append(('Z', []))

        prev = None
        for seg in path:
            if isinstance(seg, Move):
                prev = seg.end
            elif isinstance(seg, Line):
                if prev is not None:
                    emit_ribbon(prev, seg.end)
                prev = seg.end
            elif isinstance(seg, (CubicBezier, QuadraticBezier)):
                if prev is not None:
                    for i in range(SEG_SAMPLES):
                        t0 = i / SEG_SAMPLES
                        t1 = (i + 1) / SEG_SAMPLES
                        emit_ribbon(seg.point(t0), seg.point(t1))
                prev = seg.end
            elif isinstance(seg, Arc):
                if prev is not None:
                    for i in range(SEG_SAMPLES):
                        t0 = i / SEG_SAMPLES
                        t1 = (i + 1) / SEG_SAMPLES
                        emit_ribbon(seg.point(t0), seg.point(t1))
                prev = seg.end
            elif isinstance(seg, Close):
                if prev is not None and path and hasattr(path, '__iter__'):
                    # cerrar al primer punto del subpath (aproximación: cerrar
                    # al primer segmento visto no es trivial aquí; el cierre se
                    # pierde, pero para trazos sueltos no suele existir Close)
                    pass
                prev = None
        return commands

    @staticmethod
    def _reverse_subpath(sub: List[Tuple[str, List[float]]]) -> List[Tuple[str, List[float]]]:
        """Invierte el orden de un subpath (M...Z) para crear un agujero."""
        if not sub:
            return sub
        has_z = sub[-1][0] == 'Z'
        segs = sub[1:-1] if has_z else sub[1:]
        pts = [sub[0][1]]
        for cmd, args in segs:
            if cmd == 'L':
                pts.append(args)
            elif cmd == 'C':
                pts.append([args[4], args[5]])
            elif cmd == 'Q':
                pts.append([args[2], args[3]])
        out: List[Tuple[str, List[float]]] = [('M', pts[-1])]
        for i in range(len(segs) - 1, -1, -1):
            cmd, args = segs[i]
            if cmd == 'L':
                out.append(('L', pts[i]))
            elif cmd == 'C':
                out.append(('C', [args[2], args[3], args[0], args[1], pts[i][0], pts[i][1]]))
            elif cmd == 'Q':
                out.append(('Q', [args[0], args[1], pts[i][0], pts[i][1]]))
        if has_z:
            out.append(('Z', []))
        return out

    @staticmethod
    def _apply_evenodd(commands: List[Tuple[str, List[float]]]) -> List[Tuple[str, List[float]]]:
        """
        Convierte fill-rule='evenodd' a winding rule (la que usa TrueType):
        invierte la dirección de los subpaths que están dentro de un número
        impar de otros subpaths, de modo que el rasterizador los trate como
        agujeros (p.ej. los ojos/semillas de kiwi.svg, los huecos de
        brick-wall.svg y bevel-circle.svg).
        """
        subpaths: List[List[Tuple[str, List[float]]]] = []
        current: List[Tuple[str, List[float]]] = []
        for cmd, args in commands:
            if cmd == 'M' and current:
                subpaths.append(current)
                current = []
            current.append((cmd, args))
        if current:
            subpaths.append(current)

        if len(subpaths) < 2:
            return commands

        def poly_points(sub):
            poly = []
            for cmd, args in sub:
                if cmd == 'M':
                    poly.append((args[0], args[1]))
                elif cmd == 'L':
                    poly.append((args[0], args[1]))
                elif cmd == 'C':
                    poly.append((args[4], args[5]))
                elif cmd == 'Q':
                    poly.append((args[2], args[3]))
            return poly

        def point_in_poly(pt, poly):
            x, y = pt
            inside = False
            n = len(poly)
            for i in range(n):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % n]
                if (y1 > y) != (y2 > y):
                    xinters = (x2 - x1) * (y - y1) / (y2 - y1) + x1
                    if x < xinters:
                        inside = not inside
            return inside

        def sample_points(sub):
            """Puntos representativos del subpath: el centroide y los puntos
            medios de cada segmento desplazados un 10% hacia el centroide.
            Así los puntos están DENTRO del subpath (no en bordes compartidos
            con otros subpaths), evitando falsos positivos en el ray casting."""
            pts = []
            prev = None
            for cmd, args in sub:
                if cmd == 'M':
                    prev = (args[0], args[1])
                    pts.append(prev)
                elif cmd == 'L':
                    end = (args[0], args[1])
                    if prev:
                        pts.append(((prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2))
                    pts.append(end)
                    prev = end
                elif cmd == 'C':
                    end = (args[4], args[5])
                    if prev:
                        pts.append(((prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2))
                    pts.append(end)
                    prev = end
                elif cmd == 'Q':
                    end = (args[2], args[3])
                    if prev:
                        pts.append(((prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2))
                    pts.append(end)
                    prev = end
            if not pts:
                return pts
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            # centroide + puntos desplazados ligeramente hacia el centroide
            # (0.5%: suficiente para no caer en bordes compartidos, pero
            # detecta sobresalir reales como las hojas de autumn.svg)
            moved = [((p[0] * 0.995 + cx * 0.005), (p[1] * 0.995 + cy * 0.005)) for p in pts]
            moved.append((cx, cy))
            return moved

        polys = [poly_points(sp) for sp in subpaths]

        result: List[Tuple[str, List[float]]] = []
        for i, sp in enumerate(subpaths):
            samples = sample_points(sp)
            if not samples:
                result.extend(sp)
                continue
            inside_count = 0
            for pt in samples:
                depth = 0
                for j, other_poly in enumerate(polys):
                    if i == j or len(other_poly) < 3:
                        continue
                    if point_in_poly(pt, other_poly):
                        depth += 1
                if depth % 2 == 1:
                    inside_count += 1
            # Es un agujero solo si está TOTALMENTE dentro de un número impar
            # de otros subpaths (100% de sus puntos). Los agujeros reales
            # (ojos/semillas de kiwi, huecos de brick-wall) están 100%
            # contenidos; las formas vecinas que solo se cruzan parcialmente
            # (hojas de autumn.svg) no deben invertirse porque el evenodd
            # real solo recorta la intersección, no el subpath entero.
            if inside_count >= len(samples):
                sp = TextureProcessor._reverse_subpath(sp)
            result.extend(sp)
        return result

    @staticmethod
    def _apply_transform_to_commands(commands: List[Tuple[str, List[float]]], 
                                     transform: Transform) -> List[Tuple[str, List[float]]]:
        """Aplica una transformación a los comandos del path"""
        # Implementación básica de transformación
        transformed = []
        for cmd, args in commands:
            if cmd.lower() in 'ml':
                # Transformar puntos
                x, y = args[0], args[1]
                new_x, new_y = transform.transformPoint((x, y))
                transformed.append((cmd, [new_x, new_y]))
            elif cmd.lower() == 'c':
                # Transformar puntos de control
                p1 = transform.transformPoint((args[0], args[1]))
                p2 = transform.transformPoint((args[2], args[3]))
                p3 = transform.transformPoint((args[4], args[5]))
                transformed.append((cmd, [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]))
            elif cmd.lower() == 'q':
                # Transformar puntos de control quadratic
                p1 = transform.transformPoint((args[0], args[1]))
                p2 = transform.transformPoint((args[2], args[3]))
                transformed.append((cmd, [p1[0], p1[1], p2[0], p2[1]]))
            else:
                transformed.append((cmd, args))
        return transformed
    
    @staticmethod
    def _draw_path_commands(pen: TTGlyphPen, commands: List[Tuple[str, List[float]]],
                            scale: float = 1.0,
                            scale_x: Optional[float] = None,
                            scale_y: Optional[float] = None,
                            offset_y: float = 0.0) -> None:
        """
        Dibuja los comandos del path usando el pen.

        Parámetros de escala:
          - Si se pasan scale_x / scale_y, se usan en lugar de `scale`.
          - offset_y permite trasladar verticalmente (necesario tras flip Y).
        """
        sx = scale_x if scale_x is not None else scale
        sy = scale_y if scale_y is not None else scale

        def tx(x: float, y: float) -> tuple:
            return (x * sx, y * sy + offset_y)

        for cmd, args in commands:
            if cmd.lower() == 'm':
                x, y = args
                pen.moveTo(tx(x, y))
            elif cmd.lower() == 'l':
                x, y = args
                pen.lineTo(tx(x, y))
            elif cmd.lower() == 'c':
                x1, y1, x2, y2, x3, y3 = args
                pen.curveTo(tx(x1, y1), tx(x2, y2), tx(x3, y3))
            elif cmd.lower() == 'q':
                x1, y1, x2, y2 = args
                pen.qCurveTo(tx(x1, y1), tx(x2, y2))
            elif cmd.lower() == 'z':
                pen.closePath()

    @staticmethod
    def _convert_svg_elements_to_paths(root: ET.Element) -> List[str]:
        """Convierte otros elementos SVG a paths cuando no existen elements <path>."""
        paths = []
        for elem in root.iter():
            tag = elem.tag
            # Handle SVG namespace variations
            if '}' in tag:
                tag = tag.split('}')[-1]
            
            if tag == 'rect':
                # Rectangle to path conversion
                x = elem.get('x', '0')
                y = elem.get('y', '0')
                width = elem.get('width', '0')
                height = elem.get('height', '0')
                if width and height:
                    try:
                        x, y, width, height = map(float, [x, y, width, height])
                        paths.append(
                            f'M{x} {y} L{x+width} {y} L{x+width} {y+height} '
                            f'L{x} {y+height} Z'
                        )
                    except ValueError:
                        pass  # Skip malformed numeric attributes
                        
            elif tag == 'circle':
                # Circle to approximate rectangular path
                cx = elem.get('cx', '0')
                cy = elem.get('cy', '0')
                r = elem.get('r', '0')
                if r and cx and cy:
                    try:
                        cx, cy, r = map(float, [cx, cy, r])
                        # Simple rectangular approximation
                        paths.append(
                            f'M{cx-r} {cy-r} L{cx+r} {cy-r} L{cx+r} {cy+r} '
                            f'L{cx-r} {cy+r} Z'
                        )
                    except ValueError:
                        pass
                        
            elif tag == 'ellipse':
                # Ellipse to approximate rectangular path
                cx = elem.get('cx', '0')
                cy = elem.get('cy', '0')
                rx = elem.get('rx', '0')
                ry = elem.get('ry', '0')
                if rx and ry and cx and cy:
                    try:
                        cx, cy, rx, ry = map(float, [cx, cy, rx, ry])
                        paths.append(
                            f'M{cx-rx} {cy-ry} L{cx+rx} {cy-ry} L{cx+rx} {cy+ry} '
                            f'L{cx-rx} {cy+ry} Z'
                        )
                    except ValueError:
                        pass
                        
            elif tag == 'line':
                # Line element to path
                x1 = elem.get('x1', '0')
                y1 = elem.get('y1', '0')
                x2 = elem.get('x2', '0')
                y2 = elem.get('y2', '0')
                if x1 and y1 and x2 and y2:
                    try:
                        x1, y1, x2, y2 = map(float, [x1, y1, x2, y2])
                        paths.append(f'M{x1} {y1} L{x2} {y2}')
                    except ValueError:
                        pass
                        
            elif tag == 'polyline':
                # Polyline points to path
                points = elem.get('points', '')
                if points and ';' not in points:
                    try:
                        pts = [p.strip() for p in points.split(',')]
                        paths.append(f'M{pts[0]}')
                        # Actually convert to path commands; keep it simple
                        if len(pts) > 1:
                            paths[-1] = 'M' + pts[0]  # Keep initial move
                    except Exception:
                        pass
                        
            elif tag == 'text':
                # Text element - could be handled differently
                # For simplicity, we'll skip or create a simple path
                pass
                
        return paths

# ============================================================================
# API PRINCIPAL DE TEXTURAS
# ============================================================================

class FontTextureAPI:
    """
    API principal para aplicar texturas a fuentes TTF usando COLRv1/CPAL
    
    Uso:
        api = FontTextureAPI()
        
        # Cargar fuente
        api.load_font("input.ttf")
        
        # Definir paletas
        palettes = [
            ColorPalette(
                colors=[(255,0,0,255), (0,255,0,255), (0,0,255,255)],
                name="palette1"
            )
        ]
        
        # Definir texturas
        textures = FontTextures(
            font_path="input.ttf",
            output_path="output.ttf",
            palettes=palettes,
            textured_glyphs={
                "A": TexturedGlyph(
                    base_glyph="A",
                    layers=[
                        TextureLayer(glyph_name="A.base", color_index=0),
                        TextureLayer(glyph_name="A.texture1", color_index=1)
                    ]
                )
            },
            vector_textures={
                "A.texture1": VectorTexture(
                    svg_path="texture.svg",
                    glyph_name="A.texture1"
                )
            }
        )
        
        # Generar fuente con texturas
        api.apply_textures(textures)
    """
    
    def __init__(self):
        self.font: Optional[TTFont] = None
        self.font_path: Optional[str] = None
        self.processor = TextureProcessor()
        self._glyph_cache: Dict[str, Any] = {}
        
    def load_font(self, font_path: str) -> 'FontTextureAPI':
        """
        Carga una fuente TTF
        
        Args:
            font_path: Ruta del archivo .ttf
            
        Returns:
            self para encadenamiento
            
        Raises:
            FontLoadError: Si no se puede cargar la fuente
        """
        try:
            self.font = TTFont(font_path)
            self.font_path = font_path
            self._glyph_cache.clear()
            return self
        except Exception as e:
            raise FontLoadError(f"No se pudo cargar la fuente: {e}")
    
    def save_font(self, output_path: Optional[str] = None) -> None:
        """
        Guarda la fuente procesada
        
        Args:
            output_path: Ruta de salida (opcional)
            
        Raises:
            FontLoadError: Si no hay fuente cargada
        """
        if not self.font:
            raise FontLoadError("No hay fuente cargada")
        
        output_path = output_path or self.font_path.replace('.ttf', '_textured.ttf')
        try:
            self.font.save(output_path)
            print(f"Fuente guardada en: {output_path}")
        except Exception as e:
            raise FontTextureError(f"Error guardando fuente: {e}")
    
    def apply_textures(self, textures: FontTextures) -> 'FontTextureAPI':
        """
        Aplica texturas a la fuente cargada
        
        Args:
            textures: Configuración de texturas
            
        Returns:
            self para encadenamiento
        """
        if not self.font:
            raise FontLoadError("Primero debe cargar una fuente con load_font()")
        
        try:
            # 1. Crear CPAL
            self._create_cpal(textures.palettes)
            
            # 2. Agregar texturas vectoriales (crea los glyphs)
            for name, vector_texture in textures.vector_textures.items():
                self._add_vector_texture(vector_texture)
            
            # 3. Agregar texturas raster (crea los glyphs)
            for name, raster_texture in textures.raster_textures.items():
                self._add_raster_texture(raster_texture)
            
            # 4. Crear COLR (después de que existen todos los glyphs)
            self._create_colr(textures.textured_glyphs)
            
            # 5. Agregar metadatos
            if textures.metadata:
                self._add_metadata(textures.metadata)
            
            return self
            
        except Exception as e:
            raise FontTextureError(f"Error aplicando texturas: {e}")
    
    def _create_cpal(self, palettes: List[ColorPalette]) -> None:
        """Crea la tabla CPAL en la fuente, preservando la paleta previa si existe.

        Si la fuente ya tenía CPAL, sus colores se conservan al INICIO de la
        paleta final para que los índices de las pinturas COLR existentes
        (textura previa) sigan apuntando a sus colores originales. Los colores
        nuevos se añaden después; el script aplica el mismo desplazamiento a
        los índices de las capas nuevas.
        """
        from fontTools.ttLib.tables.C_P_A_L_ import Color  # type: ignore[import]
        cpal = table_C_P_A_L_()
        
        # Recolectar colores previos (paleta 0 de la CPAL existente)
        prev_colors = []
        cpal_prev = self.font.get("CPAL")
        if cpal_prev is not None and cpal_prev.palettes:
            for c in cpal_prev.palettes[0]:
                # Color guarda (blue, green, red, alpha) → pasar a RGBA
                prev_colors.append((c.red, c.green, c.blue, c.alpha))
        
        # Paleta final: colores previos + colores nuevos (concatenados en UNA paleta,
        # porque PaletteIndex es un índice dentro de la paleta activa)
        final_colors = list(prev_colors)
        for palette in palettes:
            final_colors.extend(palette.colors)
        
        # Convertir a objetos Color (formato BGRA)
        colors_rgba = []
        for r, g, b, a in final_colors:
            # Color constructor takes (blue, green, red, alpha)
            colors_rgba.append(Color(b, g, r, a))
        
        cpal.palettes = [colors_rgba]
        cpal.paletteTypes = [palettes[0].palette_type if palettes else 0]
        cpal.paletteLabels = [palettes[0].name.encode('utf-8') if palettes and palettes[0].name else b'']
        cpal.paletteEntryLabels = [[b''] * len(colors_rgba)]
        
        # Configurar campos requeridos
        cpal.version = 0
        cpal.numPaletteEntries = len(colors_rgba)
        
        # Guardar en la fuente
        self.font["CPAL"] = cpal
    
    def _get_existing_colr_paints(self) -> Dict[str, Any]:
        """Extrae las pinturas COLR v1 existentes por glyph base, como DICTS.

        Devuelve {glyph_name: dict} listos para buildCOLR: las referencias por
        índice de PaintColrLayers se resuelven contra el LayerList previo, para
        que buildCOLR pueda reindexar correctamente. Vacío si la fuente no
        tiene COLR v1 (o la tabla no tiene BaseGlyphList, p.ej. COLR v0).
        """
        prev: Dict[str, Any] = {}
        colr_prev = self.font.get("COLR")
        if colr_prev is None:
            return prev
        table = getattr(colr_prev, "table", None)
        if table is None:
            return prev

        layer_list = getattr(table, "LayerList", None)
        paints = list(layer_list.Paint) if layer_list is not None and getattr(layer_list, "Paint", None) else []

        def resolve(paint) -> Any:
            if paint is None:
                return None
            fmt = getattr(paint, "Format", None)
            if fmt == 1:  # PaintColrLayers: resolver subcapas por índice
                first = getattr(paint, "FirstLayerIndex", 0) or 0
                num = getattr(paint, "NumLayers", 0) or 0
                sub = [resolve(p) for p in paints[first:first + num]]
                return {"Format": 1, "Layers": sub}
            if fmt == 2:  # PaintSolid
                return {"Format": 2, "PaletteIndex": paint.PaletteIndex, "Alpha": getattr(paint, "Alpha", 1.0)}
            if fmt == 3:  # PaintVarSolid
                return {"Format": 3, "PaletteIndex": paint.PaletteIndex, "Alpha": getattr(paint, "Alpha", 1.0), "VarIndexBase": getattr(paint, "VarIndexBase", 0)}
            if fmt == 5:  # PaintGlyph
                return {"Format": 5, "Glyph": paint.Glyph, "Paint": resolve(paint.Paint)}
            if fmt == 6:  # PaintColrGlyph
                return {"Format": 6, "Glyph": paint.Glyph}
            if fmt == 7:  # PaintTransform
                return {"Format": 7, "Paint": resolve(paint.Paint), "Transform": paint.Transform}
            if fmt == 9:  # PaintTranslate
                return {"Format": 9, "Paint": resolve(paint.Paint), "Dx": paint.Dx, "Dy": paint.Dy}
            # Fallback genérico: copiar atributos planos
            out = {"Format": fmt}
            for k, v in paint.__dict__.items():
                if k in ("Format", "Layers", "FirstLayerIndex", "NumLayers"):
                    continue
                out[k] = v
            return out

        base_list = getattr(table, "BaseGlyphList", None)
        if base_list is not None:
            for rec in base_list.BaseGlyphPaintRecord:
                prev[rec.BaseGlyph] = resolve(rec.Paint)
        return prev

    def _create_colr(self, textured_glyphs: Dict[str, TexturedGlyph]) -> None:
        """Crea la tabla COLR v1 usando PaintGlyph para recortar la textura al contorno.

        Si la fuente ya tenía COLR (p.ej. una textura previa) y el glyph no
        define una capa base explícita, la pintura existente se preserva como
        primera capa (se dibuja debajo de las capas nuevas). Así una fuente ya
        texturizada puede recibir un efecto de iluminación sin perder su textura.
        """
        from fontTools.ttLib.tables.otTables import PaintFormat

        prev_paints = self._get_existing_colr_paints()
        color_glyphs = {}

        for glyph_name, textured_glyph in textured_glyphs.items():
            if glyph_name not in self.font.getGlyphOrder():
                raise GlyphNotFoundError(f"Glyph '{glyph_name}' no encontrado en la fuente")

            # Separar capas de efecto (halo, con clip_glyph) de capas normales
            effect_layers = [l for l in textured_glyph.layers if l.clip_glyph]
            normal_layers = [l for l in textured_glyph.layers if not l.clip_glyph]

            # Orden de pintado (COLR v1: la primera capa se dibuja debajo):
            #   1. Efecto halo (debajo de todo)
            #   2. Pintura previa preservada (si la hay)
            #   3. Capas normales (base + textura)
            # Así la letra/base tapa la parte interior del halo y solo se ve
            # la iluminación exterior.
            ordered = list(effect_layers) + normal_layers

            layers = []

            # ¿El glyph define capa base explícita (color sólido)? Si no, y la
            # fuente ya tenía pintura para este glyph, preservarla.
            has_base = any(layer.glyph_name == glyph_name for layer in normal_layers)
            prev_inserted = False
            if glyph_name in prev_paints and not has_base:
                layers.append(prev_paints[glyph_name])
                prev_inserted = True

            for i, layer in enumerate(ordered):
                # Insertar pintura previa después del halo pero antes de la base
                if not prev_inserted and glyph_name in prev_paints and not has_base \
                   and not layer.clip_glyph:
                    layers.append(prev_paints[glyph_name])
                    prev_inserted = True

                if layer.clip_glyph:
                    # Capa efecto: validar clip_glyph, no glyph_name
                    if layer.clip_glyph not in self.font.getGlyphOrder():
                        raise GlyphNotFoundError(f"Clip glyph '{layer.clip_glyph}' no encontrado")
                elif layer.glyph_name != glyph_name and layer.glyph_name not in self.font.getGlyphOrder():
                    raise GlyphNotFoundError(f"Layer glyph '{layer.glyph_name}' no encontrado")

                solid_paint = {
                    "Format": int(PaintFormat.PaintSolid),
                    "PaletteIndex": layer.color_index,
                    "Alpha": layer.opacity,
                }

                if layer.clip_glyph:
                    clip = layer.clip_glyph
                    if clip not in self.font.getGlyphOrder():
                        clip = glyph_name  # fallback seguro

                    upm = self.font['head'].unitsPerEm if 'head' in self.font else 1000
                    mode = layer.effect_mode

                    if mode == "outline":
                        # Corte limpio: una sola capa PaintGlyph con el halo
                        paint = {
                            "Format": int(PaintFormat.PaintGlyph),
                            "Glyph": clip,
                            "Paint": {
                                "Format": int(PaintFormat.PaintSolid),
                                "PaletteIndex": layer.color_index,
                                "Alpha": 0.9,
                            },
                        }
                    elif mode == "glow":
                        # Glow difuminado: muchas capas escaladas del halo
                        # (que sigue la forma de la letra) con alpha muy pequeño
                        # cada una. Con 24 capas e incrementos de ~1%, las bandas
                        # son imperceptibles → se percibe como un blur suave que
                        # sigue el contorno de la letra, no como un círculo.
                        glyph = self.font["glyf"][glyph_name]
                        cx = (glyph.xMin + glyph.xMax) / 2.0
                        cy = (glyph.yMin + glyph.yMax) / 2.0
                        glow_layers = []
                        n_layers = 24
                        max_scale = 1.24  # 24% más grande en el borde exterior
                        for i in range(n_layers):
                            t = i / (n_layers - 1)  # 0.0 → 1.0
                            s = 1.0 + t * (max_scale - 1.0)
                            # Alpha decreciente exponencial: empieza fuerte,
                            # termina casi transparente
                            alpha = round(0.08 * (1.0 - t) ** 1.5, 4)
                            if alpha <= 0.001:
                                continue
                            halo_paint = {
                                "Format": int(PaintFormat.PaintGlyph),
                                "Glyph": clip,
                                "Paint": {
                                    "Format": int(PaintFormat.PaintSolid),
                                    "PaletteIndex": layer.color_index,
                                    "Alpha": alpha,
                                },
                            }
                            if s == 1.0:
                                glow_layers.append(halo_paint)
                            else:
                                # Escalar desde el centro del bbox de la letra
                                tx = cx * (1 - s)
                                ty = cy * (1 - s)
                                glow_layers.append({
                                    "Format": int(PaintFormat.PaintTransform),
                                    "Paint": halo_paint,
                                    "Transform": (s, 0, 0, s, tx, ty),
                                })
                        paint = {
                            "Format": int(PaintFormat.PaintColrLayers),
                            "Layers": glow_layers,
                        }
                    else:
                        # default: 9 capas con offsets (comportamiento anterior)
                        off = int(upm * 0.015)
                        glow_layers = []
                        offsets = [
                            (0, 0, 0.5),
                            (off, 0, 0.35),
                            (-off, 0, 0.35),
                            (0, off, 0.35),
                            (0, -off, 0.35),
                            (off, off, 0.2),
                            (-off, off, 0.2),
                            (off, -off, 0.2),
                            (-off, -off, 0.2),
                        ]
                        for dx, dy, alpha in offsets:
                            halo_paint = {
                                "Format": int(PaintFormat.PaintGlyph),
                                "Glyph": clip,
                                "Paint": {
                                    "Format": int(PaintFormat.PaintSolid),
                                    "PaletteIndex": layer.color_index,
                                    "Alpha": alpha,
                                },
                            }
                            if dx == 0 and dy == 0:
                                glow_layers.append(halo_paint)
                            else:
                                glow_layers.append({
                                    "Format": int(PaintFormat.PaintTransform),
                                    "Paint": halo_paint,
                                    "Transform": (1, 0, 0, 1, dx, dy),
                                })
                        paint = {
                            "Format": int(PaintFormat.PaintColrLayers),
                            "Layers": glow_layers,
                        }
                elif layer.glyph_name == glyph_name:
                    # Capa base: color solido recortado al contorno de la letra
                    paint = {
                        "Format": int(PaintFormat.PaintGlyph),
                        "Glyph": glyph_name,
                        "Paint": solid_paint,
                    }
                else:
                    # Capa textura: SVG pintado con color, recortado al
                    # contorno de la letra.
                    paint = {
                        "Format": int(PaintFormat.PaintGlyph),
                        "Glyph": glyph_name,
                        "Paint": {
                            "Format": int(PaintFormat.PaintGlyph),
                            "Glyph": layer.glyph_name,
                            "Paint": solid_paint,
                        },
                    }

                layers.append(paint)

            color_glyphs[glyph_name] = {
                "Format": int(PaintFormat.PaintColrLayers),
                "Layers": layers,
            }

        glyph_map = self.font.getReverseGlyphMap()
        colr = buildCOLR(color_glyphs, version=1, glyphMap=glyph_map)
        # Calcular ClipBoxes para COLR v1 — algunos motores de render
        # (FreeType, navegadores) las necesitan para rasterizar correctamente.
        try:
            colr.table.computeClipBoxes(self.font["glyf"], glyph_map)
        except Exception:
            pass
        self.font["COLR"] = colr

    def create_halo_glyph(self, base_glyph_name: str, halo_glyph_name: str,
                          expansion: float = 0.015) -> None:
        """Crea un glyph expandido (halo) a partir del contorno de una letra.

        Duplica el outline del base_glyph y lo expande por fuera, creando una
        versión "engrosada" que se pintará como halo alrededor de la letra.
        El halo se almacena como un glyph nuevo en la fuente.

        Args:
            base_glyph_name: Nombre del glyph original (la letra).
            halo_glyph_name: Nombre para el glyph del halo a crear.
            expansion: Cuánto expandir el contorno, como fracción del UPM
                       (0.015 ≈ 1.5% del UPM — halo fino tipo neón).
        """
        if base_glyph_name not in self.font.getGlyphOrder():
            raise GlyphNotFoundError(f"Glyph '{base_glyph_name}' no encontrado para halo")

        upm = self.font['head'].unitsPerEm if 'head' in self.font else 1000
        expand_units = int(upm * expansion)

        glyph_set = self.font.getGlyphSet()
        pen = TTGlyphPen(glyph_set)

        # Obtener el glyph original y sus coordenadas
        glyf_table = self.font['glyf']
        base_glyph = glyf_table[base_glyph_name]

        # Usar RecordingPen para capturar los contornos
        recording_pen = RecordingPen()
        glyph_set[base_glyph_name].draw(recording_pen)

        # Reproducir los contornos con dilatación: mover cada punto en la
        # dirección de la normal exterior del contorno. Esto engrosa el trazo
        # hacia fuera sin escalar la letra entera (halo fino tipo neón).
        contours = self._extract_contours(recording_pen.value)
        for contour in contours:
            expanded = self._dilate_contour(contour, expand_units)
            if len(expanded) == 1:
                # Single point — skip
                continue
            pen.moveTo(expanded[0])
            for pt in expanded[1:]:
                pen.lineTo(pt)
            pen.closePath()

        # Guardar el glyph del halo
        glyph_existed = halo_glyph_name in self.font.getGlyphOrder()
        if not glyph_existed:
            self.font.setGlyphOrder(self.font.getGlyphOrder() + [halo_glyph_name])
        self.font['glyf'].glyphs[halo_glyph_name] = pen.glyph()

        if 'hmtx' in self.font and not glyph_existed:
            if base_glyph_name in self.font['hmtx'].metrics:
                self.font['hmtx'].metrics[halo_glyph_name] = self.font['hmtx'].metrics[base_glyph_name]
            else:
                first_metric = next(iter(self.font['hmtx'].metrics.values()), (500, 0))
                self.font['hmtx'].metrics[halo_glyph_name] = first_metric

    @staticmethod
    def _extract_contours(recording):
        """Extrae listas de puntos desde un RecordingPen, agrupadas por contour."""
        contours = []
        current = []
        for operator, operands in recording:
            if operator == "moveTo":
                if current:
                    contours.append(current)
                current = [operands[0]]
            elif operator == "lineTo":
                current.append(operands[0])
            elif operator in ("curveTo", "qCurveTo"):
                # Para curvas, añadir los puntos de control y el punto final
                for pt in operands:
                    if pt is not None:
                        current.append(pt)
            elif operator in ("closePath", "endPath"):
                if current:
                    contours.append(current)
                current = []
        if current:
            contours.append(current)
        return contours

    @staticmethod
    def _dilate_contour(points, expand_units):
        """Dilata un contorno moviendo cada punto en la dirección de la normal
        exterior. La normal se aproxima como el promedio de las normales de las
        dos aristas adyacentes al punto.

        Para contornos exteriores (sentido horario en fontTools), la normal
        exterior apunta hacia la derecha de la dirección de marcha.
        """
        if len(points) < 2:
            return points

        n = len(points)
        result = []
        for i in range(n):
            prev = points[(i - 1) % n]
            curr = points[i]
            next_ = points[(i + 1) % n]

            # Vector de la arista entrante (prev → curr)
            e1 = (curr[0] - prev[0], curr[1] - prev[1])
            # Vector de la arista saliente (curr → next)
            e2 = (next_[0] - curr[0], next_[1] - curr[1])

            # Normal de cada arista (rotar 90° a la derecha = exterior en CW)
            n1 = (-e1[1], e1[0])
            n2 = (-e2[1], e2[0])

            # Normalizar
            l1 = (n1[0]**2 + n1[1]**2) ** 0.5
            l2 = (n2[0]**2 + n2[1]**2) ** 0.5
            if l1 > 0:
                n1 = (n1[0] / l1, n1[1] / l1)
            if l2 > 0:
                n2 = (n2[0] / l2, n2[1] / l2)

            # Promediar las dos normales (mitad de ángulo)
            nx = n1[0] + n2[0]
            ny = n1[1] + n2[1]
            nl = (nx * nx + ny * ny) ** 0.5
            if nl > 0:
                nx /= nl
                ny /= nl
            else:
                nx, ny = n1  # fallback

            # Mover el punto por expand_units en la dirección de la normal
            new_x = int(curr[0] + nx * expand_units)
            new_y = int(curr[1] + ny * expand_units)
            result.append((new_x, new_y))

        return result

    def _add_vector_texture(self, texture: VectorTexture) -> None:
        """Agrega una textura vectorial a la fuente"""
        # Convertir SVG a glyph
        self.processor.svg_to_font_glyph(
            texture.svg_path,
            texture.glyph_name,
            self.font,
            scale=texture.scale,
            transform=texture.transform
        )
    
    def _add_raster_texture(self, texture: RasterTexture) -> None:
        """Agrega una textura raster a la fuente"""
        # Convertir raster a SVG temporal
        with tempfile.NamedTemporaryFile(suffix='.svg', delete=False) as tmp:
            svg_path = tmp.name
        
        try:
            # Convertir imagen a SVG
            self.processor.raster_to_svg(texture.image_path, svg_path)
            
            # Convertir SVG a glyph
            self.processor.svg_to_font_glyph(
                svg_path,
                texture.glyph_name,
                self.font,
                scale=texture.scale
            )
            
            # Limpiar
            os.unlink(svg_path)
            
        except Exception as e:
            if os.path.exists(svg_path):
                os.unlink(svg_path)
            raise TextureConversionError(f"Error procesando textura raster: {e}")
    
    def _add_metadata(self, metadata: Dict[str, Any]) -> None:
        """Agrega metadatos a la fuente"""
        # Implementar según necesidades
        pass
    
    def validate_font(self) -> Dict[str, Any]:
        """
        Valida que la fuente tenga las tablas correctas
        
        Returns:
            Diccionario con resultados de validación
        """
        results = {
            "has_CPAL": "CPAL" in self.font,
            "has_COLR": "COLR" in self.font,
            "glyph_count": len(self.font.getGlyphOrder()),
            "errors": [],
            "warnings": []
        }
        
        if not results["has_CPAL"]:
            results["errors"].append("Falta la tabla CPAL")
        
        if not results["has_COLR"]:
            results["errors"].append("Falta la tabla COLR")
        
        if results["has_COLR"] and "COLR" in self.font:
            colr = self.font["COLR"]
            if colr.version != 1:
                results["warnings"].append(f"COLR versión {colr.version}, se recomienda COLRv1")
            
            # Verificar que los glyphs de capas existen
            if hasattr(colr, 'LayerV1List'):
                for layer in colr.LayerV1List:
                    if layer.LayerGlyph not in self.font.getGlyphOrder():
                        results["warnings"].append(f"Glyph de capa '{layer.LayerGlyph}' no encontrado")
        
        return results

# ============================================================================
# UTILIDADES Y HERRAMIENTAS
# ============================================================================

class TextureUtilities:
    """Utilidades para trabajar con texturas y fuentes"""
    
    @staticmethod
    def create_color_palette_from_image(image_path: str, 
                                        num_colors: int = 5) -> ColorPalette:
        """
        Crea una paleta de colores a partir de una imagen
        
        Args:
            image_path: Ruta de la imagen
            num_colors: Número de colores a extraer
            
        Returns:
            ColorPalette con los colores extraídos
        """
        from sklearn.cluster import KMeans
        import numpy as np
        
        try:
            # Cargar imagen
            img = Image.open(image_path)
            img = img.convert('RGB')
            
            # Redimensionar para procesamiento rápido
            img = img.resize((100, 100))
            
            # Extraer colores
            pixels = np.array(img).reshape(-1, 3)
            
            # Clustering
            kmeans = KMeans(n_clusters=num_colors, random_state=42)
            kmeans.fit(pixels)
            
            colors = []
            for center in kmeans.cluster_centers_:
                r, g, b = [int(c) for c in center]
                colors.append((r, g, b, 255))  # Alpha = 255
            
            return ColorPalette(colors=colors, name="Extraída de imagen")
            
        except Exception as e:
            raise TextureValidationError(f"Error extrayendo paleta de imagen: {e}")
    
    @staticmethod
    def create_gradient_texture(gradient_type: str, 
                               colors: List[Tuple[int, int, int, int]],
                               output_path: str) -> str:
        """
        Crea un SVG con un gradiente para usar como textura
        
        Args:
            gradient_type: "linear" o "radial"
            colors: Lista de colores RGBA
            output_path: Ruta de salida del SVG
            
        Returns:
            Ruta del SVG creado
        """
        svg_template = '''<?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1000 1000">
            <defs>
                <{gradient_type}Gradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                    {stops}
                </{gradient_type}Gradient>
            </defs>
            <rect width="1000" height="1000" fill="url(#grad1)" />
        </svg>'''
        
        # Crear stops
        stops = []
        for i, (r, g, b, a) in enumerate(colors):
            offset = (i / (len(colors) - 1)) * 100 if len(colors) > 1 else 0
            opacity = a / 255
            stops.append(f'<stop offset="{offset}%" style="stop-color:rgb({r},{g},{b});stop-opacity:{opacity}" />')
        
        svg_content = svg_template.format(
            gradient_type=gradient_type,
            stops='\n                    '.join(stops)
        )
        
        # Guardar
        with open(output_path, 'w') as f:
            f.write(svg_content)
        
        return output_path
    
    @staticmethod
    def batch_process_textures(config_file: str) -> Dict[str, Any]:
        """
        Procesa múltiples configuraciones de texturas desde un archivo JSON
        
        Args:
            config_file: Archivo JSON con configuraciones
            
        Returns:
            Diccionario con resultados del procesamiento
        """
        with open(config_file, 'r') as f:
            config = json.load(f)
        
        results = {}
        api = FontTextureAPI()
        
        for font_config in config.get('fonts', []):
            try:
                font_path = font_config['input']
                output_path = font_config.get('output', 
                                            font_path.replace('.ttf', '_textured.ttf'))
                
                # Crear paletas
                palettes = []
                for palette_config in font_config.get('palettes', []):
                    colors = [tuple(color) for color in palette_config['colors']]
                    palettes.append(ColorPalette(
                        colors=colors,
                        palette_type=palette_config.get('type', 0),
                        name=palette_config.get('name', '')
                    ))
                
                # Crear texturas
                api.load_font(font_path)
                
                # TODO: Procesar texturas según configuración
                
                api.save_font(output_path)
                
                results[font_path] = {
                    'status': 'success',
                    'output': output_path
                }
                
            except Exception as e:
                results[font_path] = {
                    'status': 'error',
                    'error': str(e)
                }
        
        return results

# ============================================================================
# EJEMPLOS DE USO
# ============================================================================

def example_basic_usage():
    """Ejemplo básico de uso de la API"""
    
    # Crear API
    api = FontTextureAPI()
    
    # Cargar fuente
    api.load_font("input.ttf")
    
    # Definir paleta
    palette = ColorPalette(
        colors=[
            (255, 0, 0, 255),      # Rojo
            (0, 255, 0, 255),      # Verde
            (0, 0, 255, 255),      # Azul
            (255, 255, 0, 255)     # Amarillo
        ],
        name="mi_paleta"
    )
    
    # Definir texturas vectoriales
    vector_textures = {
        "A.wood": VectorTexture(
            svg_path="textures/wood.svg",
            glyph_name="A.wood",
            scale=1.0
        ),
        "A.metal": VectorTexture(
            svg_path="textures/metal.svg",
            glyph_name="A.metal",
            scale=1.0
        )
    }
    
    # Definir glyphs texturizados
    textured_glyphs = {
        "A": TexturedGlyph(
            base_glyph="A",
            name="A_textured",
            layers=[
                TextureLayer(glyph_name="A.base", color_index=0),
                TextureLayer(glyph_name="A.wood", color_index=1),
                TextureLayer(glyph_name="A.metal", color_index=2)
            ]
        )
    }
    
    # Crear configuración
    textures = FontTextures(
        font_path="input.ttf",
        output_path="output_textured.ttf",
        palettes=[palette],
        textured_glyphs=textured_glyphs,
        vector_textures=vector_textures
    )
    
    # Aplicar texturas
    api.apply_textures(textures)
    
    # Validar
    validation = api.validate_font()
    print("Validación:", validation)
    
    # Guardar
    api.save_font()
    
    return api

def example_raster_texture():
    """Ejemplo usando texturas raster"""
    
    api = FontTextureAPI()
    api.load_font("input.ttf")
    
    # Paleta con colores de la imagen
    palette = TextureUtilities.create_color_palette_from_image("texture.png", 3)
    
    # Textura raster
    raster_textures = {
        "A.pattern": RasterTexture(
            image_path="texture.png",
            glyph_name="A.pattern",
            scale=1.5
        )
    }
    
    # Glyph texturizado
    textured_glyphs = {
        "A": TexturedGlyph(
            base_glyph="A",
            layers=[
                TextureLayer(glyph_name="A.base", color_index=0),
                TextureLayer(glyph_name="A.pattern", color_index=1)
            ]
        )
    }
    
    textures = FontTextures(
        font_path="input.ttf",
        output_path="output_raster.ttf",
        palettes=[palette],
        textured_glyphs=textured_glyphs,
        raster_textures=raster_textures
    )
    
    api.apply_textures(textures)
    api.save_font()
    
    return api

def example_gradient_textures():
    """Ejemplo usando gradientes como texturas"""
    
    # Crear gradiente SVG
    gradient_colors = [
        (255, 0, 0, 255),    # Rojo
        (255, 165, 0, 255),  # Naranja
        (255, 255, 0, 255)   # Amarillo
    ]
    
    TextureUtilities.create_gradient_texture(
        "linear",
        gradient_colors,
        "gradient.svg"
    )
    
    # Continuar con la API...
    api = FontTextureAPI()
    api.load_font("input.ttf")
    
    palette = ColorPalette(
        colors=[(255, 0, 0, 255), (0, 255, 0, 255)],
        name="gradient_palette"
    )
    
    vector_textures = {
        "A.gradient": VectorTexture(
            svg_path="gradient.svg",
            glyph_name="A.gradient"
        )
    }
    
    textured_glyphs = {
        "A": TexturedGlyph(
            base_glyph="A",
            layers=[
                TextureLayer(glyph_name="A.base", color_index=0),
                TextureLayer(glyph_name="A.gradient", color_index=1)
            ]
        )
    }
    
    textures = FontTextures(
        font_path="input.ttf",
        output_path="output_gradient.ttf",
        palettes=[palette],
        textured_glyphs=textured_glyphs,
        vector_textures=vector_textures
    )
    
    api.apply_textures(textures)
    api.save_font()
    
    return api

def example_batch_processing():
    """Ejemplo de procesamiento por lotes"""
    
    config = {
        "fonts": [
            {
                "input": "font1.ttf",
                "output": "font1_textured.ttf",
                "palettes": [
                    {
                        "colors": [[255,0,0,255], [0,255,0,255]],
                        "type": 0,
                        "name": "palette1"
                    }
                ],
                "textures": {
                    "vector": {
                        "A.wood": "textures/wood.svg",
                        "A.metal": "textures/metal.svg"
                    }
                },
                "glyphs": {
                    "A": {
                        "layers": [
                            {"glyph": "A.base", "color": 0},
                            {"glyph": "A.wood", "color": 1}
                        ]
                    }
                }
            }
        ]
    }
    
    # Guardar configuración
    with open("config.json", "w") as f:
        json.dump(config, f, indent=2)
    
    # Procesar
    results = TextureUtilities.batch_process_textures("config.json")
    
    for font, result in results.items():
        if result['status'] == 'success':
            print(f"[OK] {font}: {result['output']}")
        else:
            print(f"[ERROR] {font}: {result['error']}")
    
    return results

# ============================================================================
# PUNTO DE ENTRADA (ejemplo de uso - comentado para evitar ejecucion al importar)
# ============================================================================

# if __name__ == "__main__":
#     print("[START] API de Texturas para Fuentes TTF")
#     print("=" * 40)
#     
#     try:
#         # Ejecutar ejemplo basico
#         print("\n[INFO] Ejemplo basico:")
#         api = example_basic_usage()
#         
#         print("\n[OK] API funcionando correctamente")
#         print("   - Paletas CPAL creadas")
#         print("   - Tablas COLRv1 generadas")
#         print("   - Texturas vectoriales agregadas")
#         
#     except FontTextureError as e:
#         print(f"\n[ERROR] Error: {e}")
#     except Exception as e:
#         print(f"\n[WARN] Error inesperado: {e}")
#         print(traceback.format_exc())






    # ===== SERVIDOR FASTAPI =====
# Crear la aplicación
app = FastAPI(
    title="Font Texture API",
    description="API para aplicar texturas a fuentes TTF",
    version="1.0.0"
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Crear directorios necesarios
Path("uploads").mkdir(exist_ok=True)
Path("fonts/output").mkdir(parents=True, exist_ok=True)

# ===== ENDPOINTS =====
@app.get("/")
async def root():
    return {"message": "Font Texture API funcionando", "docs": "/docs"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

def get_renderable_glyphs(font_path: str) -> list:
    """
    Devuelve la lista de nombres de glyphs que tienen contornos reales.
    Se excluyen automáticamente: .notdef, glyph vacíos, glyph de espacio,
    y cualquier glyph auxiliar que ya sea una textura previa (*.texture).
    """
    font = TTFont(font_path)
    glyfTable = font.get("glyf")
    hmtx = font["hmtx"].metrics if "hmtx" in font else {}

    renderable = []
    for name in font.getGlyphOrder():
        if name.endswith(".texture") or name == ".notdef":
            continue

        if glyfTable is not None:
            g = glyfTable.get(name)
            if g is None:
                continue
            if hasattr(g, "numberOfContours") and g.numberOfContours == 0:
                continue
        else:
            advance, _ = hmtx.get(name, (0, 0))
            if advance == 0:
                continue

        renderable.append(name)

    font.close()
    return renderable

@app.post("/process")
async def process_font(
    font_file: UploadFile = File(...),
    palettes: str = Form(...),
    textured_glyphs: str = Form(...),
    vector_textures: Optional[str] = Form(None),
    raster_textures: Optional[str] = Form(None)
):
    try:
        # Guardar archivo temporal
        temp_path = f"uploads/temp_{font_file.filename}"
        with open(temp_path, "wb") as f:
            content = await font_file.read()
            f.write(content)
        
        # Parsear JSON
        try:
            palettes_data = json.loads(palettes)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"JSON inválido en 'palettes': {e}. Recibido: '{palettes[:100]}'")
        
        try:
            glyphs_data = json.loads(textured_glyphs)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"JSON inválido en 'textured_glyphs': {e}. Recibido: '{textured_glyphs[:100]}'")
        
        try:
            vector_data = json.loads(vector_textures) if vector_textures and vector_textures.strip() else {}
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"JSON inválido en 'vector_textures': {e}. Recibido: '{vector_textures[:100] if vector_textures else 'None'}'")
        
        # Crear API
        api = FontTextureAPI()
        api.load_font(temp_path)
        
        # Crear paletas
        color_palettes = []
        for p in palettes_data:
            color_palettes.append(ColorPalette(
                colors=[tuple(c) for c in p["colors"]],
                palette_type=p.get("palette_type", 0),
                name=p.get("name", "")
            ))
        
        # Crear texturas vectoriales
        vector_textures_obj = {}
        if isinstance(vector_data, dict):
            for name, v_data in vector_data.items():
                svg_path = f"uploads/temp_{name}.svg"
                svg_content = v_data["svg_content"]
                with open(svg_path, "w", encoding="utf-8") as f:
                    f.write(svg_content)
                
                # Crear objeto VectorTexture
                vector_textures_obj[name] = VectorTexture(
                    svg_path=svg_path,
                    glyph_name=v_data["glyph_name"],
                    scale=v_data.get("scale", 1.0)
                )
        elif vector_data:
            raise HTTPException(status_code=400, detail="'vector_textures' debe ser un objeto/diccionario, no una lista")
        
        # Crear glyphs
        textured_glyphs_obj = {}
        if isinstance(glyphs_data, dict):
            for name, g_data in glyphs_data.items():
                layers = []
                for layer in g_data.get("layers", []):
                    layers.append(TextureLayer(
                        glyph_name=layer["glyph_name"],
                        color_index=layer["color_index"],
                        opacity=layer.get("opacity", 1.0)
                    ))
                
                textured_glyphs_obj[name] = TexturedGlyph(
                    base_glyph=g_data.get("base_glyph", name),
                    layers=layers,
                    name=g_data.get("name", "")
                )
        
        # Si no se enviaron glifos específicos (vacío), aplicar automáticamente a TODOS los glifos renderizables
        if not textured_glyphs_obj and vector_textures_obj:
            texture_glyph_name = list(vector_textures_obj.keys())[0]
            glyph_names = get_renderable_glyphs(temp_path)
            for name in glyph_names:
                textured_glyphs_obj[name] = TexturedGlyph(
                    base_glyph=name,
                    layers=[
                        TextureLayer(glyph_name=name, color_index=0),
                        TextureLayer(glyph_name=texture_glyph_name, color_index=1),
                    ],
                )
        
        # Procesar
        output_path = f"fonts/output/textured_{font_file.filename}"
        textures = FontTextures(
            font_path=temp_path,
            output_path=output_path,
            palettes=color_palettes,
            textured_glyphs=textured_glyphs_obj,
            vector_textures=vector_textures_obj
        )
        
        api.apply_textures(textures)
        api.save_font(output_path)
        
        return {
            "success": True,
            "message": "Fuente procesada exitosamente",
            "output_file": output_path
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/download/{filename}")
async def download_font(filename: str):
    file_path = f"fonts/output/{filename}"
    if not Path(file_path).exists():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(file_path, filename=filename)

# ===== EJECUTAR SERVIDOR =====
if __name__ == "__main__":
    uvicorn.run(
        "simple_api:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )    