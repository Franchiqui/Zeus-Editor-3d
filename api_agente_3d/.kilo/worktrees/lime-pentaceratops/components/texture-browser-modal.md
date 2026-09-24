'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getLocalPaths, listDirectory, getMediaUrl } from '@/lib/electron-fs';
import { Modal } from '@/components/ui/modal';
import { ImageIcon, FolderOpen, Loader2, LayoutGrid, Circle, Folder } from 'lucide-react';
import { Mode } from 'fs';

interface TextureItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  category?: string;
}

type ViewMode = 'planar' | 'spherical';
type PreviewFinish = 'semi-matte' | 'matte' | 'glossy';

interface TextureBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTexture: (dataUrl: string, fileName: string) => void;
  mode: Mode;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.tga', '.dds'];

function isImageFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

// Opciones de acabado para el selector
const FINISH_OPTIONS = [
  { label: 'Semimate', value: 'semi-matte' },
  { label: 'Mate', value: 'matte' },
  { label: 'Brillo', value: 'glossy' },
];

function TexturePreview({
  textureUrl,
  viewMode,
  finish,
}: {
  textureUrl: string | null;
  viewMode: ViewMode;
  finish: PreviewFinish;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const animIdRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('hsl(224, 50%, 7%)');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    const geometry = new THREE.SphereGeometry(0.8, 32, 32);

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: finish === 'glossy' ? 0.3 : finish === 'matte' ? 0.05 : 0.15,
      roughness: finish === 'glossy' ? 0.1 : finish === 'matte' ? 0.9 : 0.45,
      clearcoat: finish === 'glossy' ? 1 : 0,
      clearcoatRoughness: 0.015,
      side: THREE.DoubleSide,
      map: null,
      bumpMap: null,
      bumpScale: 0.1,
      transparent: true,
      opacity: 1,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;

    const gridHelper = new THREE.GridHelper(4, 8, 0x44506a, 0x333a4a);
    gridHelper.position.y = -1.0;
    scene.add(gridHelper);

    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      if (meshRef.current) {
        meshRef.current.rotation.y += 0.005;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animIdRef.current);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (textureRef.current) textureRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    if (!rendererRef.current || !sceneRef.current || !meshRef.current || !materialRef.current) return;

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const mesh = meshRef.current;
    const material = materialRef.current;

    if (textureUrl && textureUrl.startsWith('data:')) {
      const loader = new THREE.TextureLoader();
      loader.load(textureUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        material.map = texture;
        material.bumpMap = texture;
        material.bumpScale = 0.1;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        textureRef.current = texture;
      }, undefined, (error) => {
        console.error('Error loading texture:', error);
      });
    } else {
      material.map = null;
      material.bumpMap = null;
      material.needsUpdate = true;
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
    }
  }, [textureUrl]);

  useEffect(() => {
    if (!materialRef.current) return;
    const m = materialRef.current;
    m.metalness = finish === 'glossy' ? 0.3 : finish === 'matte' ? 0.05 : 0.15;
    m.roughness = finish === 'glossy' ? 0.1 : finish === 'matte' ? 0.9 : 0.45;
    m.clearcoat = finish === 'glossy' ? 1 : 0;
    m.needsUpdate = true;
  }, [finish]);

  useEffect(() => {
    if (!sceneRef.current || !meshRef.current) return;
    const scene = sceneRef.current;
    const oldMesh = meshRef.current;
    scene.remove(oldMesh);
    oldMesh.geometry.dispose();

    const geometry = viewMode === 'planar'
      ? new THREE.PlaneGeometry(2, 2)
      : new THREE.SphereGeometry(0.8, 32, 32);

    const mesh = new THREE.Mesh(geometry, oldMesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;
  }, [viewMode]);

  useEffect(() => {
    if (!sceneRef.current || !meshRef.current) return;
    const scene = sceneRef.current;
    const oldMesh = meshRef.current;
    scene.remove(oldMesh);
    oldMesh.geometry.dispose();

    const geometry = viewMode === 'planar'
      ? new THREE.PlaneGeometry(2, 2)
      : new THREE.CylinderGeometry(0.7, 0.7, 1.2, 32, 1, false);

    const mesh = new THREE.Mesh(geometry, oldMesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;
  }, [viewMode]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-square rounded-lg border border-white/10 bg-[hsl(224_50%_7%)]"
      style={{ containerType: 'size' }}
    />
  );
}

export default function TextureBrowserModal({
  isOpen,
  onClose,
  onSelectTexture,
  mode,
}: TextureBrowserModalProps) {
  const [textureFolder, setTextureFolder] = useState<string | null>(null);
  const [items, setItems] = useState<TextureItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('todas');
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('spherical');
  const [previewFinish, setPreviewFinish] = useState<PreviewFinish>('semi-matte');
  const [previewTextureUrl, setPreviewTextureUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const paths = await getLocalPaths();
        const folder = paths.texturas || paths.objetos_3d || paths.objetos || null;
        if (!folder) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (!cancelled) {
          setTextureFolder(folder);
          const items = await listDirectory(folder);
          
          // Separar archivos y carpetas
          const directories = items.filter((item: TextureItem) => item.isDirectory);
          const images = items.filter((item: TextureItem) => !item.isDirectory && isImageFile(item.name));
          
          // Si hay subcarpetas, cargar texturas de cada una y asignar categoría
          let categorizedItems: TextureItem[] = [];
          let categoryList: string[] = [];
          
          if (directories.length > 0) {
            // Hay subcarpetas: tratar cada subcarpeta como una categoría
            categoryList = directories.map((d: TextureItem) => d.name);
            
            // Cargar imágenes de cada subcarpeta
            for (const dir of directories) {
              try {
                const subItems = await listDirectory(dir.path);
                const subImages = subItems
                  .filter((item: TextureItem) => !item.isDirectory && isImageFile(item.name))
                  .map((item: TextureItem) => ({
                    ...item,
                    category: dir.name
                  }));
                categorizedItems = [...categorizedItems, ...subImages];
              } catch (e) {
                console.error(`Error loading subfolder ${dir.name}:`, e);
              }
            }
            
            // También cargar imágenes de la carpeta principal como "General"
            if (images.length > 0) {
              const mainImages = images.map((item: TextureItem) => ({
                ...item,
                category: 'General'
              }));
              categorizedItems = [...categorizedItems, ...mainImages];
              categoryList.unshift('General');
            }
          } else {
            // No hay subcarpetas: todas las imágenes son "General"
            categorizedItems = images.map((item: TextureItem) => ({
              ...item,
              category: 'General'
            }));
            categoryList = ['General'];
          }
          
          const sortedItems = categorizedItems.sort((a: TextureItem, b: TextureItem) => a.name.localeCompare(b.name));
          setItems(sortedItems);
          setCategories(categoryList);
          setSelectedCategory('todas');
        }
      } catch (e) {
        console.error('Error loading texture folder:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSelectTexture = useCallback((item: TextureItem) => {
    const dataUrl = getMediaUrl(item.path);
    setPreviewTextureUrl(dataUrl);
    setPreviewFileName(item.name);
  }, []);

  const handleConfirmTexture = useCallback(() => {
    if (previewTextureUrl && previewFileName) {
      onSelectTexture(previewTextureUrl, previewFileName);
      onClose();
    }
  }, [previewTextureUrl, previewFileName, onSelectTexture, onClose]);

  const filteredItems = useMemo(() => {
    if (selectedCategory === 'todas') {
      return items;
    }
    return items.filter(item => item.category === selectedCategory);
  }, [items, selectedCategory]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Explorador de Texturas"
      description="Navega por las texturas de la carpeta configurada."
      size="2xl"
    >
      <div className="flex flex-col h-[75vh]">
        {/* Ruta de la carpeta */}
        <div className="flex items-center gap-2 px-3 py-2 bg-black/40 rounded-md border border-white/10 mb-3">
          <FolderOpen className="w-4 h-4 text-green-400 shrink-0" />
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {textureFolder || 'Sin carpeta de texturas configurada'}
          </span>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <ImageIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No se han encontrado texturas en esta carpeta.
                <br />
                Asegúrate de que la carpeta está configurada correctamente.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 gap-3">
            {/* Lista de texturas */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Selector de categorías */}
              {categories.length > 1 && (
                <div className="px-3 py-2 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Folder className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-semibold text-foreground">
                      Categorías:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedCategory('todas')}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        selectedCategory === 'todas'
                          ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                          : 'bg-black/40 text-muted-foreground border border-white/10 hover:text-foreground'
                      }`}
                    >
                      <LayoutGrid className="w-3 h-3" />
                      Todas ({items.length})
                    </button>
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          selectedCategory === category
                            ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                            : 'bg-black/40 text-muted-foreground border border-white/10 hover:text-foreground'
                        }`}
                      >
                        <Folder className="w-3 h-3" />
                        {category} ({items.filter(item => item.category === category).length})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-3 py-2 mb-2">
                <span className="text-xs font-semibold text-foreground">
                  Texturas ({filteredItems.length})
                </span>
              </div>

              {/* Grid de texturas */}
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {filteredItems.map((item) => (
                    <button
                      key={item.path}
                      onClick={() => handleSelectTexture(item)}
                      className={`group relative aspect-square rounded-md overflow-hidden border transition-all ${
                        previewTextureUrl === getMediaUrl(item.path)
                          ? 'border-green-500 ring-2 ring-green-500/50'
                          : 'border-white/10 bg-black/20 hover:border-green-500/50'
                      }`}
                    >
                      <img
                        src={getMediaUrl(item.path)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-green-400" />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/80 to-transparent">
                        <span className="text-[9px] text-white truncate block">{item.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Panel de vista previa */}
            <div className="w-80 flex flex-col gap-3">
              <div className="px-3 py-2">
                <span className="text-xs font-semibold text-foreground">
                  Vista previa
                </span>
              </div>

              {/* Vista previa 3D y controles */}
              <div className="flex flex-col gap-3 px-2">
                {/* Toggle vista plana / esférica */}
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/40 p-0.5">
                  <button
                    onClick={() => setViewMode('planar')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      viewMode === 'planar'
                        ? 'bg-green-500/20 text-green-300'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title="Vista plana"
                  >
                    <LayoutGrid className="w-3 h-3" />
                    Vista Plana
                  </button>
                  <button
                    onClick={() => setViewMode('spherical')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      viewMode === 'spherical'
                        ? 'bg-green-500/20 text-green-300'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title="Vista esférica"
                  >
                    <Circle className="w-3 h-3" />
                    Esfera
                  </button>
                </div>

                {/* Selector de acabado */}
                <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/40 p-0.5">
                  {FINISH_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setPreviewFinish(option.value as PreviewFinish)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        previewFinish === option.value
                          ? 'bg-green-500/20 text-green-300'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Canvas de vista previa */}
              <div className="px-2">
                <TexturePreview
                  textureUrl={previewTextureUrl}
                  viewMode={viewMode}
                  finish={previewFinish}
                />
              </div>

              {/* Nombre de textura seleccionada */}
              {previewFileName && (
                <div className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {previewFileName}
                  </span>
                </div>
              )}

              {/* Botón de confirmación */}
              <div className="px-3 py-2 mt-auto">
                <button
                  onClick={handleConfirmTexture}
                  disabled={!previewTextureUrl}
                  className={`w-full py-2 rounded-md text-sm font-medium transition-colors ${
                    previewTextureUrl
                      ? 'bg-green-500 hover:bg-green-600 text-white'
                      : 'bg-white/10 text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  Confirmar selección
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
