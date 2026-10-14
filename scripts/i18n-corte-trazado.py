# -*- coding: utf-8 -*-
"""Inserta las claves del CORTE POR TRAZADO (botón «Corte») tras
`selZonaCortadaRapida:` en los 7 bloques de idioma de lib/i18n/translations.ts
(UTF-8 vía python, NUNCA PowerShell 5.1 para no romper acentos)."""
import io, re

RUTA = 'lib/i18n/translations.ts'
ANCHOR = 'selZonaCortadaRapida:'

BLOQUES = [
    # es
    """    corteBtnTitle: 'Corte: dibuja un trazado sobre el objeto; Intro lo cierra y corta la malla (el interior queda seleccionado)',
    corteBtnOffTitle: 'Salir del modo Corte (re-pulsar)',
    corteZonaOK: 'Corte aplicado: {n} caras nuevas',
    corteZonaNada: 'El trazado no cruza ninguna cara del objeto',""",
    # en
    """    corteBtnTitle: 'Cut: draw a path over the object; Enter closes it and cuts the mesh (the interior gets selected)',
    corteBtnOffTitle: 'Leave Cut mode (press again)',
    corteZonaOK: 'Cut applied: {n} new faces',
    corteZonaNada: 'The path does not cross any face of the object',""",
    # fr (apóstrofes U+2019 para no romper el parsing)
    """    corteBtnTitle: 'Découpe : tracez un chemin sur l’objet ; Entrée le referme et coupe le maillage (l’intérieur est sélectionné)',
    corteBtnOffTitle: 'Quitter le mode Découpe (re-pousser)',
    corteZonaOK: 'Découpe appliquée : {n} nouvelles faces',
    corteZonaNada: 'Le tracé ne traverse aucune face de l’objet',""",
    # de
    """    corteBtnTitle: 'Schnitt: Pfad über das Objekt ziehen; Enter schließt ihn und schneidet das Netz (das Innere wird ausgewählt)',
    corteBtnOffTitle: 'Schnittmodus verlassen (nochmal drücken)',
    corteZonaOK: 'Schnitt angewendet: {n} neue Flächen',
    corteZonaNada: 'Der Pfad kreuzt keine Fläche des Objekts',""",
    # it
    """    corteBtnTitle: 'Taglio: disegna un percorso sull’oggetto; Invio lo chiude e taglia la mesh (l’interno viene selezionato)',
    corteBtnOffTitle: 'Esci dalla modalità Taglio (ripremere)',
    corteZonaOK: 'Taglio applicato: {n} nuove facce',
    corteZonaNada: 'Il percorso non attraversa nessuna faccia dell’oggetto',""",
    # zh
    """    corteBtnTitle: '切割：在物体上画出路径，回车闭合并切割网格（内部自动选中）',
    corteBtnOffTitle: '退出切割模式（再次点击）',
    corteZonaOK: '已切割：新增 {n} 个面',
    corteZonaNada: '该路径未穿过物体的任何面',""",
    # hi
    """    corteBtnTitle: 'कट: ऑब्जेक्ट पर पथ बनाएँ; Enter उसे बंद करके मेश काटता है (भीतरी भाग चयनित हो जाता है)',
    corteBtnOffTitle: 'कट मोड छोड़ें (फिर दबाएँ)',
    corteZonaOK: 'कट लागू: {n} नए फलक',
    corteZonaNada: 'पथ ऑब्जेक्ट के किसी फलक को नहीं काटता',""",
]

with io.open(RUTA, 'r', encoding='utf-8') as fh:
    texto = fh.read()

trozos = texto.split(ANCHOR)
assert len(trozos) == 8, f'ancla {ANCHOR}: {len(trozos) - 1} apariciones (≠ 7)'

salida = [trozos[0]]
for i in range(7):
    fragmento = trozos[i + 1]
    m = re.match(r"[^\n]*?',[^\S\n]*\n", fragmento)
    assert m, f'bloque {i}: línea del ancla no reconocida'
    salida.append(ANCHOR + m.group(0))
    salida.append(BLOQUES[i] + '\n')
    salida.append(fragmento[m.end():])

resultado = ''.join(salida)
with io.open(RUTA, 'w', encoding='utf-8', newline='') as fh:
    fh.write(resultado)

print('OK: 7 bloques actualizados')
for clave in ('corteBtnTitle', 'corteBtnOffTitle', 'corteZonaOK', 'corteZonaNada'):
    n = len(re.findall(re.escape(clave) + ':', resultado))
    assert n == 7, f'{clave}: {n} apariciones (≠ 7)'
assert resultado.count(ANCHOR) == 7, 'ancla alterada'
print('OK: 4 claves × 7 idiomas')