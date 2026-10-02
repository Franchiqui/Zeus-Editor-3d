// Helpers de filtro CSS (ctx.filter) compartidos por los nodos. Zeus aplica
// brillo/contraste/saturación/hue/blur vía ctx.filter tanto global como por clip.
import type { VideoEditState, TimelineClip } from "@/types";

export function buildFilterString(p: {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  blur?: number;
}): string {
  const filters: string[] = [];
  if (p.brightness) filters.push(`brightness(${100 + p.brightness}%)`);
  if (p.contrast) filters.push(`contrast(${100 + p.contrast}%)`);
  if (p.saturation) filters.push(`saturate(${100 + p.saturation}%)`);
  if (p.hue) filters.push(`hue-rotate(${p.hue}deg)`);
  if (p.blur) filters.push(`blur(${p.blur}px)`);
  return filters.join(" ");
}

export function globalFilterString(editState: VideoEditState): string {
  return buildFilterString({
    brightness: editState.brightness,
    contrast: editState.contrast,
    saturation: editState.saturation,
    hue: editState.hue,
    blur: editState.blur,
  });
}

export function clipFilterString(clip: TimelineClip): string {
  return buildFilterString({
    brightness: clip.brightness,
    contrast: clip.contrast,
    saturation: clip.saturation,
    hue: clip.hue,
    blur: clip.blur,
  });
}

export function hasGlobalFilter(editState: VideoEditState): boolean {
  return Boolean(
    editState.brightness ||
      editState.contrast ||
      editState.saturation ||
      editState.hue ||
      editState.blur,
  );
}

export function hasClipFilter(clip: TimelineClip): boolean {
  return Boolean(
    clip.brightness ||
      clip.contrast ||
      clip.saturation ||
      clip.hue ||
      clip.blur,
  );
}