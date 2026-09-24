# Zeus Media Studio - Documentación de Editores Multimedia

Zeus Media Studio es una aplicación de escritorio creada con Zeus IA que ofrece un conjunto completo de editores multimedia para crear, editar y exportar contenido. A continuación se describen las funcionalidades de cada editor multimedia.

## Índice

1. [Editor de Audio](#editor-de-audio)
2. [Editor de Video](#editor-de-video)
3. [Editor de Imagen](#editor-de-imagen)
4. [Editor de GIF](#editor-de-gif)
5. [Editor de Texto](#editor-de-texto)
6. [Editor de Documento](#editor-de-documento)
7. [Atajos de Teclado Globales](#atajos-de-teclado-globales)
8. [Integraciones y APIs](#integraciones-y-apis)

---

## Editor de Audio

### Descripción
El editor de audio permite grabar, importar, editar y mezclar pistas de audio. Soporta múltiples formatos, efectos en tiempo real y exportación de alta calidad.

### Características principales

- **Grabación de audio**: Captura audio desde micrófono o entrada de línea.
- **Importación de archivos**: Soporta formatos MP3, WAV, OGG, FLAC, AAC y M4A.
- **Línea de tiempo multipista**: Organiza y mezcla múltiples pistas de audio.
- **Efectos de audio**: Ecualizador, compresor, reverberación, delay, chorus, flanger, distorsión y más.
- **Editor de formas de onda**: Visualización y edición precisa de formas de onda.
- **Corte y empalme**: Herramientas de tijera, selección y corte.
- **Ajuste de volumen y fade**: Controles de volumen por pista y curvas de fade.
- **Conversión de formato**: Exporta a cualquier formato soportado.
- **Análisis espectral**: Visualización de espectro de frecuencias.

### Componentes relacionados

- `components/editor/AudioEditor.tsx`: Componente principal del editor de audio.
- `components/ui/AudioVisualizer.tsx`: Visualizador de formas de onda.
- `components/ui/AudioVisualizer2.tsx`: Visualizador de espectro.
- `components/nexus-eq-standalone.tsx`: Ecualizador gráfico.
- `components/teclado-midi.tsx`: Teclado MIDI virtual.

### Atajos de teclado

| Acción | Atajo |
|--------|-------|
| Reproducir/Pausar | `Espacio` |
| Detener | `Shift + Espacio` |
| Cortar selección | `Ctrl + X` |
| Copiar selección | `Ctrl + C` |
| Pegar | `Ctrl + V` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Zoom in | `Ctrl + +` |
| Zoom out | `Ctrl + -` |
| Silenciar pista | `M` |
| Solo pista | `S` |

### API relacionada

- `app/api/ritmos-locales/route.ts`: Gestión de ritmos y patrones locales.
- `app/api/text-to-speech/route.ts`: Conversión de texto a voz.

### Ejemplo de uso

```typescript
// Ejemplo de importación de un archivo de audio
import { AudioEditor } from '@/components/editor/AudioEditor';

export default function EditAudioPage() {
  return (
    <div className="flex h-screen">
      <AudioEditor />
    </div>
  );
}
```

---

## Editor de Video

### Descripción
El editor de video permite importar, editar y exportar videos con soporte para múltiples pistas, efectos, transiciones y texto superpuesto.

### Características principales

- **Importación de video**: Soporta formatos MP4, AVI, MOV, MKV, WEBM, FLV y más.
- **Línea de tiempo multipista**: Video, audio, texto y efectos en capas.
- **Corte y edición**: Herramientas de tijera, división, eliminación y movimiento de clips.
- **Transiciones**: Fundido, barrido, deslizamiento, zoom y más.
- **Efectos visuales**: Brillo, contraste, saturación, desenfoque, viñeta, corrección de color.
- **Superposición de texto**: Títulos, subtítulos, créditos con estilos personalizables.
- **Capas de imagen**: Superposición de imágenes con transparencia.
- **Velocidad variable**: Cámara lenta y rápida.
- **Estabilización**: Corrección de movimiento.
- **Exportación**: Resoluciones desde 360p hasta 4K, perfiles predefinidos.

### Componentes relacionados

- `components/editor/VideoEditor.tsx`: Componente principal del editor de video.
- `components/editor/Timeline.tsx`: Línea de tiempo principal.
- `components/editor/TimelinePlayer.tsx`: Reproductor de la línea de tiempo.
- `components/editor/TimelinePreview.tsx`: Vista previa de la línea de tiempo.
- `components/editor/TransitionEditor.tsx`: Editor de transiciones.
- `components/editor/VideoObjectEditor.tsx`: Editor de objetos de video.
- `components/editor/VideoTextEditor.tsx`: Editor de texto superpuesto.
- `components/editor/EffectsOverlay.tsx`: Superposición de efectos.
- `components/editor/ObjectOverlay.tsx`: Superposición de objetos.
- `components/editor/TextOverlay.tsx`: Superposición de texto.

### Atajos de teclado

| Acción | Atajo |
|--------|-------|
| Reproducir/Pausar | `Espacio` |
| Detener | `Shift + Espacio` |
| Cortar clip | `Ctrl + X` |
| Copiar clip | `Ctrl + C` |
| Pegar clip | `Ctrl + V` |
| Dividir clip | `S` |
| Eliminar clip | `Supr` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Zoom in | `Ctrl + +` |
| Zoom out | `Ctrl + -` |
| Ajustar a cabezal | `Q` |
| Marcador | `M` |

### API relacionada

- `app/api/crear-animacion/route.ts`: Generación de animaciones.
- `app/api/rutas/route.ts`: Gestión de rutas de archivos.
- `app/api/rutas/upload/route.ts`: Subida de archivos.
- `app/api/rutas/view/route.ts`: Visualización de archivos.

### Ejemplo de uso

```typescript
// Ejemplo de importación del editor de video
import { VideoEditor } from '@/components/editor/VideoEditor';

export default function EditVideoPage() {
  return (
    <div className="flex h-screen">
      <VideoEditor />
    </div>
  );
}
```

---

## Editor de Imagen

### Descripción
El editor de imagen permite importar, editar y exportar imágenes con herramientas de ajuste, filtros, capas y efectos.

### Características principales

- **Importación de imágenes**: Soporta formatos JPEG, PNG, WebP, BMP, TIFF, SVG y más.
- **Ajustes básicos**: Brillo, contraste, saturación, exposición, temperatura, tinte.
- **Filtros**: Blanco y negro, sepia, vintage, desenfoque, nitidez, pixelado.
- **Herramientas de dibujo**: Pincel, lápiz, borrador, relleno.
- **Capas**: Múltiples capas con modos de fusión.
- **Texto**: Añadir texto con fuentes personalizables.
- **Formas**: Rectángulos, círculos, líneas, flechas.
- **Recorte**: Herramienta de recorte libre y proporciones predefinidas.
- **Redimensionamiento**: Cambio de dimensiones y resolución.
- **Rotación y volteo**: Rotar, voltear horizontal y vertical.
- **Eliminación de fondo**: Eliminación automática de fondo con IA.
- **Exportación**: Exporta a cualquier formato soportado.

### Componentes relacionados

- `components/editor/ImageEditor.tsx`: Componente principal del editor de imagen.
- `components/editor/FontEditor.tsx`: Editor de fuentes.
- `components/editor/ScreenshotCapture.tsx`: Captura de pantalla.

### Atajos de teclado

| Acción | Atajo |
|--------|-------|
| Seleccionar herramienta pincel | `B` |
| Seleccionar herramienta borrador | `E` |
| Seleccionar herramienta texto | `T` |
| Seleccionar herramienta recorte | `C` |
| Deshacer | `Ctrl + Z` |
| Rehacer | `Ctrl + Shift + Z` |
| Guardar | `Ctrl + S` |
| Zoom in | `Ctrl + +` |
| Zoom out | `Ctrl + -` |
| Ajustar a pantalla | `Ctrl + 0` |

### API relacionada

- `app/api/remove-bg/route.ts`: Eliminación de fondo.
- `app/api/modelos/route.ts`: Modelos de IA para edición.

### Ejemplo de uso

```typescript
// Ejemplo de importación del editor de imagen
import { ImageEditor } from '@/components/editor/ImageEditor';

export default function EditImagenPage() {
  return (
    <div className="flex h-screen">
      <ImageEditor />
    </div>
  );
}
```

---

## Editor de GIF

### Descripción
El editor de GIF permite crear y editar animaciones GIF a partir de videos, imágenes o capturas de pantalla, con herramientas de dibujo y efectos.

### Características principales

- **Creación desde video**: Importa un video y selecciona el segmento a convertir a GIF.
- **Creación desde imágenes**: Combina múltiples imágenes en una animación.
- **Captura de webcam**: Graba desde la cámara para crear GIFs animados.
- **Dibujo sobre fotogramas**: Herramientas de dibujo para añadir elementos a cada fotograma.
- **Editor de fotogramas**: Añade, elimina, duplica y reordena fotogramas.
- **Ajuste de velocidad**: Control de FPS (fotogramas por segundo).
- **Efectos**: Transiciones entre fotogramas, filtros.
- **Redimensionamiento**: Cambia el tamaño del GIF.
- **Optimización**: Reduce el tamaño del archivo sin perder calidad.
- **Exportación**: Exporta como GIF animado o secuencia de imágenes.

### Componentes relacionados

- `components/gif-maker/AnimationControls.tsx`: Controles de animación.
- `components/gif-maker/DrawingCanvas.tsx`: Lienzo de dibujo.
- `components/gif-maker/FrameList.tsx`: Lista de fotogramas.
- `components/gif-maker/GifLibrary.tsx`: Biblioteca de GIFs.
- `components/gif-maker/GifPreview.tsx`: Vista previa del GIF.
- `components/gif-maker/ImageUploader.tsx`: Subida de imágenes.
- `components/gif-maker/WebcamCapture.tsx`: Captura de webcam.

### Atajos de teclado

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

### API relacionada

- `app/api/crear-animacion/route.ts`: Creación de animaciones.

### Ejemplo de uso

```typescript
// Ejemplo de importación del editor de GIF
import { AnimationControls } from '@/components/gif-maker/AnimationControls';
import { GifPreview } from '@/components/gif-maker/GifPreview';

export default function EditGifPage() {
  return (
    <div className="flex h-screen">
      <AnimationControls />
      <GifPreview />
    </div>
  );
}
```

---

## Editor de Texto

### Descripción
El editor de texto permite crear y editar documentos de texto con formato enriquecido, soporte para Markdown, y herramientas de edición avanzadas.

### Características principales

- **Edición de texto enriquecido**: Negrita, cursiva, subrayado, tachado, color, resaltado.
- **Soporte Markdown**: Edición en vivo con vista previa.
- **Listas**: Ordenadas, desordenadas, checklist.
- **Tablas**: Creación y edición de tablas.
- **Imágenes**: Inserción de imágenes desde archivo o URL.
- **Enlaces**: Hipervínculos.
- **Encabezados**: H1 a H6.
- **Citas**: Bloques de cita.
- **Código**: Bloques de código con resaltado de sintaxis.
- **Historial de cambios**: Deshacer/rehacer ilimitado.
- **Exportación**: Exporta a PDF, HTML, Markdown, TXT.
- **Impresión**: Impresión directa.

### Componentes relacionados

- `app/edit-texto/page.tsx`: Página del editor de texto.

### Atajos de teclado

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
| Lista ordenada | `Ctrl + Shift + L` |
| Lista desordenada | `Ctrl + L` |

### API relacionada

- `app/api/chat/route.ts`: Chat con IA para asistencia en escritura.
- `app/api/collections/route.ts`: Gestión de colecciones de documentos.

### Ejemplo de uso

```typescript
// Ejemplo de importación del editor de texto
// El editor de texto se encuentra en la página app/edit-texto/page.tsx

export default function EditTextoPage() {
  return (
    <div className="flex h-screen">
      {/* Editor de texto integrado */}
    </div>
  );
}
```

---

## Editor de Documento

### Descripción
El editor de documento es una versión avanzada del editor de texto que incluye soporte para plantillas, colaboración en tiempo real y formato de documentos complejos.

### Características principales

- **Plantillas**: Plantillas predefinidas para cartas, informes, currículums, etc.
- **Colaboración en tiempo real**: Edición simultánea con otros usuarios.
- **Comentarios y revisiones**: Añadir comentarios, sugerencias y control de cambios.
- **Formato avanzado**: Estilos de párrafo, sangría, espaciado, columnas.
- **Encabezados y pies de página**: Números de página, fecha, logotipo.
- **Tablas de contenido**: Generación automática.
- **Notas al pie**: Inserción de notas.
- **Hipervínculos**: Enlaces internos y externos.
- **Imágenes y gráficos**: Inserción y ajuste.
- **Exportación**: Exporta a PDF, DOCX, ODT, HTML.

### Componentes relacionados

- `components/editor/DocumentEditor.tsx`: Componente principal del editor de documento.
- `components/editor/EditorModal.tsx`: Modal de configuración del editor.
- `components/ui/EditorFileNameBar.tsx`: Barra de nombre de archivo.

### Atajos de teclado

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

### API relacionada

- `app/api/docs/route.ts`: Gestión de documentos.
- `app/api/collections/route.ts`: Gestión de colecciones.

### Ejemplo de uso

```typescript
// Ejemplo de importación del editor de documento
import { DocumentEditor } from '@/components/editor/DocumentEditor';

export default function DocumentPage() {
  return (
    <div className="flex h-screen">
      <DocumentEditor />
    </div>
  );
}
```

---

## Atajos de Teclado Globales

Los siguientes atajos de teclado están disponibles en toda la aplicación:

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

---

## Integraciones y APIs

### APIs internas

- **`/api/chat`**: Chat con IA para asistencia en edición.
- **`/api/collections`**: Gestión de colecciones de medios.
- **`/api/crear-animacion`**: Creación de animaciones.
- **`/api/docs`**: Gestión de documentos.
- **`/api/local`**: Gestión de archivos locales.
- **`/api/modelos`**: Modelos de IA.
- **`/api/remove-bg`**: Eliminación de fondo.
- **`/api/ritmos-locales`**: Ritmos y patrones de audio.
- **`/api/rutas`**: Gestión de rutas de archivos.
- **`/api/text-to-speech`**: Conversión de texto a voz.

### Componentes de interfaz

- **`components/ui/`**: Componentes UI reutilizables (botones, tarjetas, menús, etc.).
- **`components/layout/`**: Componentes de layout (header, sidebar, footer).
- **`components/editor/`**: Componentes específicos de los editores.
- **`components/gif-maker/`**: Componentes del editor de GIF.

### Contextos y hooks

- **`context/`**: Contextos de React para estado global.
- **`hooks/`**: Hooks personalizados.
- **`lib/`**: Librerías utilitarias.
- **`lib/sdk/`**: SDK para integraciones.
- **`lib/store/`**: Estado global con Zustand.

### Temas y estilos

- **`components/theme-provider.tsx`**: Proveedor de temas claro/oscuro.
- **`app/globals.css`**: Estilos globales.

---

*Documentación generada para Zeus Media Studio - Versión 1.0*