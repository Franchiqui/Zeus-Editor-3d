# ZEUS MEDIA STUDIO - Guía Completa de Editores

**Versión:** 1.0  
**Fecha:** 31 de julio de 2026  
**Descripción:** Documentación exhaustiva de todos los editores multimedia de Zeus Media Studio, con análisis detallado del Editor de Video por ser el módulo más completo.

---

## ÍNDICE

1. [Introducción a Zeus Media Studio](#introducción-a-zeus-media-studio)
2. [Arquitectura General](#arquitectura-general)
3. [Editor de Video (Módulo Principal)](#editor-de-video)
   - 3.1 [Interfaz General](#31-interfaz-general)
   - 3.2 [Línea de Tiempo (Timeline)](#32-línea-de-tiempo-timeline)
   - 3.3 [Reproductor y Vista Previa](#33-reproductor-y-vista-previa)
   - 3.4 [Gestión de Clips](#34-gestión-de-clips)
   - 3.5 [Pistas y Capas](#35-pistas-y-capas)
   - 3.6 [Transiciones](#36-transiciones)
   - 3.7 [Efectos Visuales](#37-efectos-visuales)
   - 3.8 [Texto y Superposiciones](#38-texto-y-superposiciones)
   - 3.9 [Objetos y Media](#39-objetos-y-media)
   - 3.10 [Keyframes y Animación](#310-keyframes-y-animación)
   - 3.11 [Exportación y Renderizado](#311-exportación-y-renderizado)
   - 3.12 [Atajos de Teclado del Editor de Video](#312-atajos-de-teclado-del-editor-de-video)
4. [Editor de Audio](#editor-de-audio)
   - 4.1 [Características Principales](#41-características-principales)
   - 4.2 [Componentes y Herramientas](#42-componentes-y-herramientas)
   - 4.3 [Efectos y Ecualizador](#43-efectos-y-ecualizador)
   - 4.4 [Atajos de Teclado](#44-atajos-de-teclado)
5. [Editor de Imagen](#editor-de-imagen)
   - 5.1 [Características Principales](#51-características-principales)
   - 5.2 [Herramientas de Dibujo y Pintura](#52-herramientas-de-dibujo-y-pintura)
   - 5.3 [Capas, Superposiciones y Selección](#53-capas-superposiciones-y-selección)
   - 5.4 [IA y Eliminación de Fondo](#54-ia-y-eliminación-de-fondo)
   - 5.5 [Atajos de Teclado](#55-atajos-de-teclado)
6. [Editor de GIF](#editor-de-gif)
   - 6.1 [Características Principales](#61-características-principales)
   - 6.2 [Creación de GIF](#62-creación-de-gif)
   - 6.3 [Fotogramas y Animación](#63-fotogramas-y-animación)
   - 6.4 [Atajos de Teclado](#64-atajos-de-teclado)
7. [Editor de Texto](#editor-de-texto)
   - 7.1 [Características Principales](#71-características-principales)
   - 7.2 [Atajos de Teclado](#72-atajos-de-teclado)
 8. [Editor de Documento](#editor-de-documento)
    - 8.1 [Características Principales](#81-características-principales)
    - 8.2 [Formato y Plantillas](#82-formato-y-plantillas)
    - 8.3 [Atajos de Teclado](#83-atajos-de-teclado)
 9. [Editor HTML](#editor-html)
    - 9.1 [Características Principales](#91-características-principales)
    - 9.2 [Herramientas y Elementos](#92-herramientas-y-elementos)
    - 9.3 [Propiedades y Estilos](#93-propiedades-y-estilos)
    - 9.4 [Efectos de Canvas](#94-efectos-de-canvas)
    - 9.5 [Fuentes y Tipografía](#95-fuentes-y-tipografía)
    - 9.6 [Exportación y Proyectos](#96-exportación-y-proyectos)
    - 9.7 [Chat IA y Código](#97-chat-ia-y-código)
    - 9.8 [Atajos de Teclado](#98-atajos-de-teclado)
 10. [Componentes UI Compartidos](#componentes-ui-compartidos)
10. [Procesamiento por IA](#procesamiento-por-ia)
11. [Atajos de Teclado Globales](#atajos-de-teclado-globales)
12. [APIs y Rutas Internas](#apis-y-rutas-internas)
13. [Sistema de Renderizado por Nodos](#sistema-de-renderizado-por-nodos)
14. [Electron y Escritorio](#electron-y-escritorio)
15. [Persistencia y Almacenamiento](#persistencia-y-almacenamiento)
16. [Consejos de Uso Avanzado](#consejos-de-uso-avanzado)

---

## INTRODUCCIÓN A ZEUS MEDIA STUDIO

Zeus Media Studio es una aplicación de escritorio (desarrollada con Next.js, React, TypeScript y Electron) que integra un conjunto completo de editores multimedia en un solo entorno. Permite trabajar con vídeo, audio, imagen, GIF animado, texto enriquecido y documentos complejos, ofreciendo funcionalidades de edición no lineal, procesamiento por IA, efectos en tiempo real y exportación profesional.

### Stack Tecnológico

| Tecnología | Uso |
|------------|-----|
| **Next.js 14+** | Framework principal, enrutado y API routes |
| **React 18+** | Interfaz de usuario y componentes |
| **TypeScript** | Tipado estático en todo el proyecto |
| **Tailwind CSS** | Estilos y diseño responsive |
| **Electron** | Empaquetado como aplicación de escritorio |
| **Zustand** | Estado global (lib/store) |
| **Canvas API** | Renderizado, efectos y lienzos de dibujo |
| **Web Audio API** | Procesamiento de audio |
| **PocketBase** | Base de datos y autenticación |
| **Zustand + Persist** | Almacenamiento local con persistencia |

---

## ARQUITECTURA GENERAL

La aplicación sigue una arquitectura de **editors** modulares. Cada editor es una página independiente (app/edit-*) que monta un componente principal dentro de components/editor/.

```
┌────────────────────────────────────────────────────────┐
│                    Zeus Media Studio                    │
├────────────────────────────────────────────────────────┤
│  Header │ Navbar │ Sidebar │ Chat IA │ Rutas internas  │
├─────────┴────────┴─────────┴─────────┴─────────────────┤
│                                                        │
│  /edit-video    → VideoEditor.tsx        (585KB)       │
│  /edit-audio    → AudioEditor.tsx        (98KB)        │
│  /edit-imagen   → ImageEditor.tsx        (207KB)       │
│  /edit-gif      → page.tsx               (37KB)        │
│  /edit-texto    → page.tsx               (1.9KB)       │
│  /edit-documento→ DocumentEditor.tsx     (103KB)       │
│                                                        │
├────────────────────────────────────────────────────────┤
│  /api/*  → rutas de backend para IA, archivos, docs    │
│  lib/    → utilidades, renderizado, store              │
│  electron → main.js, preload.js                        │
└────────────────────────────────────────────────────────┘
```

### Páginas de Editores

| Ruta | Archivo | Componente Principal | Tamaño |
|------|---------|---------------------|--------|
| `/edit-video` | app/edit-video/page.tsx | VideoEditor.tsx | 585 KB |
| `/edit-audio` | app/edit-audio/page.tsx | AudioEditor.tsx | 98 KB |
| `/edit-imagen` | app/edit-imagen/page.tsx | ImageEditor.tsx | 207 KB |
| `/edit-gif` | app/edit-gif/page.tsx | GifLibrary + AnimationControls | 37 KB |
| `/edit-texto` | app/edit-texto/page.tsx | TextEditor integrado | 1.9 KB |
| `/privacy` | app/privacy/page.tsx | Página legal | 4.6 KB |
| `/terms` | app/terms/page.tsx | Página legal | 4.4 KB |

---

## EDITOR DE VIDEO

### 3.1 INTERFAZ GENERAL

El Editor de Video (VideoEditor.tsx) es el componente más extenso y completo de Zeus Media Studio (585 KB, ~12.500 líneas). Presenta una interfaz distribuida en varias zonas funcionales:

1. **Barra de herramientas superior**: contiene acciones de archivo (nuevo, abrir, guardar, exportar), deshacer/rehacer, zoom de la línea de tiempo, ajustes de proyecto y acceso al chat de IA.
2. **Visor / Canvas**: área central donde se previsualiza el vídeo en tiempo real. Incluye superposiciones para texto, efectos, objetos y selección.
3. **Panel de propiedades** (lateral derecho): muestra las propiedades del clip, pista o elemento seleccionado (posición, tamaño, rotación, opacidad, velocidad, etc.).
4. **Línea de tiempo** (inferior): multipista, permite organizar clips de vídeo, audio, texto e imágenes en capas.
5. **Panel de biblioteca / medios**: permite importar y arrastrar recursos (vídeo, audio, imágenes).
6. **Panel de transiciones y efectos**: biblioteca de transiciones (fundido, barrido, deslizamiento, zoom) y efectos visuales (brillo, contraste, saturación, desenfoque, viñeta, corrección de color).
7. **Reproductor integrado**: controles de reproducción, tiempo actual, duración total, volumen y silencio.

**Diagrama de zonas:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Barra de herramientas superior (archivo, IA, zoom, ayuda)     │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│                            │   Panel de propiedades /           │
│       VISOR / CANVAS       │   Inspector del elemento           │
│   (previsualización en     │   seleccionado                     │
│    tiempo real)            │                                    │
│                            │                                    │
├────────────────────────────┴────────────────────────────────────┤
│  LÍNEA DE TIEMPO MULTIPISTA (vídeo, audio, texto, overlay)     │
│  [Clips] [Transiciones] [Efectos] [Marcadores] [Zoom]          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 LÍNEA DE TIEMPO (TIMELINE)

El componente Timeline.tsx (94 KB) es el corazón del editor. Permite organizar el material audiovisual de forma no lineal. Sus capacidades incluyen:

- **Múltiples pistas**: pista principal de vídeo, pistas de audio, pistas de texto y pistas de superposición (overlay).
- **Clips redimensionables**: cada clip se muestra como un bloque en la pista; se puede estirar para ajustar su duración o recortar desde los extremos.
- **Movimiento de clips**: arrastrar para reubicar en el tiempo (izquierda/derecha) o entre pistas.
- **División de clips**: herramienta de tijera para cortar un clip en dos en la posición del cabezal (atajo `S`).
- **Selección múltiple**: permite seleccionar varios clips a la vez para moverlos, copiarlos o eliminarlos.
- **Zoom horizontal**: acercar/alejar la escala de tiempo para editar con precisión de fotogramas o de minutos.
- **Regla de tiempo**: muestra marcas de tiempo (segundos/minutos), con opción de ajuste (`snapping`) al cabezal.
- **Cabezal de reproducción**: línea vertical que indica el fotograma actual; se puede arrastrar para ubicarse en un instante concreto.
- **Marcadores**: puntos de referencia en la línea de tiempo para facilitar la navegación (atajo `M`).
- **Líneas de transición asociadas**: sobre el clip se dibujan indicadores cuando hay transiciones envolventes.
- **Previsualización de miniaturas**: los clips de vídeo pueden mostrar una imagen representativa (thumbnail) del contenido.

**Detalles técnicos:**

- El estado de la línea de tiempo se gestiona en el propio VideoEditor mediante un store general (useEditorStore o similar) y se sincroniza con el reproductor y el canvas.
- Los clips pueden tener duración en segundos (con precisión de centésimas).
- El zoom mínimo/máximo se controla con `Ctrl + '+'` y `Ctrl + '-'`, o mediante la barra de zoom.
- Al mover un clip, se respetan los límites de la duración total del proyecto.
- Existe un archivo de respaldo `Timeline.tsx.zeus-backup` (87 KB) que indica que la línea de tiempo ha sufrido iteraciones de desarrollo.

### 3.3 REPRODUCTOR Y VISTA PREVIA

El sistema de reproducción se basa en dos componentes:

- **TimelinePlayer.tsx** (14 KB): gestiona el estado de reproducción (playing, paused, currentTime, duration), el volumen y el silencio. Se comunica con la línea de tiempo para sincronizar el cabezal.
- **TimelinePreview.tsx** (7 KB): muestra una vista previa reducida de la línea de tiempo completa (minimapa), útil para navegar rápidamente.

**Controles de reproducción:**

- ▶️ Reproducir / Pausar (`Espacio`)
- ⏹ Detener (`Shift + Espacio`)
- ⏪ Saltar al inicio
- ⏩ Ir al final
- 🔇 Silenciar / Activar sonido
- 📢 Volumen deslizante
- Tiempo actual / Duración total

**Sincronización con el Canvas:** mientras se reproduce, el canvas se actualiza en cada fotograma para mostrar el resultado de la composición (vídeo, efectos, texto, imágenes superpuestas, transiciones, etc.). La velocidad de fotogramas es configurable (por defecto 30 fps, hasta 60 fps).

### 3.4 GESTIÓN DE CLIPS

El editor permite gestionar múltiples tipos de clips en la línea de tiempo:

| Tipo de Clip | Descripción |
|--------------|-------------|
| **Clip de vídeo** | Archivos MP4, AVI, MOV, MKV, WEBM, FLV. Se pueden recortar, dividir, mover, aplicar efectos y ajustar velocidad. |
| **Clip de audio** | Archivos MP3, WAV, OGG, FLAC, AAC, M4A. Se pueden ajustar volumen, fades, silenciar, y aplicar efectos de audio. |
| **Clip de texto** | Texto superpuesto en el vídeo (títulos, subtítulos, créditos) con estilos personalizables. |
| **Clip de imagen** | Imágenes PNG, JPEG, WebP, etc. con transparencia, posición, escala y rotación. |
| **Clip de color / fondo** | Fondo de color sólido o degradado (generado proceduralmente). |

**Operaciones sobre clips:**

1. **Importar**: a través del panel de biblioteca o arrastrando archivos al editor (los archivos se procesan mediante upload a /api/rutas/upload).
2. **Seleccionar**: clic izquierdo sobre el clip. `Ctrl + clic` para selección múltiple.
3. **Mover**: arrastrar el clip horizontalmente (cambia su `startTime`) o verticalmente (cambia de pista).
4. **Recortar**: arrastrar los bordes izquierdo/derecho del clip para ajustar `trimStart` y `trimEnd` sin alterar la duración original del archivo.
5. **Dividir**: en la posición del cabezal, corta el clip en dos clips independientes (atajo `S`).
6. **Copiar/Pegar**: duplica el clip (y sus keyframes) en la posición del cabezal (Ctrl+C / Ctrl+V).
7. **Eliminar**: elimina el clip de la pista (tecla `Supr`).
8. **Ajustar velocidad**: en el inspector, se puede cambiar la velocidad de reproducción (0.25x, 0.5x, 1x, 1.5x, 2x, 4x), afectando a la duración del clip en la línea de tiempo.
9. **Desvanecer (fade in/out)**: los clips de audio y vídeo muestran manijas para crear fades de entrada y salida.
10. **Propiedades de transformación**: posición X/Y, escala, rotación, opacidad y anclaje. Se aplican al clip en el canvas.

### 3.5 PISTAS Y CAPAS

El proyecto soporta **múltiples pistas** clasificadas por tipo:

- **Pista principal de vídeo**: donde se colocan los clips de vídeo base.
- **Pistas de audio**: varias pistas de audio independientes (se pueden mezclar con diferentes niveles de volumen).
- **Pistas de texto**: capas donde se insertan los títulos y subtítulos (una por nivel).
- **Pistas de superposición (overlay)**: imágenes, logotipos, marcas de agua, etc., por encima del vídeo principal.

**Propiedades de las pistas:**

- Nombre editable.
- Silenciar (`M` cuando no hay clip seleccionado).
- Solo (solamente esa pista audible/visible).
- Bloquear (evita ediciones accidentales).
- Altura ajustable.

El **orden de composición** es: las pistas superiores se dibujan por encima de las inferiores. La pista más alta tiene prioridad visual.

### 3.6 TRANSICIONES

El editor incluye un **TransitionEditor.tsx** (6 KB) que permite agregar transiciones entre clips contiguos de la misma pista. Las transiciones disponibles:

| Transición | Descripción |
|------------|-------------|
| **Fundido (Crossfade)** | Fundido entre el clip A y el clip B. |
| **Barrido (Wipe)** | Un clip barre al siguiente de un lado a otro (dirección configurable). |
| **Deslizamiento (Slide)** | El clip B desliza sobre el clip A. |
| **Zoom** | El clip B escala desde el centro mientras el A se desvanece. |
| **Cortinilla (Iris)** | Apertura circular o rectangular. |

**Duración de la transición**: configurable en milisegundos (por defecto 500 ms). Al aplicar una transición, los clips se superponen ligeramente y el sistema calcula automáticamente los trim internos.

**Propiedades de la transición:**

- Tipo (fundido, barrido, deslizamiento, zoom, iris).
- Duración.
- Dirección (para barrido/deslizamiento).
- Curva de interpolación (lineal, ease-in, ease-out, ease-in-out).

Cuando se aplica una transición se muestra un pequeño icono en la línea de tiempo sobre el punto de corte.

### 3.7 EFECTOS VISUALES

El sistema de efectos se implementa mediante **EffectsOverlay.tsx** (3 KB) que dibuja el efecto sobre el canvas (CSS filters y/o WebGL). La lista de efectos disponibles:

| Efecto | Parámetros | Descripción |
|--------|------------|-------------|
| **Brillo** | -1 a 1 | Ajusta el brillo general de la imagen. |
| **Contraste** | -1 a 1 | Ajusta el contraste general. |
| **Saturación** | 0 a 2 | Saturación del color (0 = escala de grises, >1 = intenso). |
| **Desenfoque** | 0 a 20 px | Desenfoque gaussiano del clip. |
| **Viñeta** | 0 a 1 | Oscurece los bordes de la imagen. |
| **Corrección de color** | Temperatura, Tinte, Exposición, Gamma | Ajustes finos de color. |
| **Blanco y negro** | - | Convierte el clip a escala de grises. |
| **Sepia** | - | Aplica tono sepia. |
| **Pixelado** | 1 a 50 | Efecto pixel-art. |
| **Espejo** | Horizontal / Vertical | Voltea el clip. |
| **Rotación libre** | grados | Rota el clip en el canvas. |
| **Opacidad** | 0 a 100% | Transparencia del clip. |

**Capa de efectos:** se pueden combinar varios efectos encadenados en orden. El orden importa (por ejemplo, brillo antes que desenfoque produce un resultado distinto).

Los efectos se pueden aplicar **por clip** o **por pista**, y se pueden animar mediante keyframes.

### 3.8 TEXTO Y SUPERPOSICIONES

**VideoTextEditor.tsx** (49 KB) es el componente dedicado a insertar y editar texto sobre el vídeo. Sus capacidades:

- **Crear texto**: clic en "Añadir texto" crea un clip de texto en la línea de tiempo.
- **Escribir contenido**: el texto se escribe directamente en el canvas (TextOverlay.tsx, 6 KB).
- **Estilos**:
  - Fuente (lista de fuentes del sistema / Google Fonts).
  - Tamaño (px).
  - Color de relleno.
  - Color de fondo (opcional).
  - Negrita, cursiva, subrayado, tachado.
  - Alineación (izquierda, centro, derecha).
  - Interlineado.
  - Sombra de texto (offset, blur, color).
  - Borde / contorno.
  - Opacidad.
  - Rotación.
  - Posición X/Y en el canvas.
  - Escala.
  - Animación de entrada/salida (fade, deslizamiento, zoom).
- **Animaciones**: el texto puede tener keyframes para moverse, escalar, rotar o cambiar color a lo largo del tiempo.
- **Títulos y subtítulos**: plantillas de título con fondo semitransparente para subtítulos.
- **Créditos**: lista de nombres con desplazamiento vertical (modo créditos).

**VideoObjectEditor.tsx** (22 KB) permite insertar **objetos gráficos**:

- Rectángulos (con esquinas redondeadas).
- Círculos / Elipses.
- Líneas / Flechas.
- Polígonos.
- Formas predefinidas (estrellas, corazones, etc.).
- Marcas de agua / logos (imagen con transparencia).
- Widgets (reloj, contador, progreso).

Cada objeto tiene propiedades de posición, tamaño, rotación, opacidad, color de relleno, color de borde, grosor de borde, sombra, redondez (esquinas), y opcionalmente keyframes para animación.

### 3.9 OBJETOS Y MEDIA

El sistema de **objetos** permite superponer medios adicionales sobre el vídeo principal:

- **ObjectOverlay.tsx** (8 KB) dibuja objetos (rectángulos, círculos, líneas, texto) sobre el canvas en la posición indicada.
- Las **imágenes superpuestas** se pueden arrastrar y soltar sobre el canvas; se ajustan posición, tamaño, rotación, opacidad y recorte.
- Los **vídeos superpuestos** (overlay-video-node) se renderizan sobre el vídeo principal con su propia pista de la línea de tiempo, permitiendo efectos de PiP (Picture-in-Picture).
- **Fondo**: se puede elegir un color sólido, un gradiente lineal o radial, una imagen de fondo o un vídeo de fondo.
- **Transparencia**: los elementos PNG con canal alfa se respetan.
- **Máscaras**: se puede aplicar una máscara circular, rectangular o personalizada a cualquier objeto.

### 3.10 KEYFRAMES Y ANIMACIÓN

El editor de vídeo incorpora un sólido sistema de **keyframes** que permite animar cualquier propiedad del clip a lo largo del tiempo:

**Propiedades animables:**

- Posición X / Y (movimiento).
- Escala X / Y (zoom).
- Rotación (grados).
- Opacidad.
- Recorte (crop superior/inferior/izquierdo/derecho).
- Efectos (brillo, contraste, saturación, desenfoque, viñeta).
- Transform (translate, scale, rotate).
- Texto (contenido, tamaño, color, sombra).

**Interpolación entre keyframes:**

- **Lineal** (movimiento uniforme).
- **Ease-in** (aceleración).
- **Ease-out** (deceleración).
- **Ease-in-out** (suave al inicio y final).
- **Cúbica bezier** (control manual de la curva).
- **Escalones** (cambio brusco).

**Gestión de keyframes en la línea de tiempo:**

- Se muestra un **diamante** en el clip cada vez que hay un keyframe.
- Al seleccionar el clip, se abre el **panel de keyframes** con la lista de propiedades animadas.
- Se usa el botón **"Añadir keyframe"** para capturar la propiedad en el tiempo actual.
- Navegar entre keyframes con los botones ◀ (anterior) y ▶ (siguiente).
- Se puede **eliminar** un keyframe con el botón 🗑.
- La **curva de interpolación** se puede visualizar y editar gráficamente.

**Ejemplo de animación sencilla:**

1. En el clip seleccionado, marcar el keyframe 1 en el tiempo 0s con posición (0,0).
2. Mover el cabezal a 2s y establecer posición (500, 0).
3. Añadir keyframe 2.
4. Resultado: el objeto se mueve de izquierda a derecha durante 2 segundos.

### 3.11 EXPORTACIÓN Y RENDERIZADO

El proceso de exportación se apoya en el sistema **lib/video-render/** (más de 20 archivos dedicados al renderizado por nodos). Los escenarios de exportación incluyen:

**Formatos de salida:**

- **MP4** (H.264, calidad ajustable, hasta 4K).
- **WebM** (VP8/VP9).
- **MOV** (QuickTime).
- **ProRes** (para postproducción profesional).
- **GIF** (a partir del vídeo, mediante lib/gif-utils.ts).
- **Secuencia de imágenes** (PNG/JPEG por fotograma).
- **Audio** (WAV, MP3, AAC, OGG).
- **Proyecto** (JSON completo para guardar/abrir).

**Resoluciones:**

- 360p (640×360).
- 480p (854×480).
- 720p (1280×720).
- 1080p (1920×1080).
- 1440p (2560×1440).
- 4K (3840×2160).

**Calidad / Bitrate:**

- Baja (bitrate bajo, tamaño de archivo reducido).
- Media.
- Alta.
- Ultra (calidad casi sin pérdida).

**Opciones avanzadas de exportación:**

- **Codec**: H.264, H.265/HEVC (si el hardware lo soporta), VP9, AV1 (experimental).
- **FPS**: 24, 25, 30, 50, 60.
- **Incluir audio**: sí/no.
- **Escala de resolución**: mantener aspecto o forzar.
- **Rango de exportación**: todo el proyecto o desde/hasta marcadores.
- **Previsualización en tiempo real** durante el renderizado.
- **Cola de exportación** (permite exportar varios proyectos seguidos).

**Progreso del renderizado:**

- Muestra barra de progreso, tiempo restante estimado y fotograma actual.
- Permite cancelar la exportación.
- Al terminar, guarda el archivo en la ruta deseada (selector nativo o diálogo de guardado).

### 3.12 ATAJOS DE TECLADO DEL EDITOR DE VIDEO

| Acción | Atajo |
|--------|-------|
| Reproducir/Pausar | `Espacio` |
| Detener | `Shift + Espacio` |
| Anterior fotograma | `←` |
| Siguiente fotograma | `→` |
| Anterior 1 segundo | `Shift + ←` |
| Siguiente 1 segundo | `Shift + →` |
| Inicio del proyecto | `Home` |
| Fin del proyecto | `End` |
| Dividir clip en cabezal | `Ctrl + B` o `S` |
| Eliminar clip seleccionado | `Supr` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Copiar clip(s) | `Ctrl + C` |
| Pegar clip(s) | `Ctrl + V` |
| Duplicar clip | `Ctrl + D` |
| Zoom in línea de tiempo | `Ctrl + '+'` |
| Zoom out línea de tiempo | `Ctrl + '-'` |
| Ajustar zoom a todo | `Shift + 1` |
| Ajustar a cabezal | `Q` |
| Añadir marcador | `M` |
| Silenciar pista | `M` (sin clip seleccionado) |
| Solo pista | `S` (sin clip seleccionado) |
| Guardar proyecto | `Ctrl + S` |
| Exportar proyecto | `Ctrl + E` |
| Abrir proyecto | `Ctrl + O` |
| Nuevo proyecto | `Ctrl + N` |
| Seleccionar herramienta selección | `V` |
| Seleccionar herramienta mano | `H` |
| Seleccionar herramienta tijera | `C` |
| Seleccionar herramienta texto | `T` |
| Seleccionar herramienta rectángulo | `R` |
| Seleccionar herramienta círculo | `O` |
| Mover clip seleccionado | Flechas (1px) / Shift+Flechas (10px) |

---

## EDITOR DE AUDIO

### 4.1 CARACTERÍSTICAS PRINCIPALES

El **Editor de Audio** (AudioEditor.tsx, 98 KB) permite trabajar con sonido de forma profesional:

- **Grabación**: captura desde micrófono o línea de entrada con monitorización en tiempo real.
- **Importación**: MP3, WAV, OGG, FLAC, AAC, M4A.
- **Línea de tiempo multipista**: zoom, selección, corte, copiar/pegar, fade, fundidos.
- **Formas de onda**: visualización detallada con zoom espectral (AudioVisualizer.tsx, 30 KB y AudioVisualizer2.tsx, 22 KB).
- **Metrónomo y ritmos**: integración con ritmos locales (/api/ritmos-locales) y patrones rítmicos (rhythmPatterns.ts).
- **Generación de música procedural**: el sistema puede generar música automáticamente (procedural-music.ts, 43 KB) usando síntesis por instrumentos (instrumentSynth.ts).
- **Exportación**: WAV, MP3, OGG, FLAC, opciones de bitrate.

### 4.2 COMPONENTES Y HERRAMIENTAS

| Componente | Archivo | Descripción |
|------------|---------|-------------|
| **AudioEditor** | AudioEditor.tsx | Componente principal. |
| **AudioVisualizer** | AudioVisualizer.tsx | Visualizador de forma de onda interactivo. |
| **AudioVisualizer2** | AudioVisualizer2.tsx | Visualizador de espectro / análisis FFT. |
| **Nexus EQ** | nexus-eq-standalone.tsx | Ecualizador gráfico de 10 bandas. |
| **Teclado MIDI** | teclado-midi.tsx | Teclado virtual para tocar/entrada MIDI. |

**Herramientas de edición:**

- Seleccionar / Mover.
- Tijera (cortar).
- Lapicero (dibujar envolvente de volumen).
- Fade in / Fade out.
- Silenciar selección.
- Loop (repetir sección).
- Zoom horizontal/vertical.
- Edición espectral (visualización de frecuencias).

### 4.3 EFECTOS Y ECUALIZADOR

El editor incluye una cadena de efectos procesables en tiempo real (audioEffectsChain.ts, 7 KB):

| Efecto | Parámetros |
|--------|------------|
| Ecualizador (EQ) | 10 bandas (31Hz - 16kHz), ganancia por banda |
| Compresor | Threshold, ratio, attack, release |
| Limitador | Threshold, release |
| Reverberación | Tamaño de sala, damping, pre-delay, mezcla |
| Delay | Tiempo, feedback, mezcla |
| Chorus | Velocidad, profundidad, mezcla |
| Flanger | Velocidad, profundidad, feedback, mezcla |
| Phaser | Velocidad, profundidad, etapas |
| Distorsión | Drive, mezcla |
| Filtro paso bajo / paso alto | Frecuencia de corte, resonancia |
| Puerta de ruido (Noise Gate) | Threshold, attack, release |
| Cambio de tono (pitch) | Semitonos |
| Time-stretch | Velocidad sin alterar tono |
| Auto-tune (simple) | Nota base, corrección |

### 4.4 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Reproducir/Pausar | `Espacio` |
| Detener | `Shift + Espacio` |
| Cortar selección | `Ctrl + X` |
| Copiar selección | `Ctrl + C` |
| Pegar | `Ctrl + V` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Zoom in | `Ctrl + '+'` |
| Zoom out | `Ctrl + '-'` |
| Silenciar pista | `M` |
| Solo pista | `S` |
| Grabar | `R` |
| Loop | `L` |
| Metrónomo | `K` |

---

## EDITOR DE IMAGEN

### 5.1 CARACTERÍSTICAS PRINCIPALES

El **Editor de Imagen** (ImageEditor.tsx, 207 KB) es muy completo. Incluye:

- **Importación**: JPEG, PNG, WebP, BMP, TIFF, SVG, GIF (primer fotograma).
- **Ajustes básicos**: brillo, contraste, saturación, exposición, temperatura, tinte, viñeta.
- **Filtros**: blanco y negro, sepia, vintage, desenfoque, nitidez, pixelado, relieve, acuarela.
- **Capas**: múltiples capas con modos de fusión (normal, multiplicar, pantalla, sobreexponer, etc.).
- **Herramientas de selección**: rectángulo, lazo, varita mágica.
- **Transformación**: escala, rotación, sesgado, perspectiva, libre.
- **Historial**: deshacer/rehacer ilimitado (hasta 100 pasos).
- **Exportación**: JPEG, PNG, WebP, BMP, TIFF (con opciones de calidad).

### 5.2 HERRAMIENTAS DE DIBUJO Y PINTURA

| Herramienta | Atajo | Descripción |
|-------------|-------|-------------|
| Pincel | `B` | Pincel suave o duro, tamaño variable, presión (tableta). |
| Lápiz | `N` | Trazo duro de 1px. |
| Borrador | `E` | Borra píxeles (con opción de transparencia). |
| Relleno | `G` | Rellena área conectada con color. |
| Degradado | `Y` | Degradado lineal o radial entre dos colores. |
| Texto | `T` | Inserta texto con fuentes del sistema. |
| Formas | `U` | Rectángulo, círculo, línea, flecha (con contorno y relleno). |
| Cuentagotas | `I` | Toma color de la imagen. |

**Propiedades del pincel**: tamaño, dureza, opacidad, flujo, color, mezcla.

### 5.3 CAPAS, SUPERPOSICIONES Y SELECCIÓN

- **Panel de capas**: lista de capas con visibilidad, bloqueo, opacidad y modos de fusión.
- **Máscaras de capa**: máscara blanca/negra para ocultar/mostrar partes.
- **Orden z**: arrastrar para reordenar.
- **Selección múltiple**: shift+clic para seleccionar varias capas.
- **Fusionar capas** (merge).
- **Duplicar capa**.

**Selección y transformación:**

- **SelectionOverlay.tsx** (25 KB) dibuja el rectángulo de selección con puntos de control (esquinas y bordes) para redimensionar, rotar y mover.
- **CropOverlay.tsx** (6 KB) herramienta de recorte con proporciones predefinidas (1:1, 4:3, 16:9, 3:2, libre).
- **PaintOverlay.tsx** (19 KB) superposición para pincel con trazado suavizado.
- **TextOverlay.tsx** superposición de texto en el canvas.
- **EffectsOverlay.tsx** superposición de efectos visuales.
- **ObjectOverlay.tsx** superposición de objetos geométricos.

### 5.4 IA Y ELIMINACIÓN DE FONDO

- **Eliminación de fondo automática** (remove-bg) mediante `/api/remove-bg` (basado en IA / modelo rembg).
- **Generación de imagen** mediante `/api/modelos` y `flux-bridge.py` (47 KB, que conecta con modelos de generación).
- **Mejora de imagen** (upscale/enhance) mediante workflows de `workflows/enhance_api.json` y `enhance_upscale_only_api.json`.
- **Ajuste inteligente**: se puede pedir a la IA que "mejore el contraste", "haga la imagen más nítida", etc., usando el chat centrado en la imagen.

### 5.5 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Seleccionar herramienta selección | `V` |
| Pincel | `B` |
| Lápiz | `N` |
| Borrador | `E` |
| Relleno | `G` |
| Degradado | `Y` |
| Texto | `T` |
| Formas | `U` |
| Cuentagotas | `I` |
| Mover herramienta (mano) | `H` |
| Zoom in | `Ctrl + '+'` |
| Zoom out | `Ctrl + '-'` |
| Ajustar a pantalla | `Ctrl + 0` |
| Rotar 90° derecha | `Ctrl + R` |
| Voltear horizontal | `H` (con selección) |
| Voltear vertical | `V` (con selección) |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Guardar | `Ctrl + S` |
| Rectángulo de selección | `M` |
| Lazo | `L` |
| Varita mágica | `W` |

---

## EDITOR DE GIF

### 6.1 CARACTERÍSTICAS PRINCIPALES

El **Editor de GIF** (app/edit-gif/page.tsx, 37 KB) permite crear y editar animaciones GIF:

- **Crear desde video**: importar video y seleccionar segmento (inicio/fin) para convertirlo a GIF.
- **Crear desde imágenes**: cargar varias imágenes (PNG/JPEG) y combinarlas en secuencia animada.
- **Captura de webcam**: grabar desde la cámara y convertir a GIF animado.
- **Dibujar sobre fotogramas**: herramientas de dibujo sobre cada fotograma (lápiz, pincel, formas, texto).
- **Editor de fotogramas**: añadir, eliminar, duplicar, reordenar, ajustar duración por fotograma.
- **Optimización**: reducir tamaño con paleta cuantificada (128/256 colores), difuminado, y eliminación de duplicados.
- **Exportación**: GIF animado, o secuencia de PNG/JPEG.

### 6.2 CREACIÓN DE GIF

**Desde video:**

1. Importar video (MP4, WebM, etc.).
2. El video se muestra en un reproductor.
3. Marcar punto de inicio y punto de fin.
4. Elegir FPS (5, 10, 15, 20, 24, 30).
5. Elegir escala (original, 720p, 480p, 360p).
6. Pulsar "Generar GIF" → se renderiza y se añade a la biblioteca.

**Desde imágenes:**

1. Subir múltiples archivos de imagen (ImageUploader.tsx).
2. Reordenar en la lista de fotogramas (FrameList.tsx).
3. Ajustar duración de cada fotograma (por defecto 100 ms).
4. Añadir efectos de transición entre fotogramas (desvanecido, fundido).
5. Generar y exportar.

**Desde webcam:**

1. Conceder permisos de cámara.
2. Grabar una secuencia corta.
3. Recortar inicio/fin.
4. Generar GIF.

### 6.3 FOTOGRAMAS Y ANIMACIÓN

- **FrameList.tsx**: muestra miniaturas de cada fotograma, permite reordenar, eliminar, duplicar.
- **DrawingCanvas.tsx** (47 KB): lienzo de dibujo donde se pinta sobre el fotograma actual.
- **AnimationControls.tsx** (22 KB): controles de reproducción de la animación (play/pause, siguiente/anterior, FPS, loop).
- **GifPreview.tsx**: vista previa en tiempo real cuando se cambian parámetros.
- **GifLibrary.tsx** (17 KB): biblioteca de GIF generados, con acciones de guardar, descargar y compartir.
- **WebcamCapture.tsx**: captura desde cámara.

**Propiedades por fotograma:**

- Duración (ms).
- Retardo.
- Modo de mezcla con el fotograma anterior (reemplazar, aditivo, multiplicar).
- Filtro (ninguno, blanco/negro, sepia, desenfoque).

### 6.4 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Reproducir/Pausar vista previa | `Espacio` |
| Añadir fotograma | `Ctrl + N` |
| Eliminar fotograma | `Supr` |
| Duplicar fotograma | `Ctrl + D` |
| Mover fotograma arriba | `Ctrl + ↑` |
| Mover fotograma abajo | `Ctrl + ↓` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Guardar GIF | `Ctrl + S` |

---

## EDITOR DE TEXTO

### 7.1 CARACTERÍSTICAS PRINCIPALES

El **Editor de Texto** (app/edit-texto/page.tsx) permite edición de texto enriquecido:

- **Formato**: negrita, cursiva, subrayado, tachado, color de texto, color de fondo, resaltado.
- **Párrafos**: alineación, sangría, listas numeradas, viñetas, checklist.
- **Estilos**: H1-H6, cita, bloque de código (con resaltado de sintaxis), línea horizontal.
- **Enlaces**: insertar hipervínculos.
- **Imágenes**: insertar desde archivo, arrastrar, o URL.
- **Tablas**: crear y editar tablas con celdas.
- **Markdown**: soporte para editar en markdown con vista previa en vivo.
- **Historial**: deshacer/rehacer (ctrl+z / ctrl+shift+z).
- **Exportación**: PDF, HTML, Markdown, TXT, imprimir.
- **Guardado automático** cada 30 segundos (si está activado).

### 7.2 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Negrita | `Ctrl + B` |
| Cursiva | `Ctrl + I` |
| Subrayado | `Ctrl + U` |
| Tachado | `Ctrl + Shift + S` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Guardar | `Ctrl + S` |
| Buscar | `Ctrl + F` |
| Reemplazar | `Ctrl + H` |
| Insertar enlace | `Ctrl + K` |
| Insertar imagen | `Ctrl + Shift + I` |
| Lista numerada | `Ctrl + Shift + L` |
| Lista con viñetas | `Ctrl + L` |
| Checklist | `Ctrl + Shift + C` |
| Cita | `Ctrl + Shift + Q` |
| Bloque de código | `Ctrl + Shift + K` |
| Tabla | `Ctrl + T` |
| Línea horizontal | `Ctrl + Shift + H` |

---

## EDITOR DE DOCUMENTO

### 8.1 CARACTERÍSTICAS PRINCIPALES

El **Editor de Documento** (DocumentEditor.tsx, 103 KB) es el más avanzado para documentos:

- **Plantillas**: cartas, informes, currículums, actas, presentaciones, posts para redes sociales.
- **Colaboración**: edición en tiempo real con otros usuarios (escritorio a escritorio).
- **Comentarios**: añadir comentarios en el margen; resolverlos; notificaciones.
- **Control de cambios**: registrar cambios con aceptar/rechazar.
- **Estilos de párrafo**: Normal, Título 1-6, Cita, Código, Lista, Tabla.
- **Columnas**: 1, 2, 3 columnas.
- **Encabezados y pies**: número de página, fecha, autor, logotipo.
- **Tabla de contenido** automática.
- **Notas al pie**. 
- **Marcadores** (enlaces internos).
- **Revisión ortográfica** en tiempo real (integración con diccionario).
- **Exportar a PDF/DOCX/ODT/HTML/Markdown**. 
- **Imprimir** con márgenes configurables.

### 8.2 FORMATO Y PLANTILLAS

El DocumentEditor incluye un modal de configuración (EditorModal.tsx) donde se pueden elegir:

- Tamaño de papel (A4, A5, Carta, Legal, Oficio).
- Márgenes (Normal, Estrecho, Ancho, Personalizado).
- Orientación (Vertical/Horizontal).
- Color de fondo de la página.
- Fuente de documento (Arial, Times New Roman, Calibri, etc.).
- Tamaño de fuente base.
- Interlineado (Sencillo, 1.5, Doble, Personalizado).
- Numeración de páginas.

**Plantillas predefinidas**:

- Carta formal
- Informe trimestral
- Currículum vitae (cronológico / funcional)
- Acta de reunión
- Nota de prensa
- Presentación de propuesta
- Publicación de blog
- Publicación de Instagram/Facebook/Twitter (con dimensiones predefinidas)

### 8.3 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Negrita | `Ctrl + B` |
| Cursiva | `Ctrl + I` |
| Subrayado | `Ctrl + U` |
| Guardar | `Ctrl + S` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Buscar | `Ctrl + F` |
| Reemplazar | `Ctrl + H` |
| Insertar tabla | `Ctrl + T` |
| Insertar comentario | `Ctrl + Shift + M` |
| Aceptar cambio | `Ctrl + Shift + A` |
| Rechazar cambio | `Ctrl + Shift + R` |
| Insertar nota al pie | `Ctrl + Shift + F` |
| Insertar tabla de contenido | `Ctrl + Shift + T` |
| Abrir plantilla | `Ctrl + P` |
| Exportar PDF | `Ctrl + Shift + P` |
| Nivel de título 1 | `Ctrl + Alt + 1` ... H6 `Ctrl + Alt + 6` |
| Viñeta | `Ctrl + L` |
| Numérico | `Ctrl + Shift + L` |

---

## COMPONENTES UI COMPARTIDOS

La carpeta **components/ui/** contiene componentes reutilizables utilizados por todos los editores:

| Componente | Tamaño | Descripción |
|------------|--------|-------------|
| `button.tsx` | 2 KB | Botón con variantes (default, primario, secundario, ghost, outline). |
| `input.tsx` | 6 KB | Campo de texto con etiqueta y error. |
| `select.tsx` | 6 KB | Selector desplegable con opciones. |
| `modal.tsx` | 10 KB | Modal genérico con portal. |
| `tabs.tsx` | 2 KB | Pestañas. |
| `slider.tsx` | 2 KB | Deslizador con valor. |
| `switch.tsx` | 1 KB | Interruptor on/off. |
| `toast.tsx` / `toaster.tsx` | 5 KB | Notificaciones toast. |
| `tooltip.tsx` | 1 KB | Tooltip. |
| `alert.tsx` | 2 KB | Alerta contextual. |
| `card.tsx` | 2 KB | Tarjeta contenedor. |
| `avatar.tsx` | 1 KB | Avatar de usuario. |
| `dropdown-menu.tsx` | 10 KB | Menú desplegable. |
| `progress.tsx` | 1 KB | Barra de progreso. |
| `skeleton.tsx` | 0.3 KB | Placeholder de carga. |
| `textarea.tsx` | 1 KB | Área de texto. |
| `label.tsx` | 0.7 KB | Etiqueta. |
| `toggle.tsx` | 2 KB | Botón toggle. |
| `AudioVisualizer.tsx` | 30 KB | Forma de onda interactiva. |
| `AudioVisualizer2.tsx` | 22 KB | Espectro de frecuencias. |
| `file-uploader.tsx` | 7 KB | Zona de carga de archivos. |
| `EditorFileNameBar.tsx` | 2 KB | Barra de nombre de archivo actual. |

---

## PROCESAMIENTO POR IA

Zeus Media Studio integra IA en varias operaciones clave:

| Capacidad | API | Modelo |
|-----------|-----|--------|
| Chat general | `/api/chat` | OpenAI (o configurable vía API) |
| Asistencia de edición | `/api/chat` (contexto del editor) | GPT-4o / GPT-4o-mini |
| Generación de imágenes | `/api/modelos` + `flux-bridge.py` | Flux / Stable Diffusion |
| Eliminación de fondo | `/api/remove-bg` | rembg |
| Texto a voz | `/api/text-to-speech` | ElevenLabs / OpenAI TTS |
| Generación de voz | `/api/chat` + audio-generate | OpenAI audio |
| Crear animación (foto a video) | `/api/crear-animacion` | LTX-Video / AnimateDiff |
| Mejora de imagen | `/api/modelos` + workflows | GFPGAN / Real-ESRGAN |
| Crear presentación | `CreatePresentationModal.tsx` | IA genera diapositivas |
| Música procedural | `procedural-music.ts` | Algoritmos propios (Web Audio API) |
| MIDI | `teclado-midi.tsx` + instrumentSynth | Web MIDI / Synth |

**El chat de IA** (`FloatingChatButton.tsx`, 52 KB) es accesible desde cualquier editor con `Ctrl+Shift+C`. Puede:

- Responder preguntas sobre la herramienta.
- Ayudar a crear guiones/guiones gráficos.
- Explicar conceptos de edición.
- Generar descripciones de proyectos.
- Ayudar a mejorar el texto de superposiciones.
- Actuar sobre la imagen actual (mejorar, eliminar fondo, describir).
- Actuar sobre el audio (transcribir, describir).
- Actuar sobre el vídeo (analizar escena, sugerir ediciones).

---

## ATAJOS DE TECLADO GLOBALES

Disponibles en toda la aplicación:

| Acción | Atajo |
|--------|-------|
| Abrir chat de IA | `Ctrl + Shift + C` |
| Abrir panel de efectos | `Ctrl + Shift + E` |
| Abrir configuración | `Ctrl + ,` |
| Guardar proyecto | `Ctrl + S` |
| Abrir proyecto | `Ctrl + O` |
| Nuevo proyecto | `Ctrl + N` |
| Exportar | `Ctrl + E` |
| Cerrar editor | `Ctrl + W` |
| Ayuda | `F1` |
| Alternar tema claro/oscuro | `Ctrl + Shift + D` |
| Alternar barra lateral | `Ctrl + B` |
| Abrir selector de archivos | `Ctrl + Shift + O` |
| Minimizar ventana | `Ctrl + M` |
| Maximizar/restaurar | `Ctrl + Shift + M` |
| Cerrar ventana | `Ctrl + Shift + W` |

---

## APIS Y RUTAS INTERNAS

### APIs de Backend

| Ruta | Método | Descripción | Tamaño |
|------|--------|-------------|--------|
| `/api/audio-generate` | POST | Generación de audio/música mediante IA. | 10 KB |
| `/api/chat` | POST | Chat con IA contextual. | 21 KB |
| `/api/collections` | GET/POST/PUT/DELETE | Gestión de colecciones de medios. | 4 KB |
| `/api/crear-animacion` | POST | Crea animación foto-a-vídeo con IA. | 22 KB |
| `/api/docs` | * | Gestión de documentos (listar, crear, actualizar, exportar). | 74 KB |
| `/api/local` | * | Gestión de archivos locales (lectura/escritura). | - |
| `/api/modelos` | GET/POST | Lista y usa modelos de IA (imagen, vídeo, etc.). | 5 KB |
| `/api/remove-bg` | POST | Elimina fondo de una imagen. | 2 KB |
| `/api/ritmos-locales` | GET/POST | Ritmos de batería y patrones locales. | 2 KB |
| `/api/rutas` | GET/POST/PUT/DELETE | Gestión de rutas y proyectos. | 5 KB |
| `/api/rutas/upload` | POST | Sube archivos al servidor. | 2 KB |
| `/api/rutas/view` | GET | Vista / descarga de archivos. | 3 KB |
| `/api/text-to-speech` | POST | Convierte texto en audio (voz IA). | 6 KB |

### Librerías Internas (lib/)

| Archivo | Tamaño | Descripción |
|---------|--------|-------------|
| `procedural-music.ts` | 43 KB | Generador de música procedural (baterías, bajos, acordes, melodías). |
| `audio-export.ts` | 2 KB | Exportación de audio (WAV/MP3). |
| `audioEffectsChain.ts` | 7 KB | Cadena de efectos de audio. |
| `gif-utils.ts` | 22 KB | Utilidades de GIF (codificación/decodificación). |
| `slide-effects.ts` | 23 KB | Efectos de diapositivas para presentaciones. |
| `text-keyframes.ts` | 4 KB | Keyframes para texto animado. |
| `object-keyframes.ts` | 4 KB | Keyframes para objetos. |
| `selection-keyframes.ts` | 6 KB | Keyframes para selecciones. |
| `overlay-objects.ts` | 3 KB | Objetos superpuestos (rectángulos, círculos, líneas). |
| `image-utils.ts` | 3 KB | Utilidades de imagen (carga, redimensionado). |
| `llm.ts` | 8 KB | Función de llamada a modelos de lenguaje (OpenAI, etc.). |
| `collections.ts` | 6 KB | Lógica de colecciones. |
| `validations.ts` | 8 KB | Validaciones de archivos y datos. |
| `constants.ts` | 4 KB | Constantes del proyecto (formatos, tipos MIME, etc.). |
| `store.ts` | 2 KB | Store global de la aplicación (Zustand). |
| `clip-time.ts` | 4 KB | Utilidades de tiempo de clips. |
| `rhythmPatterns.ts` | 5 KB | Patrones de ritmo. |
| `rhythm-config-manager.ts` | 2 KB | Gestor de configuración de ritmos. |
| `instrumentSynth.ts` | 2 KB | Sintetizador de instrumentos (Web Audio). |
| `aiAnimationTransfer.ts` | 1 KB | Transferencia de animación IA. |
| `aiPresentationTransfer.ts` | 1 KB | Transferencia de presentación IA. |
| `electron-fs.ts` | 14 KB | Sistema de archivos de Electron (escritorio). |
| `pb-api.ts` | 2 KB | Cliente PocketBase. |
| `pocketbase.ts` | 1 KB | Instancia PocketBase. |

---

## SISTEMA DE RENDERIZADO POR NODOS

La carpeta `lib/video-render/` contiene el motor de renderizado por nodos, que procesa el proyecto como un grafo de nodos:

```
┌─────────────────────────────────────────────────────────────────┐
│                     SCENE BUILDER (scene-builder.ts)           │
│  Construye el árbol de nodos a partir de los clips y pistas    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ROOT NODE ──► VIDEO NODE ──► EFFECT NODE ──► TRANSITION NODE │
│       │              │                │               │        │
│       └──► TEXTO    └──► CROP       └──► SHARPEN   └──► ...   │
│       └──► IMAGEN                                             │
│       └──► OBJETO                                             │
│       └──► PAINT (dibujo)                                    │
│       └──► OVERLAY VIDEO                                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                     FRAME PROVIDER (frame-provider.ts)         │
│  Proporciona fotogramas de video/imagen a los nodos           │
├─────────────────────────────────────────────────────────────────┤
│                  COMPOSE (audio-mixer, draw-text, etc.)        │
│  Compone la salida final con audio y subtítulos               │
├─────────────────────────────────────────────────────────────────┤
│                 SCENE EXPORTER (scene-exporter.ts)            │
│  Exporta el grafo completo a un archivo de proyecto JSON      │
└─────────────────────────────────────────────────────────────────┘
```

### Nodos disponibles

| Nodo | Archivo | Función |
|------|---------|---------|
| **BaseNode** | base-node.ts | Clase base para todos los nodos (entradas, salidas, propiedades). |
| **RootNode** | root-node.ts | Nodo raíz que define el tamaño del canvas. |
| **VideoNode** | video-node.ts | Representa un clip de vídeo (fuente, trim, velocidad, transformación). |
| **ImageNode** | image-node.ts | Representa una imagen (fuente, transformación, opacidad). |
| **TextNode** | text-node.ts | Representa texto (contenido, fuente, estilo). |
| **ObjectNode** | object-node.ts | Representa un objeto geométrico (rectángulo, círculo, línea). |
| **OverlayVideoNode** | overlay-video-node.ts | Vídeo superpuesto (PiP). |
| **PaintNode** | paint-node.ts | Capa de dibujo (trazos, pinceles). |
| **CropNode** | crop-node.ts | Recorte de un nodo. |
| **EffectNode** | effect-node.ts | Aplica efectos visuales (brillo, contraste, desenfoque). |
| **SharpenNode** | sharpen-node.ts | Enfoca la imagen (usa librería de sharpen). |
| **TransitionNode** | transition-node.ts | Aplica una transición entre dos nodos. |

### Video Cache

- `video-cache/service.ts` (8 KB): servicio de caché de vídeo (almacena segmentos ya codificados para una reproducción fluida).
- `video-cache/url-blob-cache.ts` (2 KB): caché de blobs de URL para medios importados.

---

## ELECTRON Y ESCRITORIO

Zeus Media Studio funciona también como aplicación de escritorio. La carpeta `electron/` contiene:

- **main.js** (58 KB): proceso principal de Electron. Gestiona:
  - Creación de ventanas.
  - Menús nativos.
  - Integración con sistema de archivos (fs).
  - Persistencia de proyectos en disco.
  - Gestión de preferencias.
  - Atajos globales de teclado.
  - Comunicación con la interfaz mediante IPC (canales `ipcMain`/`ipcRenderer`).
  - Control de ventanas (`minimize`, `maximize`, `close`, `toggle:devtools`, `reload`).
  - Detección de plataforma (Windows, macOS, Linux).
  - Manejo de arrastrar y soltar archivos desde el explorador.
  - Persistencia de posición y tamaño de ventana.

- **preload.js** (5 KB): API segura expuesta al renderer (`window.electronAPI`) que permite:
  - `guardarArchivo`, `abrirArchivo`, `guardarComo`
  - `nuevoProyecto`, `abrirProyecto`, `exportar`
  - `mostrarDialogo`, `seleccionarCarpeta`
  - `ventanas` (minimizar, maximizar, cerrar)
  - `getVersion`, `getPlatform`

---

## PERSISTENCIA Y ALMACENAMIENTO

Zeus Media Studio puede guardar proyectos y datos mediante:

1. **Sistema de archivos local** (Electron FS): en escritorio, los proyectos se guardan en el disco duro como archivos `.json` o `.zeusproj` (proyecto completo con referencias a los archivos multimedia).
2. **PocketBase** (base de datos embebida): se inicia con `pocket-base/pocketbase.exe`, que permite:
   - Autenticación de usuarios (correo/contraseña).
   - Colecciones de medios.
   - Backup automático (se incluye `pb_backup_acme_20260317224500.zip`).
   - Almacenamiento de documentos y ajustes.
3. **LocalStorage / Zustand persist**: para preferencias de UI, últimos proyectos, configuraciones de editores.
4. **Servidor local HTTP**: `Servidor_Local/` incluye un servidor FastAPI con endpoints para generación de imágenes.

### Archivos de almacenamiento destacados

- `types/rhythm-config.json` - configuración de ritmos.
- `docs/video_ltx2_3_i2v (1).json` y `video_ltx2_3_i2v.json` - flujos de trabajo para la API de creación de animación (LTX-Video / ComfyUI).
- `workflows/enhance_api.json` y `enhance_upscale_only_api.json` - flujos de mejora de imagen.
- `zeus-uploads/` - archivos subidos por el usuario para procesar.
- `public/uploads/` - archivos públicos.

---

## CONSEJOS DE USO AVANZADO

### Editor de Video

1. **Atajo de división rápida**: mientras se reproduce, pulsa `Ctrl+B` para cortar el clip automáticamente en la posición del cabezal, sin detener la reproducción.
2. **Fundido en audio**: arrastra la esquina superior izquierda/derecha del clip de audio para crear fade in/out antes de aplicar efectos.
3. **Keyframes de movimiento**: crea el primer keyframe (posición inicial), mueve el cabezal, mueve el objeto en el canvas y añade el segundo keyframe. El editor interporlará automáticamente.
4. **Exportación rápida**: usa `Ctrl+E` y elige el formato MP4. Se puede exportar en segundo plano mientras se sigue editando.
5. **Copiar efectos**: selecciona un clip con efectos, pulsa `Ctrl+C`, selecciona otro clip, pulsa `Ctrl+V`. Los efectos se copian.
6. **Para proyectos largos**: activa el zoom out (`Ctrl -`) para ver toda la línea de tiempo de un vistazo; luego usa las teclas `Home`/`End` para ir al inicio/fin.

### Editor de Audio

1. **Ecualizador**: para un corte de voz claro, reduce las frecuencias bajas (60-200 Hz) y realza ligeramente 1-4 kHz.
2. **Bucle**: selecciona una región y pulsa `L` para reproducir en bucle mientras ajustas efectos.
3. **Grabación**: activa el metrónomo con `K` para grabar a tiempo.

### Editor de Imagen

1. **Eliminar fondo**: usa la herramienta IA de eliminar fondo (`/api/remove-bg`) para aislar un sujeto y luego colócalo sobre otro fondo.
2. **Modos de fusión**: usa el modo "Multiplicar" para sombras y el modo "Pantalla" para brillos y reflejos.
3. **Máscara de capa**: usa pincel negro para ocultar partes de una capa sin destruir los píxeles; el blanco las vuelve a mostrar.

### Editor de Documento

1. **Plantilla de acta**: al abrir un nuevo documento, elige la plantilla "Acta de reunión" para obtener la estructura correcta.
2. **Control de cambios**: antes de enviar un documento a revisión, activa el control de cambios para que los revisores puedan sugerir ediciones.

---

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

### 9.2 HERRAMIENTAS Y ELEMENTOS

**Modos de herramienta:**

| Herramienta | Descripción |
|-------------|-------------|
| **Seleccionar** | Selecciona y mueve elementos en el canvas. |
| **Rectángulo** | Dibuja rectángulos con relleno y borde configurables. |
| **Círculo** | Dibuja círculos/elipses. |
| **Línea** | Dibuja líneas (usa el ancho y alto como longitud). |
| **Texto** | Crea cuadros de texto con tipografía configurable. |
| **Imagen** | Inserta imágenes desde archivos locales o por URL. |

**Tipos de elementos admitidos:**
- `rect`: rectángulo con `fillColor`, `fillOpacity`, `strokeColor`, `strokeWidth`.
- `circle`: círculo con mismas propiedades de relleno y borde.
- `line`: línea definida por width/height (como vector).
- `text`: contenido textual con familia de fuente, tamaño, color, negrita, cursiva, subrayado, borde de texto y sombra.
- `image`: imagen con `src`, opacidad, bordes redondeados (`imageBorderRadius`), grosor de borde y color.

### 9.3 PROPIEDADES Y ESTILOS

Al seleccionar un elemento, el panel derecho muestra sus propiedades editables:

**Comunes:**
- Posición X, Y.
- Ancho, Alto.
- Rotación (0–360°).
- Opacidad (0–1).
- Relleno: color y opacidad.
- Borde: color y grosor.

**Texto:**
- Fuente (lista + Google Fonts).
- Tamaño de fuente.
- Color de texto.
- Negrita, Cursiva, Subrayado.
- Borde de texto: color y grosor (`textStrokeColor`, `textStrokeWidth`).
- Sombra de texto: color, desplazamiento X/Y, desenfoque.

**Imagen:**
- Transparencia.
- Radio de borde (`imageBorderRadius`).
- Grosor de borde (`imageBorderWidth`).
- Color de borde (`imageBorderColor`).

**Animación del elemento:**
- Tipo: aparición (fade in), desaparición (fade out), entrada izquierda/derecha/inferior/superior, rebote, pulso, sacudida, zoom in, volteo horizontal.
- Duración en segundos.
- Retraso en segundos.

### 9.4 EFECTOS DE CANVAS

El canvas puede tener un **fondo** y un **efecto especial**:

**Fondo:**
- Color sólido.
- Degradado lineal (color inicial, final, ángulo).

**Efectos disponibles:**

| Efecto | Descripción |
|--------|-------------|
| **Ninguno** | Sin efecto especial. |
| **Partículas** | Partículas animadas flotando por el canvas, con forma circular/cuadrado/triángulo, tamaño, velocidad, color e imagen personalizada. |
| **Estrellas** | Estrellas animadas con tamaño, velocidad, cantidad y color configurables. |
| **Degradado animado** | Fondo con degradado en movimiento continuo; se puede configurar la velocidad. |
| **Iluminación (spotlight)** | Efecto de linterna que sigue el cursor. Ajustes: tamaño del halo, intensidad y color de la luz. |

### 9.5 FUENTES Y TIPOGRAFÍA

- El editor carga **Google Fonts** automáticamente según las fuentes utilizadas en los textos del canvas.
- Se incluye un **modal de búsqueda de fuentes** (`GoogleFontsModal.tsx`) con acceso a la API de Google Fonts.
- Las fuentes seleccionadas se agregan al `<head>` del HTML exportado para que se visualicen correctamente sin dependencias locales.
- También se soportan fuentes del sistema: Arial, Georgia, Courier New, Times New Roman, Verdana.

### 9.6 EXPORTACIÓN Y PROYECTOS

**Exportar ZIP:**
- Genera un `index.html` autocontenido con estilos inline, scripts y referencias a recursos locales.
- Las imágenes del canvas se guardan en la raíz del ZIP como `${elementId}.${ext}`.
- La imagen personalizada de partículas también se guarda en la raíz.
- El efecto de iluminación incluye un script inline para comportamiento interactivo en el navegador.

**Guardar proyecto (`.zeus`):**
- Almacena el estado completo del editor: elementos, configuración de canvas, efectos, fuentes custom e imágenes en base64.
- Se guarda localmente en la carpeta de proyectos configurada.

**Abrir proyecto:**
- Restaura todos los elementos, imágenes, colores, efectos y configuraciones.
- Si alguna imagen no se encuentra, se limpia el `src` para no dejar referencias rotas.

### 9.7 CHAT IA Y CÓDIGO

El panel inferior ofrece dos modos:
- **Código HTML**: vista/edición directa del HTML generado.
- **Chat IA**: asistente para consultar sobre el diseño o pedir mejoras. El contexto enviado incluye el código HTML actual.

### 9.8 ATAJOS DE TECLADO

| Acción | Atajo |
|--------|-------|
| Guardar proyecto | `Ctrl + S` |
| Abrir proyecto | `Ctrl + O` |
| Exportar ZIP | `Ctrl + E` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Copiar elemento | `Ctrl + C` |
| Pegar elemento | `Ctrl + V` |
| Eliminar elemento | `Supr` |
| Seleccionar herramienta Seleccionar | `V` |
| Seleccionar herramienta Rectángulo | `R` |
| Seleccionar herramienta Círculo | `O` |
| Seleccionar herramienta Línea | `L` |
| Seleccionar herramienta Texto | `T` |
| Seleccionar herramienta Imagen | `I` |

---

## EDITOR 3D

## Modos de Edición

### 1. Modo Vistas (Views)

El modo principal para crear figuras 3D mediante vistas ortogonales.

**Variables:**
- `views`: Vistas ortogonales (frente, costado, superior)
- `meshStyle`: Estilo de malla ('fusionada', 'suave', 'voxeles')
- `resolution`: Resolución de las vistas (default: 32)
- `editingView`: Vista actualmente siendo editada
- `editingLathe`: Estado de edición de torno

**Componentes:**
- `DrawingCanvas`: Para dibujar las vistas ortogonales
- `Viewer3D`: Para visualizar el modelo 3D resultante

**Estilos de Malla:**
- **Fusionada**: Las caras planas se fusionan en rectángulos grandes
- **Suave**: Curvas y diagonales lisas, sin escalones
- **Vóxeles**: Rasterizado en rejilla con escalones visibles

### 2. Modo Texto a 3D

Convierte texto en modelos tridimensionales con varias opciones de renderizado.

**Variables:**
- `text`: Texto a convertir
- `fontCss`: Fuente CSS seleccionada
- `textDepth`: Profundidad del texto (1-48)
- `hollowText`: Letras huecas (solo contorno)
- `greedyMesh`: Malla optimizada sin divisiones internas
- `textRes`: Resolución del texto (12-144)
- `textOpacity`: Opacidad del costado (solo en modo suave)
- `textMode`: Modo de salida ('voxel', 'plane', 'smooth')

**Modos de Salida de Texto:**
- **Vóxeles 3D**: Rasteriza el texto a una rejilla y extruye cada celda
- **Suave**: Extruye el contorno real de la letra con curvas lisas
- **Vista plana**: Copia el color exacto del texto tal como se ve en pantalla

**Opciones de Textura:**
- `texture`: Imagen aplicada como textura
- `textureProjection`: Proyección ('cylindrical', 'planar', 'spherical')
- `textureFinish`: Acabado ('glossy', 'semi-matte', 'matte')
- `textureRelief`: Relieve de la textura (0-100%)

### 3. Modo Torno (Lathe)

Crea objetos 3D simétricos rotando un perfil alrededor del eje vertical.

**Variables:**
- `latheProfile`: Perfil del torno (Polygon)
- `latheTexture`: Textura aplicada al objeto
- `latheOpacity`: Opacidad del torno (0-1)
- `latheSegments`: Segmentos de rotación (8-128)
- `latheClamp`: Cerrar extremos con tapas
- `latheFigureColor`: Color de la figura

**Componentes:**
- `DrawingCanvas`: Para dibujar el perfil del torno
- `Viewer3D`: Para visualizar el modelo 3D resultante

**Opciones de Malla:**
- **Suave**: Contorno real con curvas lisas
- **Fusionada**: Caras planas fusionadas
- **Vóxeles**: Rasterizado en rejilla

---

## Gestión de Fuentes

### Fuentes de Google Fonts

```typescript
const FONT_OPTIONS: FontOption[] = [
  // Lista de fuentes preconfiguradas
];
```

**Funciones:**
- `importFont()`: Importa una fuente desde Google Fonts por nombre
- `openGoogleFonts()`: Abre el catálogo de Google Fonts en nueva pestaña
- `ensureStylesheet()`: Asegura que el CSS de la fuente esté cargado

### Fuentes Locales

```typescript
// Soporta: .ttf, .otf, .woff, .woff2
// Funciones:
// - openLocalFontPicker(): Abre selector de archivos locales
// - handleLocalFontFile(): Carga fuente desde archivo local
// - localFontInputRef: Referencia al input de archivo oculto
```

**Flujo de carga:**
1. Usuario selecciona archivo de fuente
2. Se convierte a base64
3. Se carga en el sistema de fuentes del navegador
4. Se añade a la lista de fuentes disponibles

---

## Gestión de Texturas

### Carga de Texturas

```typescript
// Soporta: JPG, PNG, WebP, SVG
// Funciones:
// - openTexturePicker(): Abre selector de archivos de imagen
// - handleTextureFile(): Carga imagen como textura
// - textureInputRef: Referencia al input de archivo oculto
```

**Propiedades de Textura:**
- `textureFileName`: Nombre del archivo
- `texture`: URL base64 de la imagen
- `textureProjection`: Cómo se proyecta la textura en el modelo
- `textureFinish`: Acabado de la textura
- `textureRelief`: Cuánto se eleva la textura del modelo

---

## Persistencia de Datos

### Guardado

```typescript
// Funciones:
// - saveObject(): Guarda el objeto actual en .zeus
// - saveModalOpen: Modal de guardado
// - objectName: Nombre del objeto
// - savingObject: Estado de guardado
// - saveMsg: Mensaje de resultado del guardado
```

### Carga

```typescript
// Funciones:
// - loadObject(): Carga objeto desde archivo .zeus
// - loadModalOpen: Modal de carga
// - savedObjects: Lista de objetos guardados
// - loadingObjects: Estado de carga
// - loadMsg: Mensaje de resultado de la carga
```

**Formato de archivo .zeus:**
```json
{
  "mode": "views" | "text" | "lathe",
  "views": { "front": [...], "side": [...], "top": [...] },
  "editedVertices": [...],
  "text": "texto",
  "fontCss": "font-family",
  "textDepth": 6,
  "hollowText": false,
  "greedyMesh": true,
  "textRes": 24,
  "textOpacity": 1,
  "textMode": "voxel",
  "useFontColor": true,
  "baseColor": "#e8e8e8",
  "figureColor": "#121ca7",
  "texture": "data:image/png;base64,...",
  "textureProjection": "cylindrical",
  "textureFinish": "semi-matte",
  "textureRelief": 0.25,
  "latheProfile": [...],
  "latheTexture": null,
  "latheOpacity": 1,
  "latheSegments": 32,
  "latheClamp": true,
  "latheFigureColor": "#121ca7",
  "resolution": 32,
  "meshStyle": "suave"
}
```

---

## Historial

```typescript
// Historial de cambios con undo/redo
// - history: Array de estados anteriores
// - historyIndex: Índice del estado actual en el historial
// - isUndoRedo: Estado de operación de historial
// - undo(): Deshacer último cambio
// - redo(): Rehacer cambio deshacer
```

**Lógica del historial:**
- Se guarda automáticamente cada 500ms
- Máximo 50 estados en el historial
- Detección de cambios idénticos para evitar duplicados
- Incluye todas las propiedades del objeto actual

---

## Componentes Internos

### EditorCanvasComponent

```typescript
const EditorCanvasComponent = EditorCanvas as unknown as ComponentType<any>;
```

Componente reutilizable para edición de vistas y perfiles de torno.

### Viewer3D

```typescript
import Viewer3D from '@/components/viewer-3d';
```

Visualizador 3D que muestra el modelo resultante con controles de transformación.

### DrawingCanvas

```typescript
import DrawingCanvas from '@/components/drawing-canvas';
```

Componente para dibujar vistas ortogonales y perfiles de torno.

---

## Constantes y Utilidades

```typescript
const DEFAULT_LATHE_PROFILE: Polygon = [
  { x: 0.3, y: -0.6 },
  { x: 0.8, y: -0.6 },
  { x: 0.8, y: 0.6 },
  { x: 0.3, y: 0.6 },
];

const DEFAULT_VIEWS: Views = {
  front: [...],
  side: [...],
  top: [...],
};

const HIGH_FIDELITY_RES = 64;
```

---

## Características Principales

1. **Creación 3D Multi-modo**: Vistas, texto y torno
2. **Múltiples Estilos de Malla**: Fusionada, suave, vóxeles
3. **Gestión de Fuentes**: Google Fonts y locales
4. **Texturas con Proyección**: Varias proyecciones y acabados
5. **Historial Completo**: Undo/redo con detección de cambios
6. **Persistencia**: Guardado y carga de objetos .zeus
7. **Edición de Vértices**: Modificación directa del modelo
8. **Transformación 3D**: Rotación, escala, posición
9. **Exportación a STL**: Preparación para impresión 3D
10. **Interfaz en Español**: Todo el UI en español

---

## Notas Técnicas

- Usa React 18 con hooks
- Componentes funcionales con `useClient`
- Librerías: Three.js para renderizado 3D, React Three Fiber
- Electron para funcionalidad de sistema de archivos
- CSS-in-JS para estilos
- Lucide React para iconos
- Tailwind CSS para UI

## CONCLUSIÓN

Zeus Media Studio es una suite completa de edición multimedia que cubre vídeo, audio, imagen, GIF, texto/documentos y HTML. El **Editor de Video** destaca por su línea de tiempo multipista profesional, sistema de nodos de renderizado, keyframes, transiciones, efectos y exportación de alta calidad. Todo el conjunto se complementa con asistentes de IA, sincronización con PocketBase, y un empaquetado de escritorio con Electron.

---

*Documentación generada el 31 de julio de 2026 para Zeus Media Studio v0.1.0*
