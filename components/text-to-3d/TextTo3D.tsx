'use client';

import { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';

// Componente para el texto 3D
function TextMesh({ text, position, color }: { text: string; position?: [number, number, number]; color?: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      // Rotación suave del texto
      meshRef.current.rotation.y += 0.005;
    }
  });

  return (
    <Text
      ref={meshRef}
      position={position || [0, 0, 0]}
      color={color || '#ffffff'}
      fontSize={1}
      maxWidth={200}
      textAlign="center"
      font="/fonts/inter-bold.woff"
    >
      {text}
    </Text>
  );
}

// Componente principal
export function TextTo3D({ text = "Hola Mundo" }: { text?: string }) {
  const [inputText, setInputText] = useState(text);
  
  return (
    <div className="w-full h-96 md:h-[500px] bg-gray-900 rounded-lg overflow-hidden">
      <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <TextMesh text={inputText} color="#4ade80" />
        <OrbitControls enableZoom={true} enablePan={true} />
      </Canvas>
    </div>
  );
}