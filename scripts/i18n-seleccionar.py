# -*- coding: utf-8 -*-
"""Inserta las claves del botón SELECCIONAR (zona rectángulo/polígono +
Borrar/Copiar/Pegar/Crear nuevo objeto) tras `espejoSufijo` en los 7
bloques de idioma de lib/i18n/translations.ts (UTF-8, sin PowerShell para
no romper los acentos: este script corre vía python con encoding utf-8)."""
import io, re

RUTA = 'lib/i18n/translations.ts'
ANCHOR = 'espejoSufijo:'

BLOQUES = [
    # es
    """    seleccionarBtnTitle: 'Seleccionar: dibuja una zona (rectángulo o polígono discontinuo) sobre el objeto activo y marca caras + aristas + vértices juntos; el desplegable trae Borrar, Copiar, Pegar y Crear nuevo objeto con la zona',
    seleccionarToolRectangulo: 'Herramienta: rectángulo (arrastra)',
    seleccionarToolPoligono: 'Herramienta: polígono (clic por vértice, cierra con doble clic o Enter; clic derecho cancela)',
    selAccionBorrar: 'Borrar lo seleccionado',
    selAccionCopiar: 'Copiar la zona',
    selAccionPegar: 'Pegar el portapapeles (sobre la copiada)',
    selAccionCrear: 'Crear nuevo objeto (corta la zona)',
    selZonaNadaSeleccionado: 'Dibuja una zona sobre el objeto con el rectángulo o el polígono primero',
    selZonaSinPortapapeles: 'No hay zona copiada: usa Copiar primero',
    selZonaCopiada: 'Zona copiada: Pegar la recrea en el mismo sitio',
    selZonaBorrada: 'Zona borrada: quedó el hueco',
    selZonaPegada: 'Zona pegada como objeto nuevo',
    selZonaNuevoObjeto: 'Nuevo objeto con la zona; el original quedó con el hueco',
    selPegadaSufijo: '(zona pegada)',
    selCortadaSufijo: '(zona cortada)',
    faceSelTodo: '{nf} caras · {nv} vértices · {ne} aristas',""",
    # en
    """    seleccionarBtnTitle: 'Select: draw an area (dashed rectangle or polygon) over the active object to mark faces + edges + vertices together; the dropdown brings Delete, Copy, Paste and Create new object from the area',
    seleccionarToolRectangulo: 'Tool: rectangle (drag)',
    seleccionarToolPoligono: 'Tool: polygon (click per vertex, close with double-click or Enter; right-click cancels)',
    selAccionBorrar: 'Delete selection',
    selAccionCopiar: 'Copy the area',
    selAccionPegar: 'Paste clipboard (over the copy)',
    selAccionCrear: 'Create new object (cuts the area)',
    selZonaNadaSeleccionado: 'Draw an area over the object with the rectangle or polygon first',
    selZonaSinPortapapeles: 'No copied area: use Copy first',
    selZonaCopiada: 'Area copied: Paste recreates it in the same place',
    selZonaBorrada: 'Area deleted: the hole remains',
    selZonaPegada: 'Area pasted as a new object',
    selZonaNuevoObjeto: 'New object with the area; the original kept the hole',
    selPegadaSufijo: '(pasted area)',
    selCortadaSufijo: '(cut area)',
    faceSelTodo: '{nf} faces · {nv} vertices · {ne} edges',""",
    # fr (apóstrofes U+2019 para no romper el parsing)
    """    seleccionarBtnTitle: 'Sélectionner : dessine une zone (rectangles ou polygone en pointillés) sur l’objet actif et marque faces + arêtes + sommets ensemble ; le menu apporte Supprimer, Copier, Coller et Créer un nouvel objet avec la zone',
    seleccionarToolRectangulo: 'Outil : rectangle (glisser)',
    seleccionarToolPoligono: 'Outil : polygone (clic par sommet, fermer par double clic ou Enter ; clic droit annule)',
    selAccionBorrar: 'Supprimer la sélection',
    selAccionCopiar: 'Copier la zone',
    selAccionPegar: 'Coller le presse-papiers (sur la copie)',
    selAccionCrear: 'Créer un nouvel objet (découpe la zone)',
    selZonaNadaSeleccionado: 'Dessine d’abord une zone sur l’objet avec le rectangle ou le polygone',
    selZonaSinPortapapeles: 'Aucune zone copiée : utilise Copier d’abord',
    selZonaCopiada: 'Zone copiée : Coller la recrée au même endroit',
    selZonaBorrada: 'Zone supprimée : le trou reste',
    selZonaPegada: 'Zone collée comme nouvel objet',
    selZonaNuevoObjeto: 'Nouvel objet avec la zone ; l’original garde le trou',
    selPegadaSufijo: '(zone collée)',
    selCortadaSufijo: '(zone découpée)',
    faceSelTodo: '{nf} faces · {nv} sommets · {ne} arêtes',""",
    # de
    """    seleccionarBtnTitle: 'Auswählen: zeichnet eine Zone (gestricheltes Rechteck oder Polygon) über das aktive Objekt und markiert Flächen + Kanten + Eckpunkte zusammen; das Menü bringt Löschen, Kopieren, Einfügen und Neues Objekt erstellen aus der Zone',
    seleccionarToolRectangulo: 'Werkzeug: Rechteck (ziehen)',
    seleccionarToolPoligono: 'Werkzeug: Polygon (Klick je Eckpunkt, schließen mit Doppelklick oder Enter; Rechtsklick bricht ab)',
    selAccionBorrar: 'Auswahl löschen',
    selAccionCopiar: 'Zone kopieren',
    selAccionPegar: 'Zwischenablage einfügen (über der Kopie)',
    selAccionCrear: 'Neues Objekt erstellen (schneidet die Zone aus)',
    selZonaNadaSeleccionado: 'Zeichne zuerst eine Zone um das Objekt mit dem Rechteck oder Polygon',
    selZonaSinPortapapeles: 'Keine kopierte Zone: zuerst Kopieren verwenden',
    selZonaCopiada: 'Zone kopiert: Einfügen erzeugt sie am selben Ort',
    selZonaBorrada: 'Zone gelöscht: das Loch bleibt',
    selZonaPegada: 'Zone als neues Objekt eingefügt',
    selZonaNuevoObjeto: 'Neues Objekt mit der Zone; das Original behält das Loch',
    selPegadaSufijo: '(eingefügte Zone)',
    selCortadaSufijo: '(ausgeschnittene Zone)',
    faceSelTodo: '{nf} Flächen · {nv} Eckpunkte · {ne} Kanten',""",
    # it
    """    seleccionarBtnTitle: 'Seleziona: disegna una zona (rettangolo o poligono tratteggiato) sull’oggetto attivo e marca facce + spigoli + vertici insieme; il menu porta Elimina, Copia, Incolla e Crea nuovo oggetto con la zona',
    seleccionarToolRectangulo: 'Strumento: rettangolo (trascina)',
    seleccionarToolPoligono: 'Strumento: poligono (clic per vertice, chiudi con doppio clic o Invio; clic destro annulla)',
    selAccionBorrar: 'Elimina la selezione',
    selAccionCopiar: 'Copia la zona',
    selAccionPegar: 'Incolla gli appunti (sopra la copia)',
    selAccionCrear: 'Crea nuovo oggetto (taglia la zona)',
    selZonaNadaSeleccionado: 'Disegna prima una zona sull’oggetto con il rettangolo o il poligono',
    selZonaSinPortapapeles: 'Nessuna zona copiata: usa prima Copia',
    selZonaCopiada: 'Zona copiata: Incolla la ricrea nello stesso punto',
    selZonaBorrada: 'Zona eliminata: resta il buco',
    selZonaPegada: 'Zona incollata come nuovo oggetto',
    selZonaNuevoObjeto: 'Nuovo oggetto con la zona; l’originale resta col buco',
    selPegadaSufijo: '(zona incollata)',
    selCortadaSufijo: '(zona tagliata)',
    faceSelTodo: '{nf} facce · {nv} vertici · {ne} spigoli',""",
    # zh
    """    seleccionarBtnTitle: '选择：在当前对象上画一块区域（虚线矩形或多边形），同时选中面+边+顶点；下拉菜单提供删除、复制、粘贴和用该区域创建新对象',
    seleccionarToolRectangulo: '工具：矩形（拖动）',
    seleccionarToolPoligono: '工具：多边形（逐顶点单击，双击或回车闭合；右键取消）',
    selAccionBorrar: '删除所选',
    selAccionCopiar: '复制该区域',
    selAccionPegar: '粘贴剪贴板（贴在复制处）',
    selAccionCrear: '创建新对象（切下该区域）',
    selZonaNadaSeleccionado: '请先用矩形或多边形在对象上画出一块区域',
    selZonaSinPortapapeles: '剪贴板为空：请先使用复制',
    selZonaCopiada: '区域已复制：粘贴会在同一位置重建',
    selZonaBorrada: '区域已删除：留下缺口',
    selZonaPegada: '区域已作为新对象粘贴',
    selZonaNuevoObjeto: '已用区域创建新对象；原对象留下缺口',
    selPegadaSufijo: '（粘贴的区域）',
    selCortadaSufijo: '（切下的区域）',
    faceSelTodo: '{nf} 面 · {nv} 顶点 · {ne} 边',""",
    # hi
    """    seleccionarBtnTitle: 'चयन करें: सक्रिय ऑब्जेक्ट पर एक क्षेत्र (डैश वाला आयत या बहुभुज) बनाएं और चेहरे + किनारे + शीर्ष एक साथ चुनें; ड्रॉपडाउन में हटाएँ, कॉपी, पेस्ट और उस क्षेत्र से नया ऑब्जेक्ट बनाएँ है',
    seleccionarToolRectangulo: 'उपकरण: आयत (खींचें)',
    seleccionarToolPoligono: 'उपकरण: बहुभुज (प्रति शीर्ष क्लिक, डबल क्लिक या Enter से बंद करें; दायाँ क्लिक रद्द करता है)',
    selAccionBorrar: 'चयनित हटाएँ',
    selAccionCopiar: 'क्षेत्र कॉपी करें',
    selAccionPegar: 'क्लिपबोर्ड पेस्ट करें (कॉपी के ऊपर)',
    selAccionCrear: 'नया ऑब्जेक्ट बनाएँ (क्षेत्र काटता है)',
    selZonaNadaSeleccionado: 'पहले आयत या बहुभुज से ऑब्जेक्ट पर क्षेत्र बनाएं',
    selZonaSinPortapapeles: 'कोई कॉपी किया क्षेत्र नहीं: पहले कॉपी का उपयोग करें',
    selZonaCopiada: 'क्षेत्र कॉपी हुआ: पेस्ट उसे उसी जगह लाएगा',
    selZonaBorrada: 'क्षेत्र हटा दिया गया: छेद रह गया',
    selZonaPegada: 'क्षेत्र नए ऑब्जेक्ट के रूप में पेस्ट हुआ',
    selZonaNuevoObjeto: 'क्षेत्र के साथ नया ऑब्जेक्ट; मूल ऑब्जेक्ट पर छेद रह गया',
    selPegadaSufijo: '(पेस्ट किया क्षेत्र)',
    selCortadaSufijo: '(कटा क्षेत्र)',
    faceSelTodo: '{nf} चेहरे · {nv} शीर्ष · {ne} किनारे',""",
]

with io.open(RUTA, 'r', encoding='utf-8') as fh:
    texto = fh.read()

trozos = texto.split(ANCHOR)
assert len(trozos) == 8, f'ancla espejoSufijo: {len(trozos) - 1} apariciones (≠ 7)'

salida = [trozos[0]]
for i in range(7):
    fragmento = trozos[i + 1]
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
for clave in ('seleccionarBtnTitle', 'selAccionBorrar', 'selAccionCopiar',
              'selAccionPegar', 'selAccionCrear', 'selZonaCopiada',
              'selPegadaSufijo', 'selCortadaSufijo', 'faceSelTodo'):
    n = len(re.findall(re.escape(clave) + ':', resultado))
    assert n == 7, f'{clave}: {n} apariciones (≠ 7)'
print('OK: 16 claves × 7 idiomas')