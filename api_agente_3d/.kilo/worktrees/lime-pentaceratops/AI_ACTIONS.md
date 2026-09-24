# Inventario de acciones del chat IA — Zeus Media Studio

El chat ejecuta acciones `[ZEUS_ACTION]{"action":"...","params":{...}}[/ZEUS_ACTION]` contra el editor de vídeo. Hay dos familias: **backend** (proyecto del servidor, vía `ZeusMultieditorAPI` en `lib/sdk/client`) y **locales** (proyecto visible, mutan `editState` en `components/editor/VideoEditor.tsx`).

Dispatcher: `registerActionExecutor` en `VideoEditor.tsx` (~línea 1626). Prompt advertised: `editorSystemContext` en `components/FloatingChatButton.tsx`. Parseo de bloques: `FloatingChatButton.tsx` (regex `/\[ZEUS_ACTION\]([\s\S]*?)\[\/ZEUS_ACTION\]/g`).

Leyenda: ✅ cableada · ⚠️ SDK sin cablear · 🆕 local implementada · ➖ helper interno no expuesto

> Estado: **todas las funciones encontradas están ya expuestas** (núcleo + generación de media). No quedan acciones pendientes.

---

## ✅ Backend cableadas (23)
| Acción | Método SDK |
|---|---|
| createProject | api.createProject |
| updateProject | api.updateProject |
| getProject | api.getProject |
| getProjects | api.getProjects |
| deleteProject | api.deleteProject |
| getTimeline | api.getTimeline |
| insertClip | api.insertClip |
| updateClip | api.updateClip |
| deleteClip | api.deleteClip |
| getAssets | api.getAssets |
| uploadAsset | api.uploadAsset |
| getStyles | api.getStyles |
| generateScript | api.generateScript |
| getSuggestions | api.getSuggestions |
| autoEdit | api.autoEdit |
| getExportStatus | api.getExportStatus |
| addEffect | api.applyEffect |
| addTransition | api.applyTransition |
| addText | api.addText |
| getEffects | api.getEffects |
| getTransitions | api.getTransitions |
| exportProject | api.exportProject |
| getCurrentProjectId | (devuelve apiProjectId) |

## ⚠️ SDK sin cablear (servidor, disponibles pero no expuestas al modelo)
| Acción | Método SDK | Estado |
|---|---|---|
| getAsset | api.getAsset | 🆕 ahora cableada (case en el dispatcher) |
| listFiles | api.listFiles | 🆕 ahora cableada |
| deleteFile | api.deleteFile | 🆕 ahora cableada |
| downloadExport | api.downloadExport | 🆕 ahora cableada |
| viewFileUrl | api.viewFileUrl | ➖ no expuesta (sólo construye URL) |

> Nota: `lib/sdk/client.d.ts` está desactualizado (omite `viewFileUrl` y `deleteFile`); el dispatcher usa `(api as any)` para esos métodos.

---

## 🆕 Locales implementadas (tanda 1 — núcleo de edición)
Mutan `editState`. Despachadas vía `localActionsRef.current[action]` en el `default` del executor. Cada una hace snapshot de historial → deshacibles con Ctrl+Z.

### Inspección
- `getEditState` {} → resumen (clips con ids/tiempos, tracks, textClips, objectClips, crop, selección, filtros, trim).

### Timeline
- `addClip` {type, mediaFileId?, label?, startTime?, duration?, trackId?} → {clipId}
- `deleteClip` {clipId}
- `splitClip` {clipId, time}
- `mergeClips` {clipIdA, clipIdB}
- `setClipProp` {clipId, prop, value} — prop ∈ startTime/duration/playbackRate/reversed/opacity/volume/transitionIn/transitionOut/sourceStartTime/label
- `addSpeedZone` {clipId, startLocal, endLocal, newDuration}
- `snapTrackToStart` {trackId}
- `deleteTrack` {trackId}
- `addTrack` {type}
- `separateAudio` {clipId}
- `duplicateClip` {clipId}

### Crop / Zona
- `setCrop` {x, y, width, height, aspect?}
- `applyCropPreset` {aspect}
- `toggleCrop` {}
- `resetCrop` {}

### Selección / máscara
- `setSelectionShape` {type, x, y, width, height}
- `setSelectionScope` {scope}
- `setSelectionTimeRange` {timeStart, timeEnd, enabled?}
- `toggleSelectionTrack` {enabled?}
- `addSelectionKeyframe` {time, x, y, width, height}
- `removeSelectionKeyframe` {time}
- `clearSelectionKeyframes` {}
- `sam2Segment` {} — segmentación IA (SAM2 vía ComfyUI): calcula puntos dentro del lazo, los inyecta en Sam2Segmentation (modo vídeo, propaga por el vídeo) y decodifica el vídeo de máscaras a PNGs por frame → motionMasks (silueta cambiante con el contorno real del objeto)
- `resetSelection` {}

### Objetos
- `addObject` {src, mediaType, name?}
- `updateObject` {id, ...partial}
- `deleteObject` {id}

### Texto
- `addTextOverlay` {text, startTime?, duration?, fontSize?, color?, x?, y?, fontFamily?, textAlign?, opacity?}
- `updateText` {id, ...partial}
- `deleteText` {id}

### Filtros / trim
- `setFilter` {brightness?, contrast?, saturation?, hue?, blur?, intensity?}
- `setTrim` {trimStart?, trimEnd?}
- `resetFilters` {}
- `resetTrim` {}

### Transporte / global
- `seek` {time}
- `playPause` {playing?}
- `refreshPreview` {}
- `undo` {} · `redo` {} · `newProject` {}

---

## 🆕 Locales implementadas (tanda 2 — generación de media)
Pesadas/async, generan ficheros y añaden un clip al timeline al terminar. Sólo app de escritorio. Despachadas también vía `localActionsRef.current` (mismo mecanismo que las del núcleo).

Los tres handlers pesados (`handleEnhanceVideo`, `handleHtmlToMp4`, `generateLtxVideo`) se refactorizaron para aceptar un `overrides?` opcional: los botones los llaman sin argumentos (usan el estado de la UI), y la IA los llama pasando `overrides`. Así no se duplicó lógica.

| Acción | Parámetros | Handler envuelto |
|---|---|---|
| `startLtxServers` | {} | handleStartLtxServers |
| `restartBridge` | {} | handleRestartBridge |
| `capturePreviewFrame` | {} | captureCurrentPreviewFrame (deja el frame como imagen de entrada del LTX i2v) |
| `addLocalFile` | {filePath, type?: "video"\|"audio"\|"image", label?, duration?} | addVideoFileAsClip + handleAddClip (detecta type por extensión) |
| `enhanceVideo` | {scale?, sharpen?, denoise?, fps?, motionMci?, inputPath?, fileName?} | handleEnhanceVideo (inputPath por defecto = vídeo cargado) |
| `htmlToMp4` | {htmlPath?, zipPath?, duration, speed, fps, width, height, fileName?} | handleHtmlToMp4 (uno de htmlPath/zipPath) |
| `generateLtx` | {prompt, seed?, duration?, fps?, width?, height?, fileName?} | generateLtxVideo (requiere workflow + node IDs cargados en la UI) |

Notas:
- `enhanceVideo` `scale` acepta `'no'\|'1.5x'\|'2x'\|'1080p'\|'4k'` (o número suelto: 2→'2x', 1080→'1080p', 4/2160→'4k'); `fps` acepta `'no'\|'30'\|'60'` (o número 30/60). El adaptador coerciona.
- `generateLtx` NO carga el workflow: necesita que el usuario haya cargado un workflow de ComfyUI (formato API) y los node IDs (prompt_node, etc.) en la pestaña LTX. La IA sólo pasa prompt/seed/duración/fps/resolución/nombre. Si no hay workflow, devuelve `{ok:false,error:'no hay workflow...'}`.
- IPC subyacentes: `video:enhance` (lib/electron-fs.ts), `video:html-to-mp4`. LTX va por HTTP a `localhost:5081/ltx/` (Flux Bridge, no IPC).

---

## ➖ Helpers internos no expuestos (no para la IA)
- handleTimelineChange (guardado genérico del timeline), handleAddEffectClip (efecto con máscara), handleFileUpload (subida desde input), handleSave/handleExportVideo/performActualExport (diálogos/export), handleLoadProject/handleProjectFileSelect (cargar .zeus), handleCopyClip/handlePasteClip (usados por duplicateClip), handlePlayerZoom (zoom UI), fetchTtsAudio/handleTextToSpeechPreview (TTS), captureSlidesFromVideo, generateVideoThumbnail.

---

## Tipos relevantes (types/index.ts)
- `VideoEditState` (:207) — trimStart/trimEnd, brightness/contrast/saturation/hue/blur/intensity, timeline, textClips, objectClips, playerZoom, crop, selection.
- `TimelineClip` (:308) — startTime, duration, sourceStartTime, sourceDuration, playbackRate, reversed, speedZones[], transitionIn/transitionOut, opacity (0..1), volume (0..1), mediaFileId, label.
- `VideoCropState` (:142) — enabled, aspect, x/y/width/height (% 0..100).
- `VideoSelectionState` (:187) — enabled, shape (SelectionShape), scope, track, timeEnabled, timeStart, timeEnd.
- `SelectionShape` (:168) — type rect/circle/freehand, x/y/width/height (%), paths (BezierAnchor[][]), keyframes (SelectionKeyframe[]).
- `TextClip` (:224) — text, fontSize, fontFamily, color, position {x,y}, startTime, duration, opacity (0..100), keyframes.
- `ObjectClip` (:271) — name, src, mediaType png/gif, position {x,y}, width (%), startTime, duration, opacity (0..100), keyframes.

## Notas de implementación
- El `registerActionExecutor` se registra una sola vez (deps `[aiBridge, apiProjectId]`); lee `localActionsRef.current` (ref reconstruido cada render) → sin stale closures.
- Las acciones locales hacen `snapshotHistory()` antes de mutar → deshacibles. Los handlers que ya usan `saveToHistory` (texto/objeto) no necesitan snapshot extra.
- `addClip` replica la lógica de `handleAddClip` inline para devolver el `clipId` real. `addObject`/`addTextOverlay` devuelven `{ok:true}` y el modelo debe usar `getEditState` para obtener el id y luego `updateObject`/`updateText`.
- `setClipProp` convierte opacity/volume de 0..100 a 0..1 si el valor pasa de 1.
- Las keyframes de selección por tiempo concreto usan `upsertSelectionKeyframe`/`removeSelectionKeyframeAt` de `lib/selection-keyframes.ts`.