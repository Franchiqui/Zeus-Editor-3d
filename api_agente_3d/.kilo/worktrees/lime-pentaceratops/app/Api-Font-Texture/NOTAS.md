pip install fontTools Pillow scikit-learn numpy



# Ubuntu/Debian
sudo apt-get install potrace

# macOS
brew install potrace

# Windows
# Descargar de https://potrace.sourceforge.net/

pip install -r requirements.txt


# Algunas texturas SVG de ejemplo
# Puedes descargar texturas gratuitas de sitios como:
# - https://www.svgbackgrounds.com/
# - https://heropatterns.com/
# - https://www.svgrepo.com/


font_texture_api/
│
├── 📁 src/                          # Código fuente principal
│   ├── 📄 __init__.py
│   ├── 📄 api.py                    # API principal FontTextureAPI
│   ├── 📄 processor.py              # TextureProcessor
│   ├── 📄 models.py                 # Modelos de datos (dataclasses)
│   ├── 📄 exceptions.py             # Excepciones personalizadas
│   ├── 📄 utils.py                  # Utilidades (TextureUtilities)
│   └── 📄 validators.py             # Validaciones
│
├── 📁 examples/                     # Ejemplos de uso
│   ├── 📄 basic_usage.py
│   ├── 📄 raster_texture.py
│   ├── 📄 gradient_texture.py
│   ├── 📄 batch_processing.py
│   └── 📄 advanced_usage.py
│
├── 📁 tests/                        # Pruebas unitarias
│   ├── 📄 __init__.py
│   ├── 📄 test_api.py
│   ├── 📄 test_processor.py
│   ├── 📄 test_models.py
│   └── 📄 test_utils.py
│
├── 📁 textures/                     # Texturas de ejemplo
│   ├── 📁 vector/
│   │   ├── 📄 wood.svg
│   │   ├── 📄 metal.svg
│   │   ├── 📄 marble.svg
│   │   ├── 📄 fabric.svg
│   │   └── 📄 gradient.svg
│   │
│   ├── 📁 raster/
│   │   ├── 📄 texture1.png
│   │   ├── 📄 texture2.jpg
│   │   ├── 📄 pattern.png
│   │   └── 📄 photo.jpg
│   │
│   └── 📁 generated/                # Texturas generadas por el sistema
│       └── 📄 .gitkeep
│
├── 📁 fonts/                        # Fuentes para procesar
│   ├── 📁 input/                    # Fuentes de entrada
│   │   ├── 📄 example.ttf
│   │   └── 📄 .gitkeep
│   │
│   └── 📁 output/                   # Fuentes procesadas
│       └── 📄 .gitkeep
│
├── 📁 config/                       # Archivos de configuración
│   ├── 📄 default_config.json
│   ├── 📄 palette_presets.json
│   ├── 📄 texture_mappings.json
│   └── 📄 batch_config.json
│
├── 📁 docs/                         # Documentación
│   ├── 📄 README.md
│   ├── 📄 API.md
│   ├── 📄 EXAMPLES.md
│   ├── 📄 TROUBLESHOOTING.md
│   └── 📄 CHANGELOG.md
│
├── 📁 scripts/                      # Scripts de utilidad
│   ├── 📄 setup.py                  # Script de instalación
│   ├── 📄 create_textures.py        # Generar texturas de ejemplo
│   ├── 📄 batch_process.py          # Procesar múltiples fuentes
│   └── 📄 validate_font.py          # Validar fuentes procesadas
│
├── 📁 logs/                         # Archivos de log
│   ├── 📄 .gitkeep
│   └── 📄 app.log
│
├── 📁 temp/                         # Archivos temporales
│   └── 📄 .gitkeep
│
├── 📄 requirements.txt              # Dependencias Python
├── 📄 setup.py                      # Setup para instalación
├── 📄 pyproject.toml                # Configuración de proyecto
├── 📄 .gitignore                    # Archivos a ignorar en git
├── 📄 LICENSE                       # Licencia
├── 📄 README.md                     # README principal
└── 📄 main.py                       # Punto de entrada principal



 Uso Rápido
Ejemplo de uso en línea de comandos
bash
python main.py fonts/input/example.ttf --texture textures/vector/wood.svg --output fonts/output/example_wood.ttf
Ejemplo de uso con archivo de configuración
bash
python main.py fonts/input/example.ttf --config config/batch_config.json
Ejemplo de uso programático
python
from src.api import FontTextureAPI
from src.models import FontTextures, ColorPalette

api = FontTextureAPI()
api.load_font("fonts/input/example.ttf")

# Configurar y aplicar texturas...

api.save_font("fonts/output/result.ttf")
Esta estructura te proporciona un proyecto completo, organizado y listo para producción con todas las herramientas necesarias para desarrollar y escalar tu API de texturas para fuentes TTF.


# 1. Navegar al proyecto
cd font_texture_api

# 2. Crear entorno
python -m venv venv_texturas

# 3. Activar
# Windows:
venv_texturas\Scripts\activate
# Linux/macOS:
source venv_texturas/bin/activate

# 4. Instalar todo
pip install fonttools Pillow scikit-learn numpy

# 5. Verificar instalación
python -c "import fontTools; print('✅ FontTools OK')"
python -c "import PIL; print('✅ Pillow OK')"

# 6. Ejecutar tu script
python simple_api.py  # Para archivo único
# o
python main.py  # Para versión modular


# CREAR ENTORNO:
python -m venv venv

# ACTIVAR ENTORNO:
venv\Scripts\Activate.ps1

# INSTALAR DEPENDENCIAS:
pip install -r requirements.txt


uvicorn simple_api:app --host 0.0.0.0 --port 8000 --reload

-------------------------------------------------
# palettes 
[{"colors": [[255,0,0,255], [0,255,0,255]], "palette_type": 0, "name": "palette1"}]


# textured_glyphs
{"A": {"base_glyph": "A", "layers": [{"glyph_name": "A", "color_index": 0}, {"glyph_name": "A.texture1", "color_index": 1}]}}


-----------------

The API is now working. Here's a summary of the fixes and how to use it:

Summary of Fixes
1-Imports: Fixed COLR/CPAL imports 
(table_C_O_L_R_, table_C_P_A_L_)

2-GlyphOrder: Use 
getGlyphOrder() method, not attribute

3-Operation Order: Add vector/raster textures BEFORE creating COLR

4-SVG Parsing: Use svg.path library for proper SVG path parsing

5-Glyph Creation: Add to glyf table via 
font['glyf'].glyphs[glyph_name] = pen.glyph()

6-hmtx Metrics: Add horizontal metrics for new glyphs

7-CPAL Colors: Use 
fontTools.ttLib.tables.C_P_A_L_.Color objects (BGRA order)

---------------------------------------------------------------


Crear SVG para Textura y Usar la API
1. Crear un archivo SVG válido
Guarda este archivo como textura.svg en la carpeta Texturas o cualquier ubicación accesible:

<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <!-- Ejemplo: textura de líneas diagonales -->
  <defs>
    <pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
      <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" 
            stroke="gray" stroke-width="0.5"/>
    </pattern>
  </defs>
  <rect width="200" height="200" fill="url(#diagonalHatch)"/>
</svg>
2. Usar la API mediante código Python
from simple_api import FontTextureAPI, ColorPalette, TexturedGlyph, TextureLayer, VectorTexture, FontTextures

# Cargar fuente
api = FontTextureAPI()
api.load_font("input.ttf")  # Reemplaza con tu fuente

# Definir paleta de colores
palette = ColorPalette(
    colors=[(100, 150, 200, 255), (50, 75, 100, 255)],  # Azul claro y oscuro
    name="mi_paleta"
)

# Definir textura vectorial (usa tu SVG)
vector_textures = {
    "A.textura": VectorTexture(
        svg_path="Texturas/textura.svg",  # Ruta a tu SVG
        glyph_name="A.textura",
        scale=1.0
    )
}

# Definir glyph texturizado
textured_glyphs = {
    "A": TexturedGlyph(
        base_glyph="A",
        layers=[
            TextureLayer(glyph_name="A", color_index=0),      # Glyph base
            TextureLayer(glyph_name="A.textura", color_index=1) # Textura
        ]
    )
}

# Crear configuración
textures = FontTextures(
    font_path="input.ttf",
    output_path="output_texturado.ttf",
    palettes=[palette],
    textured_glyphs=textured_glyphs,
    vector_textures=vector_textures
)

# Aplicar texturas
api.apply_textures(textures)
api.save_font()
print("Fuente texturizada guardada como: output_texturado.ttf")
3. Usar la API mediante endpoint web (FastAPI)
Primero inicia el servidor:

F:\Api-Font-Texture\venv\Scripts\uvicorn.exe simple_api:app --reload
Luego envía una petición POST (ejemplo con PowerShell):

$svgContent = Get-Content -Raw -Path "F:\Api-Font-Texture\Texturas\textura.svg"
$payload = @{
    palettes = @(
        @{
            colors = @(@(100,150,200,255), @(50,75,100,255))
            name = "mi_paleta"
            palette_type = 0
        }
    )
    textured_glyphs = @{
        "A" = @{
            base_glyph = "A"
            layers = @(
                @{ glyph_name = "A"; color_index = 0 },
                @{ glyph_name = "A.textura"; color_index = 1 }
            )
        }
    }
    vector_textures = @{
        "A.textura" = @{
            svg_content = $svgContent
            glyph_name = "A.textura"
            scale = 1.0
        }
    }
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:8000/process" `
    -ContentType "application/json" `
    -Body $payload `
    -OutFile "response.json"
4. Descargar el resultado
Después de procesar, descarga la fuente texturizada:

Invoke-RestMethod -Method Get -Uri "http://localhost:8000/download/output_texturado.ttf" `
    -OutFile "output_texturado.ttf"
Notas importantes:
Formato SVG: La API ahora acepta:
<path d="..."> (directo)
<rect>, <circle>, <ellipse>, <line>, <polyline> (convertidos automáticamente)
Asegúrate de que tu SVG tenga al menos uno de estos elementos
Rutas de archivo:
Usa rutas absolutas o relativas desde el directorio donde ejecutes el script
En el endpoint web, los archivos se suben mediante UploadFile
Glyphs:
base_glyph debe existir en la fuente original (ej: "A", "B", etc.)
Los glyph_name en las capas pueden ser nuevos (se crearán desde el SVG)

---------------------------------------------


Cómo usarlo
Uso simple (con valores por defecto):

powershell
cd f:\Api-Font-Texture
python aplicar_textura_completa.py
Con argumentos:

powershell
python aplicar_textura_completa.py --font MiFuente.ttf --svg Texturas/textura.svg --output fonts/resultado.ttf
Todas las opciones:

--font, -f       Fuente TTF de entrada  (default: input.ttf)
--svg,  -s       Archivo SVG de textura (default: Texturas/textura.svg)
--output, -o     Fuente de salida       (default: fonts/output_textura_completa.ttf)
--scale          Escala de la textura   (default: 1.0)
--base-color     Índice paleta → relleno base  (default: 0)
--texture-color  Índice paleta → textura       (default: 1)
--quiet, -q      Modo silencioso
Paleta de colores (editable directamente en el archivo):

0 → Negro oscuro (relleno base del glyph)
1 → Dorado semitransparente (textura encima)
2 y 3 → Reserva (blanco / rojo)