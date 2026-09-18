'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Vector3 } from 'three';

// Tipos
interface SilhouettePoint {
  id: number;
  x: number;
  y: number;
  z: number;
}

interface Template {
  id: number;
  vertices: Vector3[];
  height: number;
}

interface MeshData {
  silhouette: SilhouettePoint[];
  templates: Template[];
  mesh: THREE.Group | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
}

// Configuración inicial
const INITIAL_TEMPLATES: Template[] = Array.from({ length: 5 }).map((_, i) => ({
  id: i,
  height: (i + 1) * 10,
  vertices: [
    new Vector3(-4 + i, 0, 0),
    new Vector3(-2 + i, 0, 0),
    new Vector3(0 + i, 0, 0),
    new Vector3(2 + i, 0, 0),
    new Vector3(4 + i, 0, 0),
    new Vector3(3 + i, 0, 0),
    new Vector3(1 + i, 0, 0),
    new Vector3(-1 + i, 0, 0),
  ],
}));

const INITIAL_SILHOUETTE: SilhouettePoint[] = [
  { id: 0, x: -4, y: 0, z: 0 },
  { id: 1, x: -2, y: 5, z: 0 },
  { id: 2, x: 0, y: 10, z: 0 },
  { id: 3, x: 2, y: 5, z: 0 },
  { id: 4, x: 4, y: 0, z: 0 },
];

export default function MeshEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'front' | 'side'>('front');
  const [showSilhouette, setShowSilhouette] = useState(true);
  const [showTemplates, setShowTemplates] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isAddingPoint, setIsAddingPoint] = useState(false);
  const [silhouettePoints, setSilhouettePoints] = useState<SilhouettePoint[]>(INITIAL_SILHOUETTE);
  const [meshData, setMeshData] = useState<MeshData>({
    silhouette: INITIAL_SILHOUETTE,
    templates: INITIAL_TEMPLATES,
    mesh: null,
    camera: null,
    renderer: null,
  });

  // Inicializar Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Escena
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Cámara
    const camera = new THREE.PerspectiveCamera(
      60,
      width / height,
      0.1,
      1000
    );
    camera.position.set(10, 10, 10);

    // Renderizador
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    // Controles de órbita
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Luces
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Grid
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Crear malla inicial
    createMeshFromSilhouette();

    // Manejar redimensionamiento
    const handleResize = () => {
      if (width && height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);

    // Animación
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      scene.traverse((object) => {
        if ((object as any).geometry) {
          (object as any).geometry.dispose();
        }
      });
    };
  }, []);

  // Actualizar malla cuando cambian los datos
  useEffect(() => {
    // Verificar si meshData.mesh existe antes de usarlo
    if (!meshData.mesh) {
      // Inicializar mesh si es null
      if (!meshData.camera) return;
      const newMesh = new THREE.Group();
      meshData.camera.add(newMesh);
      setMeshData(prev => ({ ...prev, mesh: newMesh }));
      return;
    }

    if (!meshData.camera) return;

    // Limpiar malla anterior
    while (meshData.mesh.children.length > 0) {
      meshData.mesh.remove(meshData.mesh.children[0]);
    }

    // Crear malla basada en silueta y plantillas
    createMeshFromSilhouette();

    // Actualizar vista
    updateCameraView();
  }, [meshData.silhouette, meshData.templates]);

  // Crear malla a partir de silueta y plantillas
  function createMeshFromSilhouette() {
    const { silhouette, templates } = meshData;
    
    // Verificar si los datos existen
    if (!silhouette || !templates || !meshData.mesh) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((silhouette.length + templates.length) * 3);
    const normals = new Float32Array((silhouette.length + templates.length) * 3);
    const colors = new Float32Array((silhouette.length + templates.length) * 3);

    let idx = 0;

    // Posiciones de los puntos de silueta
    silhouette.forEach((point, i) => {
      positions[idx * 3] = point.x;
      positions[idx * 3 + 1] = point.y;
      positions[idx * 3 + 2] = point.z;
      normals[idx * 3] = 0;
      normals[idx * 3 + 1] = 1;
      normals[idx * 3 + 2] = 0;
      colors[idx * 3] = 0.5;
      colors[idx * 3 + 1] = 0.5;
      colors[idx * 3 + 2] = 1;
      idx++;
    });

    // Posiciones de los puntos de las plantillas
    templates.forEach((template, i) => {
      template.vertices.forEach((vertex, j) => {
        positions[idx * 3] = vertex.x;
        positions[idx * 3 + 1] = vertex.y;
        positions[idx * 3 + 2] = vertex.z;
        normals[idx * 3] = 0;
        normals[idx * 3 + 1] = 1;
        normals[idx * 3 + 2] = 0;
        colors[idx * 3] = 0.3;
        colors[idx * 3 + 1] = 0.3;
        colors[idx * 3 + 2] = 0.7;
        idx++;
      });
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    meshData.mesh.add(mesh);

    // Crear líneas de conexión
    createConnectionLines();
  }

  // Crear líneas de conexión entre puntos
  function createConnectionLines() {
    const { silhouette, templates } = meshData;
    
    // Verificar si meshData.mesh existe
    if (!meshData.mesh) return;

    // Limpiar líneas anteriores
    while (meshData.mesh.children.length > 0) {
      meshData.mesh.remove(meshData.mesh.children[0]);
    }

    const lineSegments = new THREE.LineSegments();
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((silhouette.length + templates.length) * 3);

    // Puntos de silueta
    silhouette.forEach((point, i) => {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    });

    // Puntos de plantillas
    templates.forEach((template, i) => {
      template.vertices.forEach((vertex, j) => {
        positions[(i * template.vertices.length + j) * 3] = vertex.x;
        positions[(i * template.vertices.length + j) * 3 + 1] = vertex.y;
        positions[(i * template.vertices.length + j) * 3 + 2] = vertex.z;
      });
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 });
    lineSegments.geometry = geometry;
    lineSegments.material = material;
    meshData.mesh.add(lineSegments);
  }

  // Actualizar vista de cámara
  function updateCameraView() {
    const camera = meshData.camera;
    if (!camera) return;

    if (viewMode === 'front') {
      camera.position.set(0, 0, 20);
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(20, 0, 0);
      camera.lookAt(0, 0, 0);
    }
  }

  // Manejar clic en punto de silueta
  const handleSilhouetteClick = (e: React.MouseEvent, point: SilhouettePoint) => {
    e.stopPropagation();
    if (isAddingPoint) {
      setSilhouettePoints([...silhouettePoints, { ...point, id: Date.now() }]);
    } else {
      setSelectedPoint(point.id);
    }
  };

  // Manejar clic en punto de silueta para eliminar
  const handleSilhouetteDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setSilhouettePoints(silhouettePoints.filter((p) => p.id !== id));
    setSelectedPoint(null);
  };

  // Manejar clic en punto de plantilla
  const handleTemplateClick = (e: React.MouseEvent, template: Template) => {
    e.stopPropagation();
    if (isAddingPoint) {
      const newTemplate = { ...template, id: Date.now() };
      setMeshData({
        ...meshData,
        templates: [...meshData.templates, newTemplate],
      });
    }
  };

  // Manejar clic en canvas
  const handleCanvasClick = () => {
    setIsAddingPoint(false);
    setSelectedPoint(null);
  };

  // Manejar clic en modo agregar punto
  const handleAddPointClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (viewMode === 'front') {
      const zOffset = x * 20 - 10;
      const yRange = [-10, 10];
      const xRange = [-10, 10];
      const newX = xRange[Math.floor(Math.random() * xRange.length)];
      const newY = yRange[Math.floor(Math.random() * yRange.length)];
      const newPoint: SilhouettePoint = {
        id: Date.now(),
        x: newX,
        y: newY,
        z: zOffset,
      };
      setSilhouettePoints([...silhouettePoints, newPoint]);
    } else {
      const yRange = [-10, 10];
      const xRange = [-10, 10];
      const newX = xRange[Math.floor(Math.random() * xRange.length)];
      const newY = yRange[Math.floor(Math.random() * yRange.length)];
      const newPoint: SilhouettePoint = {
        id: Date.now(),
        x: newX,
        y: newY,
        z: 0,
      };
      setSilhouettePoints([...silhouettePoints, newPoint]);
    }
  };

  // Manejar clic en modo editar silueta
  const handleEditSilhouetteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (viewMode === 'front') {
      const zOffset = x * 20 - 10;
      const yRange = [-10, 10];
      const xRange = [-10, 10];
      const newX = xRange[Math.floor(Math.random() * xRange.length)];
      const newY = yRange[Math.floor(Math.random() * yRange.length)];
      const newPoint: SilhouettePoint = {
        id: Date.now(),
        x: newX,
        y: newY,
        z: zOffset,
      };
      setSilhouettePoints([...silhouettePoints, newPoint]);
    } else {
      const yRange = [-10, 10];
      const xRange = [-10, 10];
      const newX = xRange[Math.floor(Math.random() * xRange.length)];
      const newY = yRange[Math.floor(Math.random() * yRange.length)];
      const newPoint: SilhouettePoint = {
        id: Date.now(),
        x: newX,
        y: newY,
        z: 0,
      };
      setSilhouettePoints([...silhouettePoints, newPoint]);
    }
  };

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Panel de controles */}
      <div className="w-64 bg-gray-800 p-4 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-white mb-4">Editor de Malla</h1>

        <div className="space-y-2">
          <label className="text-gray-300">Modo de vista</label>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('front')}
              className={`flex-1 p-2 rounded ${
                viewMode === 'front'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Frente
            </button>
            <button
              onClick={() => setViewMode('side')}
              className={`flex-1 p-2 rounded ${
                viewMode === 'side'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Lateral
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-gray-300">Opciones</label>
          <button
            onClick={() => setShowSilhouette(!showSilhouette)}
            className={`w-full p-2 rounded ${
              showSilhouette
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Mostrar Silueta
          </button>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className={`w-full p-2 rounded ${
              showTemplates
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Mostrar Plantillas
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-gray-300">Modo de edición</label>
          <button
            onClick={() => setIsAddingPoint(true)}
            className="w-full p-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Agregar Punto
          </button>
          <button
            onClick={() => {
              setIsAddingPoint(false);
              setSelectedPoint(null);
            }}
            className="w-full p-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Cancelar Edición
          </button>
        </div>

        <div className="mt-auto space-y-2">
          <label className="text-gray-300">Puntos de silueta: {silhouettePoints.length}</label>
          <label className="text-gray-300">Plantillas: {meshData.templates.length}</label>
          <button
            onClick={() => {
              console.log('Generar malla', {
                silhouette: silhouettePoints,
                templates: meshData.templates,
              });
            }}
            className="w-full p-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Generar Malla
          </button>
        </div>
      </div>

      {/* Panel de silueta */}
      {showSilhouette && (
        <div className="w-64 bg-gray-800 p-4 flex flex-col gap-4">
          <h2 className="text-lg font-bold text-white">Silueta</h2>
          <div className="flex-1 bg-gray-900 rounded overflow-auto">
            <div className="p-2 space-y-1">
              {silhouettePoints.map((point) => (
                <div
                  key={point.id}
                  onClick={(e) => handleSilhouetteClick(e, point)}
                  className={`p-2 rounded cursor-pointer ${
                    selectedPoint === point.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <div className="font-mono text-sm">
                    P {point.id}: ({point.x.toFixed(1)}, {point.y.toFixed(1)}, {point.z.toFixed(1)})
                  </div>
                  {selectedPoint === point.id && (
                    <button
                      onClick={(e) => handleSilhouetteDelete(e, point.id)}
                      className="ml-2 text-red-400 hover:text-red-300"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Panel de plantillas */}
      {showTemplates && (
        <div className="w-64 bg-gray-800 p-4 flex flex-col gap-4">
          <h2 className="text-lg font-bold text-white">Plantillas</h2>
          <div className="flex-1 bg-gray-900 rounded overflow-auto">
            <div className="p-2 space-y-1">
              {meshData.templates.map((template) => (
                <div
                  key={template.id}
                  onClick={(e) => handleTemplateClick(e, template)}
                  className={`p-2 rounded cursor-pointer ${
                    isAddingPoint
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <div className="font-mono text-sm">
                    T {template.id}: {template.vertices.length} vértices
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Canvas 3D */}
      <div ref={containerRef} className="flex-1 bg-gray-900" />
    </div>
  );
}
