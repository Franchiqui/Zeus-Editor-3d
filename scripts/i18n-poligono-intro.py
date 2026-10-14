# -*- coding: utf-8 -*-
"""Actualiza `seleccionarToolPoligono` en los 7 idiomas: cierre SOLO con
Enter (el doble clic/click cerca del primer punto ya NO cierra)."""
import io, re

RUTA = 'lib/i18n/translations.ts'
CLAVE = 'seleccionarToolPoligono:'

NUEVOS = [
    "    seleccionarToolPoligono: 'Herramienta: polígono (clic por vértice, cierra con Enter; clic derecho cancela)',",
    "    seleccionarToolPoligono: 'Tool: polygon (click per vertex, close with Enter; right-click cancels)',",
    "    seleccionarToolPoligono: 'Outil : polygone (clic par sommet, fermer avec Entrée ; clic droit annule)',",
    "    seleccionarToolPoligono: 'Werkzeug: Polygon (Klick je Eckpunkt, mit Enter schließen; Rechtsklick bricht ab)',",
    "    seleccionarToolPoligono: 'Strumento: poligono (clic per vertice, chiudi con Invio; clic destro annulla)',",
    "    seleccionarToolPoligono: '工具：多边形（逐顶点单击，回车闭合；右键取消）',",
    "    seleccionarToolPoligono: 'उपकरण: बहुभुज (प्रति शीर्ष क्लिक, Enter से बंद करें; दायाँ क्लिक रद्द करता है)',",
]

with io.open(RUTA, 'r', encoding='utf-8') as fh:
    texto = fh.read()

lineas = texto.split('\n')
salida = []
idx = 0
cambios = 0
for linea in lineas:
    if linea.strip().startswith(CLAVE):
        assert idx < len(NUEVOS), f'más apariciones ({idx + 1}) que traducciones'
        salida.append(NUEVOS[idx])
        idx += 1
    else:
        salida.append(linea)
assert idx == 7, f'apariciones de la clave: {idx} (≠ 7)'

resultado = '\n'.join(salida)
with io.open(RUTA, 'w', encoding='utf-8', newline='') as fh:
    fh.write(resultado)
print(f'OK: {idx} idiomas actualizados')