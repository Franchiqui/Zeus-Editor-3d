# Zeus Media Studio - Documentación Completa de Editores

**Versión:** 1.0  
**Fecha:** 31 de julio de 2026  
**Descripción:** Guía exhaustiva de todos los editores multimedia de Zeus Media Studio, con especial detalle en el Editor de Video por ser el módulo más completo.

---

## Índice

1. [Introducción](#introducción)
2. [Arquitectura General](#arquitectura-general)
3. [Editor de Video](#editor-de-video)
   - [Interfaz General](#interfaz-general)
   - [Línea de Tiempo](#línea-de-tiempo)
   - [Reproductor y Vista Previa](#reproductor-y-vista-previa)
   - [Gestión de Clips](#gestión-de-clips)
   - [Pistas y Capas](#pistas-y-capas)
   - [Transiciones](#transiciones)
   - [Efectos Visuales](#efectos-visuales)
   - [Texto y Superposiciones](#texto-y-superposiciones)
   - [Objetos y Media](#objetos-y-media)
   - [Keyframes y Animación](#keyframes-y-animación)
   - [Exportación y Renderizado](#exportación-y-renderizado)
   - [Atajos de Teclado](#atajos-de-teclado)
4. [Editor de Audio](#editor-de-audio)
5. [Editor de Imagen](#editor-de-imagen)
6. [Editor de GIF](#editor-de-gif)
7. [Editor de Texto](#editor-de-texto)
8. [Editor de Documento](#editor-de-documento)
9. [Componentes UI Compartidos](#componentes-ui-compartidos)
10. [Procesamiento por IA](#procesamiento-por-ia)
11. [Sistema de Renderizado por Nodos](#sistema-de-renderizado-por-nodos)
12. [Electron y Escritorio](#electron-y-escritorio)
13. [Persistencia y Almacenamiento](#persistencia-y-almacenamiento)
14. [Consejos de Uso Avanzado](#consejos-de-uso-avanzado)
15. [Conclusión](#conclusión)

---

## Introducción

Zeus Media Studio es una aplicación de escritorio desarrollada con Next.js, React, TypeScript y Electron que ofrece un conjunto completo de editores multimedia. Permite crear, editar y exportar contenido de vídeo, audio, imagen, GIF, texto y documentos, integrando procesamiento por IA, efectos en tiempo real, línea de tiempo no lineal y múltiples formatos de exportación.

## Arquitectura General

La aplicación sigue una arquitectura modular donde cada editor es una página independiente que monta un componente principal:

| Ruta | Componente | Tamaño |
|------|------------|--------|
| `/edit-video` | VideoEditor.tsx | 585 KB |
| `/edit-audio` | AudioEditor.tsx | 98 KB |
| `/edit-imagen` | ImageEditor.tsx | 207 KB |
| `/edit-gif` | page.tsx (GIF maker) | 37 KB |
| `/edit-texto` | page.tsx (Texto) | 1.9 KB |
| `/edit-documento` | DocumentEditor.tsx | 103 KB |

## Editor de Video

El Editor de Video es el componente más grande y completo (585 KB, ~12,500 líneas). Su interfaz se divide en varias zonas:

- **Barra de herramientas superior**: archivo (nuevo, abrir, guardar, exportar), deshacer/rehacer, zoom, ajustes y chat IA.
- **Visor / Canvas**: previsualización en tiempo real con superposiciones.
- **Panel de propiedades**: inspector del elemento seleccionado.
- **Línea de tiempo multipista**: organiza clips de vídeo, audio, texto e imágenes.
- **Biblioteca de medios**: importa y arrastra recursos.
- **Panel de transiciones y efectos**: catálogo de transiciones y efectos visuales.
- **Reproductor integrado**: controles de reproducción, volumen, tiempo.

### Línea de Tiempo

El componente `Timeline.tsx` (94 KB) incluye:

- Múltiples pistas (vídeo, audio, texto, overlay).
- Clips redimensionables y movibles.
- División de clips (tijera, atajo `S`).
- Selección múltiple.
- Zoom horizontal y regla de tiempo.
- Cabezal de reproducción arrastrable.
- Marcadores.
- Miniaturas de clips de vídeo.

### Reproductor y Vista Previa

- **TimelinePlayer.tsx**: gestiona reproducción, pausa, volumen y sincronización del cabezal.
- **TimelinePreview.tsx**: minimapa de la línea de tiempo para navegación rápida.

Controles: `Espacio` (play/pausa), `Shift+Espacio` (detener), barras de volumen y tiempo.

### Gestión de Clips

Tipos de clips y operaciones:

- **Vídeo**: MP4, AVI, MOV, MKV, WEBM, FLV.
- **Audio**: MP3, WAV, OGG, FLAC, AAC, M4A.
- **Texto**: títulos, subtítulos, créditos.
- **Imagen**: PNG, JPEG, WebP.
- **Color/Fondo**: sólido o degradado.

Operaciones: importar, seleccionar, mover, recortar, dividir, copiar/pegar, eliminar, ajustar velocidad, fades de audio/vídeo, transformaciones (posición, escala, rotación, opacidad).

### Pistas y Capas

- Pista principal de vídeo.
- Múltiples pistas de audio.
- Pistas de texto.
- Pistas de superposición (overlay).

Cada pista tiene nombre editable, silenciar (`M`), solo (`S`), bloquear y altura ajustable. El orden de composición es de abajo hacia arriba.

### Transiciones

El `TransitionEditor.tsx` ofrece:

- **Fundido (Crossfade)**
- **Barrido (Wipe)**
- **Deslizamiento (Slide)**
- **Zoom**
- **Cortinilla (Iris)**

Configurables: duración, dirección, curva de interpolación.

### Efectos Visuales

`EffectsOverlay.tsx` y el sistema de nodos permiten:

- **Brillo**, **Contraste**, **Saturación**.
- **Desenfoque** gaussiano.
- **Viñeta**.
- **Corrección de color** (temperatura, tinte, exposición, gamma).
- **Blanco y negro**, **Sepia**, **Pixelado**.
- **Espejo** (horizontal/vertical).
- **Rotación libre**, **Opacidad**.

Los efectos se pueden aplicar por clip o por pista y animarse con keyframes.

### Texto y Superposiciones

- **VideoTextEditor.tsx** (49 KB): inserta texto en el canvas con estilos personalizables (fuente, tamaño, color, sombra, borde, opacidad, rotación, posicionamiento).
- **VideoObjectEditor.tsx** (22 KB): inserta rectángulos, círculos, líneas, flechas, polígonos, formas predefinidas, marcas de agua y widgets.
- **TextOverlay.tsx** / **ObjectOverlay.tsx** dibujan las superposiciones en el canvas.

### Objetos y Media

- Imágenes superpuestas con transparencia.
- Vídeos superpuestos (PiP) mediante `overlay-video-node`.
- Fondos de color, gradiente, imagen o vídeo.
- Máscaras circulares, rectangulares o personalizadas.

### Keyframes y Animación

- Propiedades animables: posición, escala, rotación, opacidad, recorte, efectos, transform, texto.
- Interpolaciones: lineal, ease-in, ease-out, ease-in-out, cúbica bezier, escalones.
- Gestión visual en la línea de tiempo con diamantes.
- Panel de keyframes con añadir, eliminar y navegar.

### Exportación y Renderizado

El sistema `lib/video-render/` proporciona renderizado por nodos. Formatos de salida:

- MP4 (H.264), WebM (VP8/VP9), MOV, ProRes.
- GIF (mediante `gif-utils.ts`).
- Secuencia de imágenes (PNG/JPEG).
- Audio (WAV, MP3, AAC, OGG).
- Proyecto (JSON).

Resoluciones: 360p a 4K. Calidades: baja, media, alta, ultra. Opciones: codec, FPS (24-60), incluir audio, escala, rango de exportación, cola de exportación y progreso en tiempo real.

### Atajos de Teclado

| Acción | Atajo |
|--------|-------|
| Play/Pausa | `Espacio` |
| Stop | `Shift+Espacio` |
| Anterior/Siguiente fotograma | `←` / `→` |
| Inicio / Fin | `Home` / `End` |
| Dividir clip | `Ctrl+B` o `S` |
| Eliminar clip | `Supr` |
| Deshacer / Rehacer | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Copiar / Pegar | `Ctrl+C` / `Ctrl+V` |
| Duplicar | `Ctrl+D` |
| Zoom línea de tiempo | `Ctrl+'+'` / `Ctrl+'-'` |
| Ajustar a cabezal | `Q` |
| Marcador | `M` |
| Silenciar / Solo pista | `M` / `S` (sin clip) |
| Guardar | `Ctrl+S` |
| Exportar | `Ctrl+E` |

## Editor de Audio

`AudioEditor.tsx` (98 KB) permite grabación, importación y edición de audio:

- Soporta MP3, WAV, OGG, FLAC, AAC, M4A.
- Línea de tiempo multipista con zoom, selección, corte, copiar/pegar, fades.
- Formas de onda (`AudioVisualizer.tsx`) y espectro (`AudioVisualizer2.tsx`).
- Ecualizador gráfico de 10 bandas (`nexus-eq-standalone.tsx`).
- Teclado MIDI virtual (`teclado-midi.tsx`).
- Ritmos locales y patrones (`rhythmPatterns.ts`, `ritmos-locales`).
- Generación de música procedural (`procedural-music.ts`, 43 KB).
- Exportación a WAV, MP3, OGG, FLAC.

Efectos: EQ, compresor, limitador, reverberación, delay, chorus, flanger, phaser, distorsión, filtros, noise gate, pitch, time-stretch y auto-tune.

Atajos: `Espacio` (play), `Shift+Espacio` (stop), `R` (grabar), `L` (loop), `K` (metrónomo).

## Editor de Imagen

`ImageEditor.tsx` (207 KB) incluye:

- Importación: JPEG, PNG, WebP, BMP, TIFF, SVG, GIF.
- Ajustes: brillo, contraste, saturación, exposición, temperatura, tinte, viñeta.
- Filtros: B/N, sepia, vintage, desenfoque, nitidez, pixelado, relieve.
- Capas con modos de fusión, máscaras, orden z, fusionar y duplicar.
- Herramientas de dibujo: pincel, lápiz, borrador, relleno, degradado, texto, formas, cuentagotas.
- Selección: rectángulo, lazo, varita mágica, transformación libre.
- Recorte con proporciones predefinidas (`CropOverlay.tsx`).
- Historial ilimitado de deshacer/rehacer.
- IA: eliminación de fondo (`/api/remove-bg`), generación (`/api/modelos`), mejora (`workflows`).
- Exportación: JPEG, PNG, WebP, BMP, TIFF.

## Editor de GIF

`app/edit-gif/page.tsx` (37 KB) permite crear GIF a partir de:

- **Vídeo**: importar, seleccionar segmento, FPS, escala.
- **Imágenes**: combinar secuencia con duración por fotograma.
- **Webcam**: grabar y convertir.

Componentes: `AnimationControls.tsx`, `DrawingCanvas.tsx`, `FrameList.tsx`, `GifLibrary.tsx`, `GifPreview.tsx`, `ImageUploader.tsx`, `WebcamCapture.tsx`.

Optimización: paleta cuantificada, difuminado, eliminación de duplicados. Exporta GIF animado o secuencia PNG/JPEG.

## Editor de Texto

`app/edit-texto/page.tsx` ofrece edición enriquecida:

- Formato: negrita, cursiva, subrayado, tachado, colores, resaltado.
- Párrafos: alineación, sangría, listas numeradas, viñetas, checklist.
- Estilos: H1-H6, citas, bloques de código con resaltado.
- Enlaces, imágenes, tablas.
- Soporte Markdown con vista previa en vivo.
- Guardado automático cada 30 segundos.
- Exportación a PDF, HTML, Markdown, TXT e impresión.

## Editor de Documento

`DocumentEditor.tsx` (103 KB) es el más avanzado:

- Plantillas: carta, informe, currículum, acta, nota de prensa, propuesta, blog, redes sociales.
- Colaboración en tiempo real.
- Comentarios y control de cambios (aceptar/rechazar).
- Estilos de párrafo, columnas, encabezados/pies, tabla de contenido automática, notas al pie.
- Revisión ortográfica.
- Exportación a PDF, DOCX, ODT, HTML, Markdown.
- Impresión con márgenes configurables.

## EDITOR HTML

### 9.1 CARACTERÍSTICAS PRINCIPALES

El **Editor HTML** (`EditorHTML.tsx`) es un diseñador web visual basado en un canvas de elementos superpuestos. Permite crear composiciones HTML con texto, formas, imágenes y efectos especiales, además de generar y exportar el código HTML empaquetado en ZIP.

**Capacidades principales:**
- **Canvas de diseño**: área de trabajo de tamaño configurable (por defecto 1280×960 px) donde se colocan elementos con posición absoluta.
- **Elementos**: rectángulos, círculos, líneas, textos e imágenes.
- **Propiedades editables**: posición X/Y, tamaño, rotación, opacidad, colores, bordes, sombras y tipografía.
- **Efectos de canvas**: fondo degradado animado, partículas, estrellas e iluminación interactiva (spotlight).
- **Fuentes**: fuentes del sistema y Google Fonts con búsqueda y previsualización.
- **Animaciones**: animaciones CSS predefinidas para elementos (fade, entrada por deslizamiento, rebote, pulso, etc.).
- **Chat IA**: asistente contextual para ayudar a generar/mejorar el código HTML.
- **Exportación**: descarga del diseño como archivo HTML + recursos en ZIP.
- **Proyectos locales**: guardar y abrir proyectos `.zeus` con todos los elementos e imágenes embebidas.

## Componentes UI Compartidos

`components/ui/` incluye: botones, inputs, selects, modales, tabs, sliders, switches, toasts, tooltips, alerts, cards, avatars, dropdowns, progress, skeleton, textarea, labels, toggles, file-uploader, `EditorFileNameBar`, `AudioVisualizer` y `AudioVisualizer2`.

## Procesamiento por IA

| Capacidad | API | Modelo |
|-----------|-----|--------|
| Chat asistente | `/api/chat` | GPT-4o / mini |
| Generación de imágenes | `/api/modelos` | Flux / Stable Diffusion |
| Eliminación de fondo | `/api/remove-bg` | rembg |
| Texto a voz | `/api/text-to-speech` | ElevenLabs / OpenAI |
| Foto a vídeo | `/api/crear-animacion` | LTX-Video |
| Mejora de imagen | `/api/modelos` + workflows | GFPGAN / Real-ESRGAN |
| Música procedural | `procedural-music.ts` | Web Audio API |

Chat de IA (`FloatingChatButton.tsx`) accesible con `Ctrl+Shift+C`.

## Sistema de Renderizado por Nodos

`lib/video-render/` construye un grafo de nodos:

- **BaseNode**, **RootNode**, **VideoNode**, **ImageNode**, **TextNode**, **ObjectNode**, **OverlayVideoNode**, **PaintNode**, **CropNode**, **EffectNode**, **SharpenNode**, **TransitionNode**.
- **FrameProvider** suministra fotogramas.
- **Composite** mezcla audio y dibuja texto.
- **SceneExporter** exporta el grafo.
- **VideoCache** (`service.ts`, `url-blob-cache.ts`) optimiza la reproducción.

## Electron y Escritorio

- `electron/main.js` (58 KB): gestión de ventanas, menús, IPC, sistema de archivos, plataformas.
- `electron/preload.js` (5 KB): expone `window.electronAPI` con `guardarArchivo`, `abrirArchivo`, `guardarComo`, `nuevoProyecto`, `exportar`, `mostrarDialogo`, `seleccionarCarpeta`, `ventanas`, `getVersion`, `getPlatform`.

## Persistencia y Almacenamiento

- **Electron FS**: proyectos `.json` o `.zeusproj` en disco.
- **PocketBase**: autenticación, colecciones, backups.
- **LocalStorage / Zustand persist**: preferencias y últimos proyectos.
- **Servidor local FastAPI** (`Servidor_Local/`) para generación de imágenes.

Archivos relevantes: `types/rhythm-config.json`, `docs/video_ltx2_3_i2v.json`, `workflows/enhance_api.json`.

## Consejos de Uso Avanzado

- **Vídeo**: `Ctrl+B` divide mientras se reproduce; arrastra esquinas del clip de audio para fades rápidos; `Ctrl+C/V` copia efectos entre clips.
- **Audio**: reduce 60-200 Hz y realza 1-4 kHz para voz clara; `L` activa bucle.
- **Imagen**: usa IA para eliminar fondos; modo Multiplicar para sombras y Pantalla para brillos; máscaras con pincel B/N.
- **Documento**: usa plantillas predefinidas; activa control de cambios para revisiones.

## Conclusión

Zeus Media Studio es una suite completa de edición multimedia. El Editor de Video destaca por su línea de tiempo multipista, sistema de nodos de renderizado, keyframes, transiciones, efectos y exportación profesional, complementado con asistentes de IA y empaquetado de escritorio con Electron.

---

*Documentación generada para Zeus Media Studio v0.1.0*
