// audio-mixer: mezcla la pista de audio del timeline en un único AudioBuffer para
// alimentar SceneExporter (mediabunny AudioBufferSource). Usa OfflineAudioContext
// para render determinista (igual que el export frame-a-frame del vídeo).
//
// Modelo de audio de Zeus (ver TimelinePlayer.tsx): los clips de la pista "video"
// están SILENCIADOS (audio.muted=true, volume=0); el audio audible viene SÓLO de
// los clips de la pista "audio". El clip "main-audio" espeja al "main-video": su
// fuente es el propio fichero de vídeo y su offset fuente = trimStart (igual que
// mapClipLocalToSource usa sourceStartTime ?? trimStart para main-video).
//
// Reglas:
//  - Se iteran SOLO los clips type==='audio' (los de vídeo no suenan).
//  - Mute si track.isMuted || clip.volume===0 || clip.reversed (reversed = audio off).
//  - offset fuente = clip.sourceStartTime ?? (id incluye 'main-audio' ? editState.trimStart : 0).
//  - playbackRate del clip se aplica al bufferSource (el trozo fuente = clip.duration*rate).
//  - gain = (clip.volume ?? 1) * (track.volume ?? 1) con ramps fadeIn/Out.
import type { VideoEditState, TimelineClip } from "@/types";
import { urlBlobCache } from "../video-cache/url-blob-cache";

export interface BuildAudioOptions {
  /** Resuelve un mediaFileId/origen a URL playable (resolveUrl del editor). */
  resolveUrl: (url: string) => string;
  /** URL del vídeo principal (la fuente del clip main-audio). */
  mainVideoUrl: string;
  /** Frecuencia de muestreo del render. Por defecto 44100. */
  sampleRate?: number;
}

const DEFAULT_SAMPLE_RATE = 44100;

/**
 * Construye un AudioBuffer estéreo con la mezcla de la pista de audio del timeline.
 * Devuelve null si no hay clips de audio (o todos están mutados) → el export saldrá
 * sin pista de audio.
 */
export async function buildTimelineAudioBuffer(
  editState: VideoEditState,
  duration: number,
  opts: BuildAudioOptions,
): Promise<AudioBuffer | null> {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const tracks = editState.timeline?.tracks ?? [];
  const trimStart = editState.trimStart ?? 0;

  // Recoger clips de audio visibles (no mutados, con volumen, no invertidos).
  interface MixItem {
    clip: TimelineClip;
    trackVol: number;
    url: string;
    offset: number;
    rate: number;
    fadeIn: number;
    fadeOut: number;
    vol: number;
  }
  const items: MixItem[] = [];
  for (const track of tracks) {
    if (track.type !== "audio") continue;
    const trackVol = track.isMuted ? 0 : track.volume ?? 1;
    for (const clip of track.clips) {
      if (!clip.mediaFileId && !clip.id.includes("main-audio")) continue;
      if (clip.reversed) continue; // audio off en reversed
      const vol = clip.volume ?? 1;
      if (vol === 0 || trackVol === 0) continue;
      const url = clip.id.includes("main-audio")
        ? opts.mainVideoUrl
        : opts.resolveUrl(clip.mediaFileId || "");
      if (!url) continue;
      const offset = clip.sourceStartTime ?? (clip.id.includes("main-audio") ? trimStart : 0);
      items.push({
        clip,
        trackVol,
        url,
        offset: Math.max(0, offset),
        rate: clip.playbackRate ?? 1,
        fadeIn: clip.fadeInDuration ?? 0,
        fadeOut: clip.fadeOutDuration ?? 0,
        vol,
      });
    }
  }

  if (items.length === 0) return null;

  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  // Decodificar cada fuente una sola vez y cachearla por URL.
  const decodedCache = new Map<string, AudioBuffer>();
  const getDecoded = async (url: string): Promise<AudioBuffer | null> => {
    const cached = decodedCache.get(url);
    if (cached) return cached;
    try {
      const ab = await urlBlobCache.getArrayBuffer(url);
      const buf = await ctx.decodeAudioData(ab.slice(0));
      decodedCache.set(url, buf);
      return buf;
    } catch (e) {
      console.warn("[audio-mixer] No se pudo decodificar el audio:", url, e);
      return null;
    }
  };

  for (const item of items) {
    const { clip, trackVol, url, offset, rate, fadeIn, fadeOut, vol } = item;
    const buf = await getDecoded(url);
    if (!buf) continue;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const gainNode = ctx.createGain();
    const peak = vol * trackVol;
    const clipDur = Math.max(0, clip.duration);
    const start = Math.max(0, clip.startTime);
    const end = start + clipDur;

    // Rampas de fade. Si no hay fade, valor constante = peak.
    const fi = Math.max(0, Math.min(fadeIn, clipDur / 2));
    const fo = Math.max(0, Math.min(fadeOut, clipDur / 2));
    gainNode.gain.setValueAtTime(fi > 0 ? 0 : peak, start);
    if (fi > 0) {
      gainNode.gain.linearRampToValueAtTime(peak, start + fi);
    }
    if (fo > 0) {
      const foStart = end - fo;
      gainNode.gain.setValueAtTime(peak, Math.max(start + fi, foStart));
      gainNode.gain.linearRampToValueAtTime(0, end);
    }

    src.connect(gainNode).connect(ctx.destination);

    // Trozo fuente a reproducir (segundos de buffer) = clipDur * rate, limitado al buffer.
    const srcLen = buf.duration - offset;
    const playDur = Math.min(clipDur * rate, Math.max(0, srcLen));
    if (playDur <= 0) continue;
    try {
      src.start(start, offset, playDur);
    } catch (e) {
      console.warn("[audio-mixer] start() falló para clip", clip.id, e);
    }
  }

  try {
    return await ctx.startRendering();
  } catch (e) {
    console.error("[audio-mixer] render falló:", e);
    return null;
  }
}