'use client';

import React from 'react';
import logoData from '@/logo.json';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  holes?: Point[][];
}

interface LogoJson {
  title: string;
  strokes: Stroke[];
}

function getBounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (s.holes) {
      for (const hole of s.holes) {
        for (const p of hole) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';
}

interface LogoSvgProps {
  size?: number;
  height?: number;
  className?: string;
  data?: LogoJson;
}

export default function LogoSvg({ size, height, className = '', data: propData }: LogoSvgProps) {
  const data = propData || (logoData as LogoJson);
  const strokes = data.strokes || [];

  if (strokes.length === 0) return null;

  const { minX, minY, maxX, maxY } = getBounds(strokes);
  const viewMinX = minX;
  const viewMinY = minY;
  const viewW = maxX - minX;
  const viewH = maxY - minY;

  const h = height ?? size ?? 32;
  const aspectRatio = viewH > 0 ? viewW / viewH : 1;
  const w = Math.round(h * aspectRatio);

  return (
    <svg
      width={w}
      height={h}
      viewBox={`${viewMinX} ${viewMinY} ${viewW} ${viewH}`}
      className={className}
      style={{ display: 'block' }}
    >
      {strokes.map((stroke, i) => {
        const fill = stroke.fillColor || 'none';
        const strokeColor = stroke.strokeColor || '#ffffff';
        const strokeWidth = stroke.strokeWidth ?? 1;

        const mainPath = pointsToPath(stroke.points);
        const holePaths = stroke.holes?.map(h => pointsToPath(h)).join(' ') || '';
        const d = holePaths ? `${mainPath} ${holePaths}` : mainPath;

        return (
          <path
            key={i}
            d={d}
            fill={fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            fillRule="evenodd"
          />
        );
      })}
    </svg>
  );
}
