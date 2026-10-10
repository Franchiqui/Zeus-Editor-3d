# -*- coding: utf-8 -*-
"""Inserta las claves espejo* tras `muelleBtnTitle` en los 7 bloques de
idioma de lib/i18n/translations.ts (UTF-8, sin PowerShell para no romper
los acentos: este script también corre vía python con encoding utf-8)."""
import io, re, sys

RUTA = 'lib/i18n/translations.ts'
ANCHOR = 'muelleBtnTitle:'

BLOQUES = [
    # es
    """    espejoBtnTitle: 'Espejo: voltea el objeto seleccionado según el eje elegido',
    espejoEjeX: 'Espejo según eje X',
    espejoEjeY: 'Espejo según eje Y',
    espejoEjeZ: 'Espejo según eje Z',
    espejoSinObjeto: 'Selecciona un objeto para hacer el espejo',""",
    # en
    """    espejoBtnTitle: 'Mirror: flip the selected object along the chosen axis',
    espejoEjeX: 'Mirror around axis X',
    espejoEjeY: 'Mirror around axis Y',
    espejoEjeZ: 'Mirror around axis Z',
    espejoSinObjeto: 'Select an object to mirror',""",
    # fr (apóstrofes U+2019 para no romper el parsing)
    """    espejoBtnTitle: 'Miroir : retourne l’objet sélectionné selon l’axe choisi',
    espejoEjeX: 'Miroir selon l’axe X',
    espejoEjeY: 'Miroir selon l’axe Y',
    espejoEjeZ: 'Miroir selon l’axe Z',
    espejoSinObjeto: 'Sélectionnez un objet pour le miroir',""",
    # de
    """    espejoBtnTitle: 'Spiegel: das ausgewählte Objekt an der gewählten Achse spiegeln',
    espejoEjeX: 'Spiegeln an Achse X',
    espejoEjeY: 'Spiegeln an Achse Y',
    espejoEjeZ: 'Spiegeln an Achse Z',
    espejoSinObjeto: 'Wähle ein Objekt zum Spiegeln',""",
    # it
    """    espejoBtnTitle: 'Specchio : ribalta l’oggetto selezionato sull’asse scelto',
    espejoEjeX: 'Specchio sull’asse X',
    espejoEjeY: 'Specchio sull’asse Y',
    espejoEjeZ: 'Specchio sull’asse Z',
    espejoSinObjeto: 'Seleziona un oggetto da specchiare',""",
    # zh
    """    espejoBtnTitle: '镜像：按所选轴翻转选中对象',
    espejoEjeX: '按 X 轴镜像',
    espejoEjeY: '按 Y 轴镜像',
    espejoEjeZ: '按 Z 轴镜像',
    espejoSinObjeto: '请选择要镜像的对象',""",
    # hi
    """    espejoBtnTitle: 'मिरर: चुने गए अक्ष के साथ चयनित ऑब्जेक्ट उलटें',
    espejoEjeX: 'X अक्ष के साथ मिरर',
    espejoEjeY: 'Y अक्ष के साथ मिरर',
    espejoEjeZ: 'Z अक्ष के साथ मिरर',
    espejoSinObjeto: 'मिरर के लिए कोई ऑब्जेक्ट चुनें',""",
]

with io.open(RUTA, 'r', encoding='utf-8') as fh:
    texto = fh.read()

# Partir por el ancla: la parte tras cada muelleBtnTitle: empieza con el
# valor '...' — insertar las claves NUEVAS después del final de esa línea.
trozos = texto.split(ANCHOR)
assert len(trozos) == 8, f'ancla muelleBtnTitle: {len(trozos) - 1} apariciones (≠ 7)'

salida = [trozos[0]]
for i in range(7):
    fragmento = trozos[i + 1]
    # El valor del ancla corre hasta el primer '…',\n tras muelleBtnTitle:
    m = re.match(r"[^\n]*?',[^\S\n]*\n", fragmento)
    assert m, f'bloque {i}: línea del ancla no reconocida'
    linea_anchor = ANCHOR + m.group(0)
    salida.append(linea_anchor)
    salida.append(BLOQUES[i] + '\n')
    salida.append(fragmento[m.end():])

resultado = ''.join(salida)
with io.open(RUTA, 'w', encoding='utf-8', newline='') as fh:
    fh.write(resultado)

print('OK: 7 bloques actualizados')
for clave in ('espejoBtnTitle', 'espejoEjeX', 'espejoEjeY', 'espejoEjeZ', 'espejoSinObjeto'):
    n = len(re.findall(re.escape(clave) + ':', resultado))
    assert n == 7, f'{clave}: {n} apariciones (≠ 7)'
print('OK: 5 claves × 7 idiomas')