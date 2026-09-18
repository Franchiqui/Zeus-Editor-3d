'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Box } from 'lucide-react';
import { type Mesh } from '@/lib/geometry';

/**
 * Triangula la malla guardada (cada cara abanica en triángulos, como en
 * el visor 3D), la centra en el origen y la reescala para que quepa en
 * la vista venga del tamaño que venga. null si no tiene caras
 * utilizables.
 */
function buildPreviewGeometry(mesh: Mesh): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const face of mesh.faces) {
    if (face.length < 3) continue;
    const v0 = mesh.vertices[face[0]];
    const v1 = mesh.vertices[face[1]];
    const v2 = mesh.vertices[face[2]];
    if (!v0 || !v1 || !v2) continue;
    const baseIdx = positions.length / 3;
    for (const idx of face) {
      const v = mesh.vertices[idx];
      if (!v) continue;
      positions.push(v.x, v.y, v.z);
    }
    for (let i = 1; i < face.length - 1; i++) {
      indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
    }
  }
  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const sphere = geometry.boundingSphere;
  if (sphere) {
    geometry.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
    const scale = sphere.radius > 1e-6 ? 0.9 / sphere.radius : 1;
    geometry.scale(scale, scale, scale);
  }
  return geometry;
}

/**
 * Color de la figura guardada: el primero que traiga la malla (todas
 * las caras comparten el color configurado) o el verde del editor.
 */
function figureColorOf(mesh: Mesh): THREE.ColorRepresentation {
  const color = mesh.faceColors?.find((c) => typeof c === 'string');
  return color ?? '#44cc66';
}

/**
 * Vista previa 3D de un objeto guardado (.zeus) para el modal "Objeto 3D":
 * la figura del archivo girando despacio, igual que la vista previa de
 * texturas del explorador (el plano y la esfera).
 */
export default function Object3DPreview({ mesh }: { mesh: Mesh | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const animIdRef = useRef<number>(0);
  const textureTokenRef = useRef(0);

  // Escena fija (cámara, luces, suelo): se monta una sola vez
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('hsl(224, 50%, 7%)');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.4, 3);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(4, 8, 0x44506a, 0x333a4a);
    grid.position.y = -1.0;
    scene.add(grid);

    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      if (meshRef.current) meshRef.current.rotation.y += 0.005;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animIdRef.current);
      renderer.dispose();
      if (textureRef.current) textureRef.current.dispose();
    };
  }, []);

  // La figura del archivo: se reconstruye al cambiar el mesh (hover)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // La figura anterior sale de la escena y se libera
    const old = meshRef.current;
    if (old) {
      scene.remove(old);
      old.geometry.dispose();
      meshRef.current = null;
    }
    if (materialRef.current) {
      materialRef.current.dispose();
      materialRef.current = null;
    }
    if (textureRef.current) {
      textureRef.current.dispose();
      textureRef.current = null;
    }

    if (!mesh || mesh.vertices.length === 0) return;

    const geometry = buildPreviewGeometry(mesh);
    if (!geometry) return;

    const hasTexture =
      typeof mesh.texture === 'string' && mesh.texture.startsWith('data:');
    const material = new THREE.MeshPhysicalMaterial({
      color: hasTexture ? 0xffffff : figureColorOf(mesh),
      metalness: 0.15,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    materialRef.current = material;

    if (hasTexture) {
      // Si se pasa a otro objeto antes de cargar, la textura vieja se
      // descarta (token de la carga más reciente)
      const token = ++textureTokenRef.current;
      new THREE.TextureLoader().load(mesh.texture as string, (texture) => {
        if (token !== textureTokenRef.current) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        material.map = texture;
        material.needsUpdate = true;
        textureRef.current = texture;
      });
    }

    const meshObj = new THREE.Mesh(geometry, material);
    meshObj.rotation.x = 0.15;
    scene.add(meshObj);
    meshRef.current = meshObj;
  }, [mesh]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-square rounded-lg border border-white/10 bg-[hsl(224_50%_7%)]"
      style={{ containerType: 'size' }}
    />
  );
}

// Un solo contexto WebGL compartido por TODAS las miniaturas: el
// navegador limita los contextos activos y una escena por tarjeta
// agotaría el cupo en cuanto hubiera unos cuantos objetos.
let thumbnailRenderer: THREE.WebGLRenderer | null = null;
function getThumbnailRenderer() {
  if (!thumbnailRenderer) {
    thumbnailRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    thumbnailRenderer.setPixelRatio(1);
    thumbnailRenderer.setSize(192, 192);
  }
  return thumbnailRenderer;
}

/**
 * Dibuja la figura una sola vez (vista en tres cuartos, luces de la
 * vista previa grande) y la devuelve congelada como PNG (data URL).
 */
function renderMeshThumbnail(mesh: Mesh): Promise<string> {
  return new Promise((resolve) => {
    const geometry = buildPreviewGeometry(mesh);
    if (!geometry) {
      resolve('');
      return;
    }

    const material = new THREE.MeshPhysicalMaterial({
      color: figureColorOf(mesh),
      metalness: 0.15,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    const meshObj = new THREE.Mesh(geometry, material);
    meshObj.rotation.set(0.3, 0.6, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);
    scene.add(meshObj);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.4, 3);
    camera.lookAt(0, 0, 0);

    const renderer = getThumbnailRenderer();
    const capture = (texture: THREE.Texture | null) => {
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      scene.remove(meshObj);
      geometry.dispose();
      material.dispose();
      if (texture) texture.dispose();
      resolve(url);
    };

    const hasTexture =
      typeof mesh.texture === 'string' && mesh.texture.startsWith('data:');
    if (hasTexture) {
      // Con textura hay que esperar a que cargue antes de congelar la
      // imagen; si está rota, se captura sin ella
      material.color.set(0xffffff);
      new THREE.TextureLoader().load(
        mesh.texture as string,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          material.map = texture;
          material.needsUpdate = true;
          capture(texture);
        },
        undefined,
        () => capture(null)
      );
    } else {
      capture(null);
    }
  });
}

/**
 * Miniatura de un objeto guardado para las tarjetas del modal "Objeto
 * 3D": su figura dibujada en 3D y congelada como imagen (como las
 * miniaturas del explorador de texturas).
 *
 * - mesh === undefined: la figura todavía se está leyendo (marcador
 *   parpadeante).
 * - mesh === null: el archivo no trae figura (marcador fijo).
 */
export function Object3DThumbnail({
  mesh,
}: {
  mesh: Mesh | null | undefined;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!mesh || mesh.vertices.length === 0) return;
    renderMeshThumbnail(mesh)
      .then((u) => {
        if (!cancelled && u) setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mesh]);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className="w-full h-full object-contain"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Box
        className={
          mesh === undefined
            ? 'w-6 h-6 text-green-400/40 animate-pulse'
            : 'w-6 h-6 text-green-400/40'
        }
      />
    </div>
  );
}