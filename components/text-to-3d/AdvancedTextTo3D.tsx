'use client';

import { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';

function FloatingText({ text }: { text: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
      meshRef.current.position.y = Math.sin(Date.now() * 0.001) * 0.5;
    }
  });

  return (
    <Text
      ref={meshRef}
      position={[0, 0, 0]}
      fontSize={2}
      color="white"
      anchorX="center"
      anchorY="middle"
    >
      {text}
    </Text>
  );
}

export function AdvancedTextTo3D() {
  const [inputText, setInputText] = useState<string>('Hola Mundo');
  const [isMounted, setIsMounted] = useState<boolean>(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 w-full max-w-2xl">
        <label htmlFor="text-input" className="block text-sm font-medium mb-2">
          Ingresa tu texto:
        </label>
        <input
          id="text-input"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-white placeholder-gray-400"
          placeholder="Escribe algo..."
        />
      </div>

      <div className="w-full h-[500px] bg-black rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
        {isMounted ? (
          <Canvas camera={{ position: [0, 0, 10], fov: 75 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <FloatingText text={inputText} />
            <OrbitControls enableZoom={true} enablePan={true} />
          </Canvas>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-gray-500">Cargando escena 3D...</p>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold mb-2 text-green-400">Interacción</h3>
          <p className="text-gray-300">Arrastra con el mouse para mover la cámara. Usa scroll para acercar/alejar.</p>
        </div>
        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold mb-2 text-blue-400">Personalización</h3>
          <p className="text-gray-300">Escribe cualquier texto en el campo de entrada para verlo en 3D.</p>
        </div>
        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold mb-2 text-purple-400">Tecnología</h3>
          <p className="text-gray-300">Basado en React, Three.js y Next.js para una experiencia fluida.</p>
        </div>
      </div>
    </div>
  );
}