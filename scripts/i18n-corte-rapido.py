# -*- coding: utf-8 -*-
"""Inserta las claves del CORTE RÁPIDO (desplegable de Seleccionar) tras
`selAccionCrear:` en los 7 bloques de idioma de lib/i18n/translations.ts
(UTF-8 vía python, NUNCA PowerShell 5.1 para no romper acentos)."""
import io, re

RUTA = 'lib/i18n/translations.ts'
ANCHOR = 'selAccionCrear:'

BLOQUES = [
    # es
    """    selAccionRapida: 'Corte rápido (corta al soltar la zona)',
    selAccionRapidaDesc: 'Sin selección: dibuja y corta directo — ideal para mallas enormes',
    selZonaCortadaRapida: 'Corte rápido: {n} piezas quitadas',""",
    # en
    """    selAccionRapida: 'Fast cut (cuts as soon as the area is released)',
    selAccionRapidaDesc: 'No selection: draw and it cuts right away — ideal for huge meshes',
    selZonaCortadaRapida: 'Fast cut: {n} pieces removed',""",
    # fr (apóstrofes U+2019 para no romper el parsing)
    """    selAccionRapida: 'Découpe rapide (coupe au relâchement de la zone)',
    selAccionRapidaDesc: 'Sans sélection : dessine et ça coupe direct — idéal pour les énormes maillages',
    selZonaCortadaRapida: 'Découpe rapide : {n} morceaux enlevés',""",
    # de
    """    selAccionRapida: 'Schnellschnitt (schneidet beim Loslassen der Zone)',
    selAccionRapidaDesc: 'Ohne Auswahl: Zone ziehen und sie wird sofort geschnitten — ideal für riesige Netze',
    selZonaCortadaRapida: 'Schnellschnitt: {n} Teile entfernt',""",
    # it
    """    selAccionRapida: 'Taglio rapido (taglia al rilascio della zona)',
    selAccionRapidaDesc: 'Senza selezione: disegna e taglia subito — ideale per maglie enormi',
    selZonaCortadaRapida: 'Taglio rapido: {n} pezzi rimossi',""",
    # zh
    """    selAccionRapida: '快速切割（松开区域即切割）',
    selAccionRapidaDesc: '无需选择：画出区域直接切割 — 适合超大网格',
    selZonaCortadaRapida: '快速切割：已移除 {n} 块',""",
    # hi
    """    selAccionRapida: 'तेज़ कट (क्षेत्र छोड़ते ही कटता है)',
    selAccionRapidaDesc: 'कोई चयन नहीं: क्षेत्र बनाएँ और वह सीधे कट जाएगा — विशाल मेश के लिए',
    selZonaCortadaRapida: 'तेज़ कट: {n} टुकड़े हटाए गए',""",
]

with io.open(RUTA, 'r', encoding='utf-8') as fh:
    texto = fh.read()

trozos = texto.split(ANCHOR)
assert len(trozos) == 8, f'ancla selAccionCrear: {len(trozos) - 1} apariciones (≠ 7)'

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
for clave in ('selAccionRapida', 'selAccionRapidaDesc', 'selZonaCortadaRapida'):
    n = len(re.findall(re.escape(clave) + ':', resultado))
    assert n == 7, f'{clave}: {n} apariciones (≠ 7)'
assert resultado.count(ANCHOR) == 7, 'ancla alterada'
print('OK: 3 claves × 7 idiomas')