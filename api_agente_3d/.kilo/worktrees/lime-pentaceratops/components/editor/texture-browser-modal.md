'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getLocalPaths, listDirectory, getMediaUrl } from '@/lib/electron-fs';
import { Modal } from '@/components/ui/modal';
import { ImageIcon, FolderOpen, Loader2, LayoutGrid, Circle } from 'lucide-react';

interface TextureItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface Category {
  name: string;
  path: string;
  items: TextureItem[];
}

type Mode = 'views' | 'text' | 'lathe';
type ViewMode = 'planar' | 'cylindrical';
type PreviewFinish = 'semi-matte' | 'matte' | 'glossy';

interface TextureBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTexture: (dataUrl: string, fileName: string) => void;
  mode: Mode;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.tga', '.dds'];
const FINISH_OPTIONS: { value: PreviewFinish; label: string }[] = [
  { value: 'semi-matte', label: 'Semimate' },
  { value: 'matte', label: 'Mate' },
  { value: 'glossy', label: 'Brillo' },
];

function isImageFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

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

    const geometry = viewMode === 'planar'
      ? new THREE.PlaneGeometry(2, 2)
      : new THREE.CylinderGeometry(0.7, 0.7, 1.2, 32, 1, false);

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
      mesh.rotation.y += 0.005;
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('planar');
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
          const subfolders = items
            .filter((item: TextureItem) => item.isDirectory)
            .sort((a: TextureItem, b: TextureItem) => a.name.localeCompare(b.name));
          const rootImages = items
            .filter((item: TextureItem) => !item.isDirectory && isImageFile(item.name))
            .sort((a: TextureItem, b: TextureItem) => a.name.localeCompare(b.name));

          const cats: Category[] = subfolders.map((sf: TextureItem) => ({
            name: sf.name,
            path: sf.path,
            items: [],
          }));

          if (rootImages.length > 0) {
            cats.unshift({
              name: 'General',
              path: folder,
              items: rootImages,
            });
          }

          setCategories(cats);
          if (cats.length > 0 && !selectedCategory) {
            setSelectedCategory(cats[0].name);
          }
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

  useEffect(() => {
    if (!isOpen) {
      setSelectedCategory(null);
      setPreviewTextureUrl(null);
      setPreviewFileName('');
    }
  }, [isOpen]);

  const loadCategory = useCallback(async (cat: Category) => {
    if (cat.items.length > 0) return;
    setLoadingCategory(cat.name);
    try {
      const items = await listDirectory(cat.path);
      const images = items
        .filter((item: TextureItem) => !item.isDirectory && isImageFile(item.name))
        .sort((a: TextureItem, b: TextureItem) => a.name.localeCompare(b.name));
      setCategories(prev =>
        prev.map(c => c.name === cat.name ? { ...c, items: images } : c)
      );
    } catch (e) {
      console.error('Error loading category:', e);
    } finally {
      setLoadingCategory(null);
    }
  }, []);

  const selectedCategoryData = useMemo(
    () => categories.find(c => c.name === selectedCategory) ?? null,
    [categories, selectedCategory]
  );

  useEffect(() => {
    if (selectedCategory && selectedCategoryData && selectedCategoryData.items.length === 0) {
      loadCategory(selectedCategoryData);
    }
  }, [selectedCategory, selectedCategoryData, loadCategory]);

  const handleSelectTexture = useCallback((item: TextureItem) => {
    const dataUrl = getMediaUrl(item.path);
    setPreviewTextureUrl(dataUrl);
    setPreviewFileName(item.name);
    onSelectTexture(dataUrl, item.name);
    onClose();
  }, [onSelectTexture, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Explorador de Texturas"
      description="Navega por las carpetas de texturas. Cada carpeta es una categoría."
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
        ) : categories.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <ImageIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No se ha configurado una carpeta de texturas.
                <br />
                Configúrala en Archivos → Configurar Carpetas Multimedia.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 gap-3">
            {/* Lista de categorías */}
            <div className="w-44 shrink-0 flex flex-col gap-1 overflow-y-auto pr-2 border-r border-white/5">
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => {
                    setSelectedCategory(cat.name);
                    loadCategory(cat);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left ${
                    selectedCategory === cat.name
                      ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{cat.name}</span>
                </button>
              ))}
            </div>

            {/* Contenido de la categoría */}
            <div className="flex-1 min-w-0 flex flex-col">
              {selectedCategoryData && (
                <>
                  <div className="flex items-center justify-between px-3 py-2 mb-2">
                    <span className="text-xs font-semibold text-foreground">
                      {selectedCategoryData.name}
                      <span className="text-muted-foreground font-normal ml-2">
                        ({selectedCategoryData.items.length} texturas)
                      </span>
                    </span>
                  </div>

                  {/* Vista previa 3D y controles */}
                  <div className="flex items-center gap-3 mb-3 px-2">
                    {/* Toggle vista plana / circular */}
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
                        onClick={() => setViewMode('cylindrical')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          viewMode === 'cylindrical'
                            ? 'bg-green-500/20 text-green-300'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title="Vista circular"
                      >
                        <Circle className="w-3 h-3" />
                        Circular
                      </button>
                    </div>

                    {/* Selector de acabado */}
                    <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/40 p-0.5">
                      {FINISH_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setPreviewFinish(opt.value)}
                          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                            previewFinish === opt.value
                              ? 'bg-green-500/20 text-green-300'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {previewFileName && (
                      <span className="text-[10px] font-mono text-green-400/70 truncate ml-auto">
                        {previewFileName}
                      </span>
                    )}
                  </div>

                  {/* Vista previa 3D */}
                  <div className="flex justify-center mb-3">
                    <TexturePreview
                      textureUrl={previewTextureUrl}
                      viewMode={viewMode}
                      finish={previewFinish}
                    />
                  </div>

                  {/* Lista de texturas */}
                  {loadingCategory === selectedCategory ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-3 gap-2 content-start">
                      {selectedCategoryData.items.length === 0 ? (
                        <div className="col-span-3 flex items-center justify-center py-8">
                          <p className="text-sm text-muted-foreground">
                            Sin texturas en esta categoría.
                          </p>
                        </div>
                      ) : (
                        selectedCategoryData.items.map((item) => (
                          <button
                            key={item.path}
                            onClick={() => handleSelectTexture(item)}
                            className="group relative rounded-lg border border-white/10 overflow-hidden hover:border-green-500/50 transition-colors bg-black/30"
                          >
                            <img
                              src={getMediaUrl(item.path)}
                              alt={item.name}
                              className="w-full aspect-square object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-end">
                              <span className="w-full text-[10px] text-white/80 px-2 py-1 truncate">
                                {item.name}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
