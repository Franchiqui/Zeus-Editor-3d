'use client';
 
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
 
interface EditorCanvasProps {
  label?: string;
  axisLabel?: string;
  polygon?: any;
  resolution?: number;
  onChange?: (polygon: any) => void;
  onClose?: () => void;
  onObjectSelect?: (id: string) => void;
  onObjectDeselect?: (id: string) => void;
  onTransform?: (id: string, transform: { x: number; y: number; z: number }) => void;
  children?: React.ReactNode;
}
 
const EditorCanvas: React.FC<EditorCanvasProps> = ({
  label,
  axisLabel,
  polygon,
  resolution,
  onChange,
  onClose,
  onObjectSelect,
  onObjectDeselect,
  onTransform,
  children,
}) => {
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, z: 0 });
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
 
  const rotate = (axis: 'x' | 'y' | 'z', delta: number) => {
    setRotation(prev => ({ ...prev, [axis]: prev[axis] + delta }));
  };
 
  const handleObjectSelect = useCallback((id: string) => {
    setSelectedObject(id);
    onObjectSelect?.(id);
  }, [onObjectSelect]);
 
  const handleObjectDeselect = useCallback((id: string) => {
    setSelectedObject(null);
    onObjectDeselect?.(id);
  }, [onObjectDeselect]);
 
  const handleTransform = useCallback((id: string, transformData: { x: number; y: number; z: number }) => {
    setTransform(transformData);
    onTransform?.(id, transformData);
  }, [onTransform]);
 
  return (
    <div className="editor-canvas">
      {children}
      {selectedObject && (
        <div className="selected-object" style={{ transform: `translate(${transform.x}px, ${transform.y}px) rotateX(${rotation.x}rad) rotateY(${rotation.y}rad) rotateZ(${rotation.z}rad)` }}>
          {JSON.stringify(transform)}
        </div>
        <div>
          <button onClick={() => rotate('x', -0.1)}>Rotar X -</button>
          <button onClick={() => rotate('x', 0.1)}>Rotar X +</button>
          <button onClick={() => rotate('y', -0.1)}>Rotar Y -</button>
          <button onClick={() => rotate('y', 0.1)}>Rotar Y +</button>
          <button onClick={() => rotate('z', -0.1)}>Rotar Z -</button>
          <button onClick={() => rotate('z', 0.1)}>Rotar Z +</button>
        </div>
      )}
    </div>
  );
};
 
export default EditorCanvas;