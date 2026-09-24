// clip-roles: clasificación de clips para el scene-builder. Réplica de
// `isPlayableVideoClip` del VideoEditor (línea 332): un clip es "jugable" como
// capa de vídeo si tiene mediaFileId y NO es un overlay (effect/object), ya que
// los overlays se renderizan vía ObjectNode, no como vídeo de fondo.
import type { TimelineClip } from "@/types";

export function isPlayableVideoClip(clip: TimelineClip): clip is TimelineClip & {
  mediaFileId: string;
} {
  return (clip.type === "video" || clip.type === "image") && !!clip.mediaFileId && !clip.overlayKind;
}