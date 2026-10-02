import type { TimelineClip } from "@/types";

/**
 * Mapea clipLocalTime → { sourceTime, playbackRate } considerando reversed, playbackRate
 * y speedZones. Extraído de VideoEditor.tsx para compartirlo con el motor de render
 * (lib/video-render) sin duplicar lógica.
 *
 * Regla especial: el clip cuyo id contiene "main-video" usa sourceStartTime = trimStart
 * (el inicio del timeline) en lugar de 0.
 */
export function mapClipLocalToSource(
  clip: TimelineClip,
  clipLocalTime: number,
  trimStart: number,
): { sourceTime: number; playbackRate: number } {
  const rate = clip.playbackRate ?? 1;
  const srcStart = clip.id.includes("main-video")
    ? (clip.sourceStartTime ?? trimStart)
    : (clip.sourceStartTime ?? 0);

  // Clip invertido (reversed): el final del clip apunta al inicio de la fuente y al revés.
  // Gana sobre speedZones (zones ignorados en un clip invertido). El sourceTime va
  // disminuyendo a medida que avanza el timeline, por eso en preview/export no se puede
  // usar play() (HTML5 no reproduce hacia atrás): hay que pause + seek por frame.
  if (clip.reversed) {
    const srcContent = clip.sourceDuration ?? clip.duration * rate;
    const srcEnd = srcStart + srcContent;
    return { sourceTime: srcEnd - clipLocalTime * rate, playbackRate: rate };
  }

  const zones = (clip.speedZones ?? []).slice().sort((a, b) => a.startLocal - b.startLocal);
  if (zones.length === 0) {
    return { sourceTime: srcStart + clipLocalTime * rate, playbackRate: rate };
  }

  let srcPos = 0;
  let tPos = 0;
  for (const z of zones) {
    const normalSegmentDuration = Math.max(0, z.startLocal - tPos);
    const normalSourceDuration = normalSegmentDuration * rate;
    if (clipLocalTime < z.startLocal) {
      return { sourceTime: srcStart + srcPos + (clipLocalTime - tPos) * rate, playbackRate: rate };
    }
    if (clipLocalTime < z.startLocal + z.newDuration) {
      const zoneSourceDuration = (z.endLocal - z.startLocal) * rate;
      const zoneRate = zoneSourceDuration / z.newDuration;
      const inZone = clipLocalTime - z.startLocal;
      const sourceAtZoneStart = srcStart + srcPos + normalSourceDuration;
      return { sourceTime: sourceAtZoneStart + inZone * zoneRate, playbackRate: zoneRate };
    }
    srcPos += normalSourceDuration + (z.endLocal - z.startLocal) * rate;
    tPos = z.startLocal + z.newDuration;
  }
  return { sourceTime: srcStart + srcPos + (clipLocalTime - tPos) * rate, playbackRate: rate };
}

/** Mapea sourceTime → clipLocalTime (inverso de mapClipLocalToSource, para handleTimeUpdate) */
export function mapSourceToClipLocal(
  clip: TimelineClip,
  sourceTime: number,
  trimStart: number,
): number {
  const rate = clip.playbackRate ?? 1;
  const srcStart = clip.id.includes("main-video")
    ? (clip.sourceStartTime ?? trimStart)
    : (clip.sourceStartTime ?? 0);
  if (clip.reversed) {
    const srcContent = clip.sourceDuration ?? clip.duration * rate;
    const srcEnd = srcStart + srcContent;
    return (srcEnd - sourceTime) / rate;
  }
  const zones = (clip.speedZones ?? []).slice().sort((a, b) => a.startLocal - b.startLocal);
  if (zones.length === 0) return (sourceTime - srcStart) / rate;
  let srcPos = 0,
    tPos = 0;
  for (const z of zones) {
    const normalSegmentDuration = Math.max(0, z.startLocal - tPos);
    const normalSourceDuration = normalSegmentDuration * rate;
    const segEndSrc = srcStart + srcPos + normalSourceDuration;
    if (sourceTime < segEndSrc) return tPos + (sourceTime - srcStart - srcPos) / rate;
    const zoneSourceDuration = (z.endLocal - z.startLocal) * rate;
    const zoneRate = zoneSourceDuration / z.newDuration;
    const zoneEndSrc = segEndSrc + zoneSourceDuration;
    if (sourceTime < zoneEndSrc) return z.startLocal + (sourceTime - segEndSrc) / zoneRate;
    srcPos += normalSourceDuration + zoneSourceDuration;
    tPos = z.startLocal + z.newDuration;
  }
  return tPos + (sourceTime - srcStart - srcPos) / rate;
}