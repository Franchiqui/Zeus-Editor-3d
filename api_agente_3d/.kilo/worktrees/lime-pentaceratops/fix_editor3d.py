#!/usr/bin/env python3
import re

with open('components/editor/Editor3D.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Buscar y reemplazar el patrón del componente MeshEditor con propiedades incorrectas
pattern = r'<MeshEditor\s+sections=\{\}\s+onSectionsChange=\(\)\s+=>\s+\{\}\s+activeTab="Editor 3D"\s+/\>'
replacement = '<MeshEditor />'

new_content = re.sub(pattern, replacement, content)

with open('components/editor/Editor3D.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('✅ Archivo corregido exitosamente')
