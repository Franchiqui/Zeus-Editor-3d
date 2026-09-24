'use client';

import React, { useMemo } from 'react';
import { TimelineState, TimelineClip } from '@/types';

const isOverlayClip = (c: TimelineClip) =>
  c.type === 'video' &&
  c.overlayKind !== 'object' &&
  c.mediaFileId &&
  String(c.mediaFileId).startsWith('data:image');

interface EffectsOverlayProps {
  timeline: TimelineState | undefined;
  currentTime: number;
}

function getClipOpacityAtTime(clip: TimelineClip, currentTime: number) {
  const baseOpacity = clip.opacity ?? 1;
  const clipLocalTime = currentTime - clip.startTime;
  const clipDuration = clip.duration ?? 0;
  const fadeInDuration = Math.max(0, clip.fadeInDuration ?? 0);
  const fadeOutDuration = Math.max(0, clip.fadeOutDuration ?? 0);

  let fadeMultiplier = 1;

  if (fadeInDuration > 0 && clipLocalTime < fadeInDuration) {
    fadeMultiplier = Math.min(fadeMultiplier, Math.max(0, clipLocalTime / fadeInDuration));
  }

  if (fadeOutDuration > 0) {
    const remainingTime = clipDuration - clipLocalTime;
    if (remainingTime < fadeOutDuration) {
      fadeMultiplier = Math.min(fadeMultiplier, Math.max(0, remainingTime / fadeOutDuration));
    }
  }

  return baseOpacity * fadeMultiplier;
}

export default function EffectsOverlay({ timeline, currentTime }: EffectsOverlayProps) {
  const roundedTime = Math.floor(currentTime * 15) / 15;
  const activeOverlayClips = useMemo(() => (timeline?.tracks || [])
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        isOverlayClip(clip) &&
        roundedTime >= clip.startTime &&
        roundedTime < clip.startTime + (clip.duration ?? 0)
    ), [timeline?.tracks, roundedTime]);

  if (activeOverlayClips.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg z-[5]">
      {activeOverlayClips.map((clip) => {
        const opacity = getClipOpacityAtTime(clip, currentTime);
        const tint = (clip as TimelineClip & { overlayTint?: string | null }).overlayTint;
        return (
          <div
            key={clip.id}
            className="absolute inset-0 w-full h-full"
            style={{ opacity }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={clip.mediaFileId!}
                alt=""
                className="object-contain"
                style={{
                  mixBlendMode: tint ? 'multiply' : 'normal',
                  width: '100%',
                  height: '100%',
                  transform: clip.mirrored ? 'scaleX(-1)' : undefined
                }}
              />
            </div>
            {tint && (
              <div
                className="absolute inset-0"
                style={{
                  backgroundColor: tint,
                  mixBlendMode: 'multiply',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
