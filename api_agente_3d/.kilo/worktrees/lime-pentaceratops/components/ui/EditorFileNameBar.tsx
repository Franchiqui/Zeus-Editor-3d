'use client';

import type { ReactNode } from 'react';

type EditorFileNameBarProps = {
  /** Uno o más nombres (ej. ["documento.txt"] o ["Vídeo: intro.mp4", "Audio: music.mp3"]) */
  items: string[];
  /** Icono opcional a la izquierda */
  icon?: ReactNode;
  /** Clase de color del texto (ej. text-emerald-400) */
  colorClass?: string;
  className?: string;
};

/**
 * Barra con nombre(s) de archivo que se desplaza hacia la izquierda (marquee).
 * Mismo tamaño, fuente y forma que la barra del editor de audio (AudioVisualizer).
 */
export function EditorFileNameBar({ items, icon, colorClass = 'text-emerald-400', className = '' }: EditorFileNameBarProps) {
  const label = items.length === 0
    ? 'Sin archivo'
    : items.join('   •   ');
  const showMarquee = label.length > 20;

  return (
    <div
      className={`flex items-center gap-4 max-w-md xl:max-w-xl w-full bg-black/30 px-6 py-2 rounded-2xl border border-gray-800/50 shadow-inner min-w-0 ${className}`}
      title={label}
    >
      {icon && (
        <div className="p-1.5 rounded-full shrink-0 bg-gray-800 text-gray-500 flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="flex flex-col overflow-hidden min-w-0 flex-1">
        <div className="relative h-7 overflow-hidden flex items-center">
          <div
            className={`whitespace-nowrap text-xl font-black tracking-tighter ${colorClass} ${showMarquee ? 'animate-marquee' : ''}`}
          >
            {label || 'Sin archivo'}
            {showMarquee && <><span className="mx-12" aria-hidden>{label}</span><span className="mx-12" /></>}
          </div>
        </div>
      </div>
    </div>
  );
}
