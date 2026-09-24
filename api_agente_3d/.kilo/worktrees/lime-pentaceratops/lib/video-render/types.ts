// Interfaces de parámetros de los nodos del scene graph, adaptadas al modelo de
// datos de Zeus (TimelineClip / TextClip / ObjectClip). A diferencia de Motor-Render
// (que usa transform/animations/effect objects), Zeus posiciona texto/objetos
// relativo al área contain-fit del vídeo activo y anima objetos vía keyframes.
import type {
  TimelineClip,
  TextClip,
  ObjectClip,
  VideoOverlay,
  VideoCropState,
  VideoSelectionState,
  VideoPaintState,
  TransitionType,
} from "@/types";

export interface VideoNodeParams {
  clip: TimelineClip;
  url: string;
  mediaId: string;
  trimStart: number;
  /** Inicio efectivo del clip en el timeline. Para un clip normal = clip.startTime.
   * Si es el destino (B) de una transición del clip anterior, = windowStart
   * (solapamiento), de modo que B reproduce fluido desde su cabeza durante la
   * transición y continúa sin saltos ni doble reproducción. */
  sourceStart: number;
  /** Rango [start, end) del timeline en el que este nodo dibuja (excluye ventanas
   * de transición que lo cubren, tanto la entrante como la saliente). */
  standaloneStart: number;
  standaloneEnd: number;
  /** ¿Es el clip de referencia principal (para CropNode)? */
  isMainReference: boolean;
}

export interface ImageNodeParams {
  clip: TimelineClip;
  url: string;
}

export interface TransitionNodeParams {
  clipA: TimelineClip;
  urlA: string;
  /** Inicio efectivo de A en el timeline (= clipA.startTime, salvo que A sea a su
   * vez destino de una transición previa, en cuyo caso = su windowStart). */
  sourceStartA: number;
  clipB: TimelineClip;
  urlB: string;
  trimStart: number;
  /** Inicio de la ventana de transición. También es el inicio efectivo de B
   * (B se solapa empezando aquí), de modo que B reproduce fluido y sin saltos. */
  windowStart: number;
  windowEnd: number;
  type: TransitionType;
}

export interface TextNodeParams {
  textClip: TextClip;
}

export interface ObjectNodeParams {
  objectClip: ObjectClip;
}

export interface OverlayVideoNodeParams {
  overlay: VideoOverlay;
  /** Resuelve el src a URL playable (resolveUrl del editor). */
  resolveUrl: (url: string) => string;
}

export interface SelectionMaskNodeParams {
  /** null = sin selección (EffectNode lo tolera: salta la máscara). */
  selection: VideoSelectionState | null;
  globalFilter: string;
  /** Intensidad (nitidez/suavizado, -100..100). EffectNode la aplica por scope (dentro/fuera)
   *  igual que el globalFilter. + = convolución 3x3 sharpen, − = ctx.filter blur, 0 = nada. */
  intensity?: number;
}

export interface PaintNodeParams {
  /** null/sin mask = sin pintura. */
  paint: VideoPaintState | null;
  /** Selección de efectos: si la pintura tiene baseBox y scope 'inside', la sigue. */
  selection?: VideoSelectionState | null;
}

export interface FilterNodeParams {
  globalFilter: string;
}

export interface SharpenNodeParams {
  /** -100..100. 0 = passthrough. + = nitidez (convolución 3x3 sharpen), − = suavizado (ctx.filter blur). */
  intensity: number;
}

export interface CropNodeParams {
  crop: VideoCropState;
  /** Área contain-fit del vídeo principal en el canvas escena (constante). */
  mainVideoArea: { dx: number; dy: number; dw: number; dh: number };
  /** Tamaño del canvas escena completo (donde se renderiza el contenido). */
  sceneWidth: number;
  sceneHeight: number;
}