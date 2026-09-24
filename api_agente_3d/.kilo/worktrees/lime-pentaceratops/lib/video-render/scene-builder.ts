// scene-builder: adapta el editState de Zeus al scene graph (RootNode). Mapea
// TimelineClip / TextClip / ObjectClip → nodos del motor. Es el único punto que
// conoce el modelo de datos de Zeus; el resto del motor es agnóstico.
//
// Árbol (orden de render bottom→top):
//   RootNode(duration)
//     └─ CropNode(crop)                      [solo export, si crop.enabled]
//         └─ EffectNode(filtro global + selección)   envuelve la capa de vídeo
//             └─ TransitionNode(A,B) | VideoNode    por cada clip de vídeo
//             └─ ImageNode                         por cada clip de imagen
//         └─ ObjectNode...                         objectClips + overlays efecto
//         └─ TextNode...                           textClips
//
// Transiciones (modelo encadenado, mejora del getTransitionAtExport original):
//  - Para cada par consecutivo (A=sorted[i], B=sorted[i+1]) con A.transitionOut
//    (type!=none, dur>0): ventana = [effectiveEnd_A - dur, effectiveEnd_A).
//  - effectiveEnd(main-video) = startTime + (trimEnd - trimStart); el resto =
//    startTime + duration.
//  - B se trata como si empezara en windowStart (solapamiento): sourceStart_B =
//    windowStart. Así B reproduce su cabeza durante la transición y CONTINÚA tras
//    ella sin saltos ni doble reproducción de la cabeza (bug del original cuando
//    B no solapaba). El rango standalone de B excluye la ventana entrante y la
//    saliente.
import type {
  VideoEditState,
  TimelineClip,
  ObjectClip,
  VideoOverlay,
  VideoCropState,
} from "@/types";
import { RootNode } from "./nodes/root-node";
import { BaseNode } from "./nodes/base-node";
import { CropNode } from "./nodes/crop-node";
import { EffectNode } from "./nodes/effect-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { TransitionNode } from "./nodes/transition-node";
import { ObjectNode } from "./nodes/object-node";
import { OverlayVideoNode } from "./nodes/overlay-video-node";
import { SelectionMaskNode } from "./nodes/selection-mask-node";
import { PaintNode } from "./nodes/paint-node";
import { TextNode } from "./nodes/text-node";
import { containFit } from "./composite/draw-video-fit";
import { globalFilterString, hasGlobalFilter } from "./composite/filter";
import { isPlayableVideoClip } from "./clip-roles";

export interface BuildSceneOptions {
  isPreview: boolean;
  /** Tamaño del canvas de salida (export) o del preview. */
  canvasSize: { width: number; height: number };
  /** Duración total a renderizar (s). Preview = timeline.duration; export = trimEnd-trimStart. */
  duration: number;
  /** URL playable del vídeo principal (resolveUrl(videoUrl)). */
  mainVideoUrl: string;
  /** Resuelve un mediaFileId/origen a URL playable (resolveUrl del editor). */
  resolveUrl: (url: string) => string;
  /** Tamaño del vídeo principal (para CropNode). null si no se conoce. */
  mainVideoSize: { width: number; height: number } | null;
  /** Overlays ya resueltos: [...resolvedObjectClips, ...resolvedEffectClips]. */
  overlays: ObjectClip[];
  /** Vídeo superpuesto a pantalla completa (opcional). Solo se añade al export
   *  (includeOverlays); en preview lo pinta el <video> DOM del editor. */
  videoOverlay?: VideoOverlay | null;
  /**
   * Si true, añade ImageNode (clips de pista image), ObjectNode (overlays) y
   * TextNode (textClips) a la escena. En preview se pasa false para que esos
   * elementos los sigan pintando los overlays DOM (handlers de edición) y no se
   * dupliquen; en export se pasa true (el canvas es la única salida).
   * Por defecto true.
   */
  includeOverlays?: boolean;
  /**
   * Sólo preview (isPreview=true): si true, aplica la intensidad (nitidez por
   * convolución 3×3 dentro de EffectNode) al frame actual. Es el hotspot más caro
   * del bucle, así que durante la reproducción se omite (previewApplyIntensity=
   * false → intensity=0 → preview fluido sin intensidad). Al pausar o tocar el
   * slider, el editor pasa true y el frame en pantalla se renderiza CON intensidad
   * para que el usuario vea el cambio. El export (isPreview=false) siempre la aplica
   * independientemente de este flag. Por defecto false.
   */
  previewApplyIntensity?: boolean;
  /**
   * Sólo export: si true y hay selección (lazo/rect/círculo) activa, envuelve TODO el
   * contenido en un SelectionMaskNode que recorta al shape de la selección. Lo que
   * queda FUERA del lazo no se dibuja → como el renderer va con alpha:true, esa zona
   * sale transparente en el WebM/VP9 resultante. Pensado para exportar sólo un objeto
   * recortado y luego sobreponerlo (el alpha deja ver el vídeo de atrás). El preview
   * nunca usa esto (isPreview=true lo ignora). Por defecto false.
   */
  transparentBackground?: boolean;
}

/** Duración efectiva del clip en el timeline (para ventanas de transición). */
function clipEffectiveEnd(clip: TimelineClip, trimStart: number, trimEnd: number): number {
  if (clip.id.includes("main-video")) {
    return clip.startTime + Math.max(0, trimEnd - trimStart);
  }
  return clip.startTime + clip.duration;
}

export function buildScene(editState: VideoEditState, opts: BuildSceneOptions): RootNode {
  const { isPreview, canvasSize, duration, mainVideoUrl, resolveUrl, mainVideoSize, overlays } = opts;
  const includeOverlays = opts.includeOverlays ?? true;
  const trimStart = editState.trimStart ?? 0;
  const trimEnd = editState.trimEnd ?? duration;

  const root = new RootNode({ duration });
  const sceneWidth = canvasSize.width;
  const sceneHeight = canvasSize.height;

  // ---- Capa de vídeo (envuelta por EffectNode: filtro global + intensidad +
  // selección) ----
  // Intensidad (nitidez/suavizado): la aplica EffectNode por scope (dentro/fuera),
  // igual que el filtro global. La convolución 3×3 de nitidez es el hotspot más caro
  // del bucle de preview, así que durante la reproducción se omite
  // (previewApplyIntensity=false → intensity=0): el preview va fluido. Al pausar o
  // tocar el slider el editor pasa previewApplyIntensity true y el frame actual se
  // renderiza CON intensidad. El export (isPreview=false) siempre la aplica.
  const previewApplyIntensity = opts.previewApplyIntensity ?? false;
  const intensity = (isPreview && !previewApplyIntensity) ? 0 : (editState.intensity ?? 0);
  const videoLayer = new EffectNode({
    selection: editState.selection ?? null,
    globalFilter: hasGlobalFilter(editState) ? globalFilterString(editState) : "",
    intensity,
  });
  const videoTarget: BaseNode = videoLayer;

  const tracks = editState.timeline?.tracks ?? [];
  const videoClips = tracks
    .filter((t) => t.type === "video")
    .flatMap((t) => t.clips)
    .filter(isPlayableVideoClip)
    .filter((c) => !c.hidden)
    .slice()
    .sort((a, b) => a.startTime - b.startTime);

  // Encadenado de transiciones: effectiveStart/End + ventanas.
  // effectiveEnd[i] = clipEffectiveEnd(sorted[i]). Si sorted[i-1] tiene transitionOut,
  // effectiveStart[i] = effectiveEnd[i-1] - dur (B solapa empezando en windowStart).
  const effEnd = videoClips.map((c) => clipEffectiveEnd(c, trimStart, trimEnd));
  const effStart: number[] = videoClips.map((c, i) => {
    if (i === 0) return c.startTime;
    const prev = videoClips[i - 1];
    const trans = prev.transitionOut;
    if (trans && trans.type !== "none" && trans.duration > 0) {
      return effEnd[i - 1] - trans.duration; // windowStart = B empieza aquí
    }
    return c.startTime;
  });

  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const url = clip.id.includes("main-video") ? mainVideoUrl : resolveUrl(clip.mediaFileId || "");
    const trans = clip.transitionOut;
    const hasNext = i < videoClips.length - 1;
    const hasOut = !!(trans && trans.type !== "none" && trans.duration > 0 && hasNext);

    // Rango standalone de este clip: excluye la ventana ENTRANTE (si el anterior
    // tiene transitionOut hacia él) y la SALIENTE (si él tiene transitionOut).
    const incDur = i > 0 && (() => {
      const p = videoClips[i - 1];
      const pt = p.transitionOut;
      return pt && pt.type !== "none" && pt.duration > 0 ? pt.duration : 0;
    })() || 0;
    const outDur = hasOut ? trans.duration : 0;

    const standaloneStart = effStart[i] + incDur;
    const standaloneEnd = effEnd[i] - outDur;

    if (hasOut) {
      // TransitionNode entre A=clip y B=videoClips[i+1].
      const clipB = videoClips[i + 1];
      const urlB = clipB.id.includes("main-video") ? mainVideoUrl : resolveUrl(clipB.mediaFileId || "");
      const windowStart = effEnd[i] - trans.duration;
      const windowEnd = effEnd[i];
      const tn = new TransitionNode({
        clipA: clip,
        urlA: url,
        sourceStartA: effStart[i],
        clipB,
        urlB,
        trimStart,
        windowStart,
        windowEnd,
        type: trans.type,
      });
      videoTarget.add(tn);
    }

    if (standaloneEnd > standaloneStart) {
      const vn = new VideoNode({
        clip,
        url,
        mediaId: clip.mediaFileId || url,
        trimStart,
        sourceStart: effStart[i],
        standaloneStart,
        standaloneEnd,
        isMainReference: clip.id.includes("main-video"),
      });
      videoTarget.add(vn);
    }
  }

  // Clips de imagen (van después de los vídeos => su videoArea prevalece).
  if (includeOverlays) {
    const imageClips = tracks
      .filter((t) => t.type === "image")
      .flatMap((t) => t.clips)
      .filter((c) => c.mediaFileId);
    for (const clip of imageClips) {
      videoTarget.add(new ImageNode({ clip, url: resolveUrl(clip.mediaFileId!) }));
    }
  }

  // ---- Contenedor (CropNode solo en export) ----
  // Para export con transparencia (transparentBackground + selección activa), TODO
  // el contenido (incluido el CropNode) va dentro de un SelectionMaskNode que recorta
  // al shape del lazo. Lo que queda fuera no se dibuja → con renderer alpha:true sale
  // transparente en el WebM/VP9. El preview nunca entra aquí (isPreview=true).
  let container: BaseNode = root;
  const sel = editState.selection;
  const useTransparentMask =
    !isPreview && !!opts.transparentBackground && !!sel?.enabled && !!sel?.shape && !!sel.shape.type;
  if (useTransparentMask) {
    const maskNode = new SelectionMaskNode({ selection: sel!, globalFilter: "" });
    root.add(maskNode);
    container = maskNode;
  }

  if (!isPreview && editState.crop?.enabled && mainVideoSize) {
    const crop = editState.crop as VideoCropState;
    const area = containFit(mainVideoSize.width, mainVideoSize.height, sceneWidth, sceneHeight);
    const cropNode = new CropNode({
      crop,
      mainVideoArea: { dx: area.dx, dy: area.dy, dw: area.dw, dh: area.dh },
      sceneWidth,
      sceneHeight,
    });
    container.add(cropNode);
    container = cropNode;
  }

  container.add(videoLayer);

  // ---- Capa de pintura (brocha/bote/gotero/borrador): encima del vídeo filtrado,
  // debajo de objetos/texto. Capa única; si baseBox + selección inside, la sigue.
  // Sólo export (includeOverlays); en preview la pinta el overlay DOM (PaintOverlay). ----
  if (includeOverlays && editState.paint?.enabled && (editState.paint.mask || editState.paint.inverseFill)) {
    container.add(new PaintNode({ paint: editState.paint, selection: editState.selection ?? null }));
  }

  // ---- Objetos (sin filtro ni máscara, como en renderFrame) ----
  if (includeOverlays) {
    // Vídeo superpuesto a pantalla completo: encima del vídeo principal, pero
    // debajo de objetos/texto (se añade primero).
    if (opts.videoOverlay) {
      container.add(new OverlayVideoNode({ overlay: opts.videoOverlay, resolveUrl }));
    }

    for (const obj of overlays) {
      container.add(new ObjectNode({ objectClip: obj }));
    }

    // ---- Texto (sin filtro ni máscara) ----
    for (const text of editState.textClips ?? []) {
      container.add(new TextNode({ textClip: text }));
    }
  }

  return root;
}