import React, { useRef, useState, useEffect } from 'react';
import { TextClip } from '@/types';
import { getTextValuesAtTime, getTextFadeMultiplierAtTime } from '@/lib/text-keyframes';

interface TextOverlayProps {
  textClips: TextClip[];
  currentTime: number;
  onUpdateTextClip?: (id: string, updates: Partial<TextClip>) => void;
}

// Debe coincidir con REFERENCE_HEIGHT de lib/video-render/nodes/text-node.ts.
// El export escala la tipografía por (renderer.height / 1080); el preview debe
// usar el mismo factor (altura mostrada del frame / 1080) para que WYSIWYG.
const REFERENCE_HEIGHT = 1080;

export default function TextOverlay({ textClips, currentTime, onUpdateTextClip }: TextOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(600);
  const [dragState, setDragState] = useState<{ clipId: string; startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setFrameHeight(Math.max(1, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (!dragState || !onUpdateTextClip) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      
      const deltaX = ((event.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - dragState.startY) / rect.height) * 100;
      
      const newX = Math.max(0, Math.min(100, dragState.startPos.x + deltaX));
      const newY = Math.max(0, Math.min(100, dragState.startPos.y + deltaY));
      
      onUpdateTextClip(dragState.clipId, { position: { x: newX, y: newY } });
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onUpdateTextClip]);

  // Mismo factor que usa el export: altura del frame / 1080.
  const previewScale = frameHeight / REFERENCE_HEIGHT;

  const activeTextClips = textClips.filter(clip =>
    currentTime >= clip.startTime &&
    currentTime < clip.startTime + clip.duration
  );

  function hexToRgb(hex: string) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ?
      `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` :
      '0, 0, 0';
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {activeTextClips.map(clip => {
        // Valores interpolados por keyframes (posición/tamaño/opacity). Sin
        // keyframes devuelve los campos estáticos del clip (mismo resultado que
        // antes), así que los textos sin animación no cambian de sitio.
        const vals = getTextValuesAtTime(clip, currentTime);
        const fadeMultiplier = getTextFadeMultiplierAtTime(clip, currentTime);
        const finalOpacity = (vals.opacity / 100) * fadeMultiplier;

        const hasKeyframes = !!(clip.keyframes && clip.keyframes.length > 0);

        // Contenedor con posicionamiento absoluto para X y Y
        const containerStyle: React.CSSProperties = {
          position: 'absolute',
          left: `${vals.x}%`,
          top: `${vals.y}%`,
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          justifyContent: clip.textAlign === 'left' ? 'flex-start' : clip.textAlign === 'right' ? 'flex-end' : 'center',
          zIndex: 10,
          opacity: finalOpacity,
          transition: 'opacity 0.05s linear',
          pointerEvents: onUpdateTextClip ? 'auto' : 'none',
        };

        // Estilo para el fondo difuminado/feathering
        const bgLayerStyle: React.CSSProperties = {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: `rgba(${hexToRgb(clip.backgroundColor)}, ${(clip.backgroundOpacity ?? 100) / 100})`,
          borderRadius: `${clip.borderRadius ?? 0}px`,
          filter: (clip.backgroundBlur ?? 0) > 0 ? `blur(${clip.backgroundBlur}px)` : 'none',
          transform: `scale(${1 + ((clip.backgroundBlur ?? 0) * 0.02)})`,
          zIndex: -1,
        };

        // Estilo para el bloque de texto
        const textBlockStyle: React.CSSProperties = {
          position: 'relative',
          padding: '0.5em 1em',
          fontSize: `${vals.fontSize * previewScale}px`,
          fontFamily: clip.fontFamily,
          color: clip.color,
          opacity: 1,
          whiteSpace: 'nowrap',
          fontWeight: clip.isBold ? 'bold' : 'normal',
          fontStyle: clip.isItalic ? 'italic' : 'normal',
          textDecoration: clip.isUnderline ? 'underline' : 'none',
          WebkitTextStroke: (clip.borderWidth ?? 0) > 0 ? `${(clip.borderWidth ?? 0) * previewScale}px ${clip.borderColor}` : 'none',
          textShadow: (clip.shadowBlur ?? 0) > 0 || (clip.shadowOffset ?? 0) > 0
            ? `${(clip.shadowOffset ?? 0) * previewScale}px ${(clip.shadowOffset ?? 0) * previewScale}px ${(clip.shadowBlur ?? 0) * previewScale}px ${clip.shadowColor}`
            : '2px 2px 4px rgba(0,0,0,0.5)',
          textAlign: clip.textAlign,
          display: 'inline-block',
          ...(clip.rotation ? { transform: `rotate(${clip.rotation}deg)` } : {}),
        };

        return (
          <div key={clip.id} style={containerStyle}>
            <div 
              onMouseDown={(e) => {
                if (!onUpdateTextClip) return;
                e.preventDefault();
                e.stopPropagation();
                setDragState({
                  clipId: clip.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  startPos: { x: vals.x, y: vals.y },
                });
              }}
              style={{
                ...textBlockStyle,
                cursor: onUpdateTextClip ? 'move' : 'default',
              }}
            >
              {/* Capa de fondo personalizada */}
              <div style={bgLayerStyle} />
              {/* Texto real */}
              <div style={{ position: 'relative', zIndex: 1 }}>
                {clip.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}