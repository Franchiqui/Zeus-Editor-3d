'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Mesh, Vertex3D, LatheTextureProjection } from '@/lib/geometry';
import { evaluateTrack } from '@/lib/animation';
import type { AnimationTrack, Keyframe, KeyframeProperty } from '@/lib/animation';
import { smoothVoxelMesh } from '@/lib/mesh-smooth';
import { Slider } from '@/components/ui/slider';
import {
  RotateCcw,
  Maximize2,
  Box,
  Grid3x3,
  Crosshair,
  Spline,
  Sun,
  Camera,
  Sparkles,
  Sparkle,
  Zap,
  Flame,
  Star,
  Pin,
} from 'lucide-react';

// Presets de iluminación: "Natural" (blanca neutra) es el predeterminado.
const LIGHT_PRESETS = [
  {
    name: 'Natural',
    ambient: 0xffffff, ambientIntensity: 0.9,
    dir: 0xffffff, dirIntensity: 1.1,
    fill: 0xffffff, fillIntensity: 0.35,
    rim: 0xffffff, rimIntensity: 0.35,
  },
  {
    name: 'Estudio',
    ambient: 0xffffff, ambientIntensity: 0.5,
    dir: 0xffffff, dirIntensity: 1.6,
    fill: 0xffffff, fillIntensity: 0.5,
    rim: 0xffffff, rimIntensity: 0.5,
  },
  {
    name: 'Cálido',
    ambient: 0xffe4c0, ambientIntensity: 0.85,
    dir: 0xffd9a3, dirIntensity: 1.0,
    fill: 0xfff1de, fillIntensity: 0.35,
    rim: 0xffcf9a, rimIntensity: 0.4,
  },
  {
    name: 'Frío',
    ambient: 0xdde9ff, ambientIntensity: 0.85,
    dir: 0xe6f0ff, dirIntensity: 1.0,
    fill: 0xcfe2ff, fillIntensity: 0.4,
    rim: 0xbcd6ff, rimIntensity: 0.4,
  },
];

export type Camera3D = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotationX: number;
  rotationY: number;
};

export interface SpotlightConfig {
  id: string;
  enabled: boolean;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  color: number;
  intensity: number;
  angle: number;
  penumbra: number;
  castShadow: boolean;
  shadowIntensity: number;
  shadowColor: number;
}

export interface LightConfig {
  ambient: {
    enabled: boolean;
    color: number;
    intensity: number;
  };
  spotlights: SpotlightConfig[];
}

const IDENTITY_CAMERA3D: Camera3D = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotationX: 0,
  rotationY: 0,
};

interface Viewer3DProps {
  mesh: Mesh;
  objects?: Array<{
    id: string;
    transform: ObjectTransform;
    /**
     * Instantánea de malla del objeto (solo la traen los pegados desde
     * otra pestaña): sirve para reconstruir su visual donde no hay copia,
     * en vez de clonar la figura que está activa en esa pestaña.
     */
    mesh?: Mesh;
    /** La malla original se veía con normales suaves (no facetadas) */
    smooth?: boolean;
    /** Proyección con la que se mapeaba su textura */
    textureProjection?: LatheTextureProjection;
  }>;
  /**
   * Objeto dueño de la configuración actual: su figura es la malla que
   * el editor está construyendo ahora. Los demás objetos de la escena
   * son copias congeladas con su propia instantánea.
   */
   configObjectId?: string | null;
   /** Malla del dueño de la configuración (para su copia en la escena) */
   configMesh?: Mesh;
   /** Objeto cortador en modo boolean preview: se muestra transparente */
   booleanToolObjectId?: string | null;
   /** Fuerza re-render del objects-loop (preview boolean, etc.) */
   forceObjectsUpdate?: number;
  /** El dueño de la configuración se ve con normales suaves */
  configSmooth?: boolean;
  /** Proyección con la que se mapea la textura del dueño */
  configProjection?: LatheTextureProjection;
  selectedObjectId?: string;
  onObjectSelect?: (id: string) => void;
  onVerticesChange?: (vertices: Vertex3D[]) => void;
  showVerticesDefault?: boolean;
  camera3D?: Camera3D;
  /** Notifica al padre cuando el usuario mueve la cámara con el ratón/scroll,
   *  para que pueda mantener su estado (panelCameras) sincronizado con la
   *  posición real de la cámara. Sin esto, los botones de pan saltan al origen. */
  onCameraChange?: (cam: Camera3D) => void;
  /** Called continuously while recording a camera path */
  onCameraMove?: (cam: Camera3D) => void;
  /**
   * Sombreado suave (normales por vértice): para mallas generadas por
   * cortes a partir de las plantillas, cuyas caras son cuadriláteros de
   * una superficie continua — sin él, cada banda entre cortes se marca
   * como si el objeto estuviera hecho de capas apiladas.
   */
  smoothShading?: boolean;
  /** Muestra el eje vertical de revolución del torno. */
  showLatheAxis?: boolean;
  textureProjection?: LatheTextureProjection;
  /**
   * Pieza amarilla de la ayuda de proyección: el marco editable de la
   * textura (rectángulo plano, tubo cilíndrico o esfera) que se ve al
   * lado/alrededor de la figura y se puede mover, girar y estirar con
   * su propio manipulador para colocar la textura a mano.
   */
  textureHelper?: boolean;
  /** Posición, rotación y escala de la pieza (las fija su manipulador) */
  textureHelperTransform?: ObjectTransform;
  onTextureHelperTransform?: (t: ObjectTransform) => void;
  /**
   * Manipulador: muestra sobre el objeto las flechas X, Y y Z. Arrastrar
   * la flecha (o la bolita del COLOR DEL EJE) mueve el objeto en esa
   * dirección, la bolita AMARILLA lo estira a lo largo de esa dirección
   * y el ARO del color del eje lo rota alrededor de ese eje.
   */
   gizmo?: boolean;
  /** Posición, rotación y escala actuales del objeto (las fija el manipulador) */
  objectTransform?: ObjectTransform;
  onObjectTransform?: (t: ObjectTransform) => void;
   /** Configuración de luces personalizadas. Cuando se proporciona,
       reemplaza los valores del preset de iluminación. */
  lightConfig?: LightConfig | null;
   /** Notifica al padre cuando una luz fue movida/editada en la escena. */
   onLightConfigChange?: (config: LightConfig) => void;
   /** Mostrar los ayudantes visuales de luz (cono, aro, bola amarilla, círculo) */
   showLightHelpers?: boolean;
   /** Mostrar un plano de suelo grande y plano bajo el objeto */
    showGround?: boolean;
    /** Texture URL for the ground plane */
    groundTexture?: string | null;
     /** Finish for ground texture: glossy, semi-matte, matte, or mirror */
     groundTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror';
     /** Finish for object textures: glossy, semi-matte, matte, or mirror */
     objectTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror';
     /** Background image URL for the skybox */
     skyboxImage?: string | null;
    /** Estado de los efectos visuales (brillo, chispas, fuego, estrellas) */
   fxConfig?: {
     glow: boolean;
     sparks: boolean;
     fire: boolean;
   };
   /** Notifica al padre cuando un efecto visual cambió */
   onFxChange?: (fx: { glow?: boolean; sparks?: boolean; fire?: boolean }) => void;
   /** Mostrar u ocultar la rejilla del suelo */
   showGrid?: boolean;
   onShowGridChange?: (visible: boolean) => void;
   /** Tracks de animación para este visor. */
   animationTracks?: AnimationTrack[];
   /** Tiempo actual de reproducción en segundos. */
   animationTime?: number;
    /** Called when a non-looping animation track completes. */
    onAnimationComplete?: (trackId: string) => void;
    /** Show path and camera gizmo for camera animation tracks */
    showCameraPathGizmo?: boolean;
    /** When true, the 3D view follows the animated camera (camera view mode) */
    cameraViewMode?: boolean;
    /** Called when the camera gizmo is moved, returns updated track keyframes */
    onCameraGizmoMove?: (keyframes: Keyframe[]) => void;
    /** Currently selected keyframe (index) being edited via gizmo */
    selectedKeyframeIndex?: number;
    }

/** Posición, rotación y escala del objeto en el visor (la usa el manipulador) */
export type ObjectTransform = {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
};

export const IDENTITY_TRANSFORM: ObjectTransform = {
  px: 0,
  py: 0,
  pz: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  sx: 1,
  sy: 1,
  sz: 1,
};

/** ¿El transform es el de reposo (la pieza sin tocar)? */
export function isIdentityTransform(t: ObjectTransform): boolean {
  return (
    Math.abs(t.px) < 1e-9 &&
    Math.abs(t.py) < 1e-9 &&
    Math.abs(t.pz) < 1e-9 &&
    Math.abs(t.rx) < 1e-9 &&
    Math.abs(t.ry) < 1e-9 &&
    Math.abs(t.rz) < 1e-9 &&
    Math.abs(t.sx - 1) < 1e-9 &&
    Math.abs(t.sy - 1) < 1e-9 &&
    Math.abs(t.sz - 1) < 1e-9
  );
}

function applyCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  cam: Camera3D
) {
  const baseDistance = 5.5;
  const distance = baseDistance / cam.zoom;
  const rotY = cam.rotationY;
  const rotX = cam.rotationX;

  const isFrontView = Math.abs(rotY) < 0.01 && Math.abs(rotX) < 0.01;
  const isTopView =
    Math.abs(rotY) < 0.01 && Math.abs(rotX - Math.PI / 2) < 0.01;
  const isSideView =
    Math.abs(rotY - Math.PI / 2) < 0.01 && Math.abs(rotX) < 0.01;

  if (isFrontView) {
    camera.position.set(cam.offsetX, cam.offsetY, distance);
    controls.target.set(cam.offsetX, cam.offsetY, 0);
  } else if (isTopView) {
    camera.position.set(cam.offsetX, distance, cam.offsetY);
    controls.target.set(cam.offsetX, 0, cam.offsetY);
  } else if (isSideView) {
    camera.position.set(distance, cam.offsetY, cam.offsetX);
    controls.target.set(0, cam.offsetY, cam.offsetX);
  } else {
    const x = distance * Math.cos(rotX) * Math.sin(rotY);
    const y = distance * Math.sin(rotX);
    const z = distance * Math.cos(rotX) * Math.cos(rotY);
    camera.position.set(x + cam.offsetX, y + cam.offsetY, z);
    controls.target.set(cam.offsetX, cam.offsetY, 0);
  }

  // Reset internal delta state so controls.update() in the animation loop
  // doesn't override the programmatic camera position with accumulated
  // user-interaction deltas (spherical rotation + pan offset).
  (controls as any)._sphericalDelta.set(0, 0, 0);
  (controls as any)._panOffset.set(0, 0, 0);
  (controls as any)._scale = 1;
  controls.update();
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }
  material.dispose();
}

/** Crea una copia visual autónoma: ni su geometría ni sus materiales se
 * comparten con el objeto que estaba activo al pegar. */
function cloneObjectVisual(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((item) => {
    if (!(item instanceof THREE.Mesh)) return;
    item.geometry = item.geometry.clone();
    item.material = Array.isArray(item.material)
      ? item.material.map((material) => material.clone())
      : item.material.clone();
  });
  return clone;
}

/**
 * Construye el visual de un objeto a partir de su instantánea de malla
 * (la copia que se guarda al pegarlo en otra pestaña). Reproduce los
 * mismos materiales que la malla principal: textura con su acabado y su
 * relieve, colores por cara y normales planas o suaves según viniera.
 */
export function buildSnapshotObjectVisual(
  mesh: Mesh,
  smooth: boolean,
  projection: LatheTextureProjection,
  textureFinishOverride?: 'glossy' | 'semi-matte' | 'matte' | 'mirror'
): THREE.Group {
  const group = new THREE.Group();
  if (!mesh.vertices.length || !mesh.faces.length) return group;

  const faceColors = mesh.faceColors;
  const useFaceColors =
    !!faceColors &&
    faceColors.length === mesh.faces.length &&
    faceColors.some((c) => !!c);
  const opacity =
    typeof mesh.opacity === 'number'
      ? Math.max(0, Math.min(1, mesh.opacity))
      : 1;
  // Opacidad parcial de las caras del costado (texto): en la copia se
  // resume como la opacidad global, para que el objeto no se vea macizo.
  const sideOpacity =
    !!mesh.faceOpacities && mesh.faceOpacities.length === mesh.faces.length
      ? Math.max(0, Math.min(1, mesh.faceOpacities.find((value) => value < 1) ?? 1))
      : 1;
  const finalOpacity = Math.min(opacity, sideOpacity);

  // --- Con textura: triángulos planos con UV, como la malla principal ---
  if (mesh.texture) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const v of mesh.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const projectionUv = (v: Vertex3D): [number, number] => {
      const angle = Math.atan2(v.z, v.x);
      const u = (angle / (Math.PI * 2) + 1) % 1;
      if (projection === 'planar') {
        return [(v.x - minX) / rangeX, 1 - (v.y - minY) / rangeY];
      }
      if (projection === 'spherical') {
        const length = Math.max(1e-6, Math.hypot(v.x, v.y, v.z));
        return [u, 1 - Math.acos(v.y / length) / Math.PI];
      }
      return [u, 1 - (v.y - minY) / rangeY];
    };
    for (const face of mesh.faces) {
      if (face.length < 3) continue;
      const v0 = mesh.vertices[face[0]];
      const v1 = mesh.vertices[face[1]];
      const v2 = mesh.vertices[face[2]];
      if (!v0 || !v1 || !v2) continue;
      const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
      const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
      const n = e1.cross(e2).normalize();
      const baseIdx = positions.length / 3;
      for (const idx of face) {
        const v = mesh.vertices[idx];
        if (!v) continue;
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        if (projection === 'planar' && mesh.uvs && mesh.uvs[idx]) {
          uvs.push(mesh.uvs[idx][0], mesh.uvs[idx][1]);
        } else {
          uvs.push(...projectionUv(v));
        }
      }
      for (let i = 1; i < face.length - 1; i++) {
        indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
      }
    }
    if (positions.length === 0) return group;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
        metalness: (mesh.textureFinish ?? textureFinishOverride) === 'glossy' ? 0 : (mesh.textureFinish ?? textureFinishOverride) === 'matte' ? 0.05 : (mesh.textureFinish ?? textureFinishOverride) === 'mirror' ? 1 : 0.3,
        roughness: (mesh.textureFinish ?? textureFinishOverride) === 'glossy' ? 0 : (mesh.textureFinish ?? textureFinishOverride) === 'matte' ? 0.9 : (mesh.textureFinish ?? textureFinishOverride) === 'mirror' ? 0.05 : 0.45,
        clearcoat: (mesh.textureFinish ?? textureFinishOverride) === 'glossy' ? 0 : (mesh.textureFinish ?? textureFinishOverride) === 'mirror' ? 1 : 0,
        clearcoatRoughness: (mesh.textureFinish ?? textureFinishOverride) === 'glossy' ? 0.015 : (mesh.textureFinish ?? textureFinishOverride) === 'mirror' ? 0 : 0,
        side: THREE.DoubleSide,
        map: null,
        bumpMap: null,
        bumpScale: (mesh.textureRelief ?? 0) * 0.5,
        transparent: true,
        opacity: finalOpacity,
        alphaTest: 0,
        envMapIntensity: (mesh.textureFinish ?? textureFinishOverride) === 'mirror' ? 1.5 : 0,
    });
    const meshObj = new THREE.Mesh(geometry, material);
    meshObj.castShadow = true;
    meshObj.receiveShadow = true;
    group.add(meshObj);

    new THREE.TextureLoader().load(
      mesh.texture,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        material.map = texture;
        material.bumpMap = texture;
        material.bumpScale = (mesh.textureRelief ?? 0) * 0.5;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      },
      undefined,
      () => {
        material.color.set(0xcccccc);
      }
    );
    return group;
  }

  // --- Sin textura y con normales suaves: geometría indexada por
  // vértice, con colores por cara volcados como atributo de vértice ---
  if (smooth) {
    const positions: number[] = [];
    const index: number[] = [];
    mesh.vertices.forEach((v) => positions.push(v.x, v.y, v.z));
    for (const face of mesh.faces) {
      if (face.length < 3) continue;
      for (let j = 1; j + 1 < face.length; j++) {
        index.push(face[0], face[j], face[j + 1]);
      }
    }
    if (index.length === 0) return group;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const uniformFaceColor = useFaceColors
      ? faceColors!.find((color): color is string => !!color) ?? null
      : null;
    const allFacesShareColor = !!uniformFaceColor && faceColors!.every(
      (color) => !color || color === uniformFaceColor
    );
    if (useFaceColors) {
      const colors = new Float32Array(mesh.vertices.length * 3).fill(1);
      const col = new THREE.Color();
      let faceIndex = 0;
      for (const face of mesh.faces) {
        const hex = faceColors![faceIndex++] ?? null;
        if (!hex || face.length < 3) continue;
        col.set(hex);
        for (const vi of face) {
          colors[vi * 3] = col.r;
          colors[vi * 3 + 1] = col.g;
          colors[vi * 3 + 2] = col.b;
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const material = new THREE.MeshPhysicalMaterial({
      // Con vertexColors el color base debe ser blanco para que el color
      // de cada cara salga exacto (multiplicación)
      color: allFacesShareColor ? uniformFaceColor! : useFaceColors ? 0xffffff : 0xdedede,
      vertexColors: useFaceColors && !allFacesShareColor,
      metalness: mesh.textureFinish === 'glossy' ? 0.1 : mesh.textureFinish === 'matte' ? 0.05 : 0.1,
      roughness: mesh.textureFinish === 'glossy' ? 0.025 : mesh.textureFinish === 'matte' ? 0.9 : 0.45,
      clearcoat: mesh.textureFinish === 'glossy' ? 1 : 0,
      clearcoatRoughness: mesh.textureFinish === 'glossy' ? 0.015 : 0,
      side: THREE.DoubleSide,
      transparent: finalOpacity < 1,
      opacity: finalOpacity,
    });
    const meshObj = new THREE.Mesh(geometry, material);
    meshObj.castShadow = true;
    meshObj.receiveShadow = true;
    group.add(meshObj);
    return group;
  }

  // --- Resto (vóxeles, caras planas): triángulos sueltos con aristas ---
  const positions: number[] = [];
  const normals: number[] = [];
  const colorAttr: number[] = [];
  let faceIndex = 0;
  for (const face of mesh.faces) {
    const hex = useFaceColors ? (faceColors![faceIndex] ?? '#ffffff') : null;
    faceIndex++;
    if (face.length < 3) continue;
    const v0 = mesh.vertices[face[0]];
    const v1 = mesh.vertices[face[1]];
    const v2 = mesh.vertices[face[2]];
    if (!v0 || !v1 || !v2) continue;
    const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
    const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
    const n = e1.cross(e2).normalize();
    const col = hex ? new THREE.Color(hex) : null;
    for (const idx of face) {
      const v = mesh.vertices[idx];
      if (!v) continue;
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      if (col) colorAttr.push(col.r, col.g, col.b);
    }
  }
  if (positions.length === 0) return group;

  const hasVertexColors =
    useFaceColors &&
    colorAttr.length > 0 &&
    colorAttr.length === positions.length;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (hasVertexColors) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttr, 3));
  }

  const material = new THREE.MeshStandardMaterial({
    color: hasVertexColors ? 0xffffff : 0xdedede,
    vertexColors: hasVertexColors,
    metalness: 0.3,
    roughness: 0.45,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: finalOpacity < 1,
    opacity: finalOpacity,
    envMapIntensity: 0,
  });
  const meshObj = new THREE.Mesh(geometry, material);
  meshObj.castShadow = true;
  meshObj.receiveShadow = true;
  group.add(meshObj);

  const edges = new THREE.EdgesGeometry(geometry, 1);
  const lineMat = new THREE.LineBasicMaterial({
    color: hasVertexColors ? 0x000000 : 0x444444,
    transparent: true,
    opacity: hasVertexColors ? 0.35 : 0.6,
  });
  group.add(new THREE.LineSegments(edges, lineMat));
  return group;
}

type GizmoAxis = 'x' | 'y' | 'z';

type GizmoDrag = {
  /** Qué transform arrastra: el del objeto o el de la pieza de textura */
  target: 'object' | 'texture';
  axis: GizmoAxis;
  mode: 'move' | 'scale' | 'uniform-scale' | 'planar-scale' | 'rotate';
  /** eje del objeto pasado a coordenadas de mundo (con su rotación) */
  axisWorld: THREE.Vector3;
  /** transform del objeto al empezar el arrastre */
  startPos: THREE.Vector3;
  startScale: THREE.Vector3;
  startQuat: THREE.Quaternion;
  /** move/scale: parámetro del rayo sobre la línea del eje al empezar */
  startT: number;
  /** rotate: plano ⟂ al eje y base para medir el ángulo girado */
  plane: THREE.Plane;
  basisU: THREE.Vector3;
  basisV: THREE.Vector3;
  startAngle: number;
  /**
   * Pieza de textura: su transform vive en las coordenadas LOCALES de la
   * malla (las mismas con las que se calculan las UV), así que el rayo
   * del puntero se pasa a ese espacio con esta matriz antes de medir.
   */
  rayToLocal?: THREE.Matrix4;
};

/** Colores del manipulador por eje (rojo X, verde Y, azul Z) */
const GIZMO_AXIS_COLORS: Record<GizmoAxis, number> = {
  x: 0xff4444,
  y: 0x44dd55,
  z: 0x4488ff,
};

const GIZMO_AXIS_DIR: Record<GizmoAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Construye el manipulador dentro de un grupo: por cada eje una flecha
 * con su bolita del color del eje (MOVER), una bolita amarilla (ESTIRAR)
 * y un aro (ROTAR alrededor del eje). Devuelve la lista de asas para el
 * raycast. Todo con depthTest off para verse SIEMPRE por delante del
 * objeto, como los gizmos de los editores 3D.
 */
function buildGizmoHandles(group: THREE.Group): THREE.Mesh[] {
  const handles: THREE.Mesh[] = [];
  // Cubo central: escala uniforme en X, Y y Z a la vez.
  const center = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  );
  center.userData = { axis: 'x' as GizmoAxis, mode: 'uniform-scale' };
  center.renderOrder = 999;
  group.add(center);
  handles.push(center);
  // Cuadradito pequeño ENCIMA del cubo central (sobre el eje vertical):
  // acerca el lado y el ancho a la vez (X y Z) sin variar la altura (Y).
  const flat = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x40e0ff, depthTest: false })
  );
  flat.userData = { axis: 'y' as GizmoAxis, mode: 'planar-scale' };
  flat.position.y = 0.28;
  flat.renderOrder = 999;
  group.add(flat);
  handles.push(flat);
  // Zona de agarre invisible, algo más grande que el cuadradito
  const flatHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    })
  );
  flatHit.userData = { axis: 'y' as GizmoAxis, mode: 'planar-scale' };
  flatHit.position.y = 0.28;
  flatHit.renderOrder = 1000;
  group.add(flatHit);
  handles.push(flatHit);
  for (const axis of ['x', 'y', 'z'] as GizmoAxis[]) {
    const color = GIZMO_AXIS_COLORS[axis];
    // Cada eje se construye a lo largo de +Y y luego se orienta
    const axisGroup = new THREE.Group();
    if (axis === 'x') axisGroup.rotation.z = -Math.PI / 2;
    else if (axis === 'z') axisGroup.rotation.x = Math.PI / 2;
    group.add(axisGroup);

    const handle = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      mode: 'move' | 'scale' | 'rotate',
      y: number
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.userData = { axis, mode };
      m.position.y = y;
      m.renderOrder = 999; // por delante del objeto
      axisGroup.add(m);
      handles.push(m);
    };
    const hitHandle = (
      geo: THREE.BufferGeometry,
      mode: 'move' | 'scale' | 'rotate',
      y: number
    ): THREE.Mesh => {
      const hit = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        })
      );
      hit.userData = { axis, mode };
      hit.position.y = y;
      hit.renderOrder = 1000;
      axisGroup.add(hit);
      handles.push(hit);
      return hit;
    };

    const axisMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    // Flecha (entera: palo + punta) = mover
    handle(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 12), axisMat, 'move', 0.5);
    hitHandle(new THREE.CylinderGeometry(0.045, 0.045, 1.08, 12), 'move', 0.5);
    handle(new THREE.ConeGeometry(0.035, 0.12, 16), axisMat, 'move', 1.08);
    hitHandle(new THREE.ConeGeometry(0.09, 0.22, 16), 'move', 1.08);
    // Bolita del color del eje = mover
    handle(new THREE.SphereGeometry(0.04, 16, 12), axisMat, 'move', 0.86);
    hitHandle(new THREE.SphereGeometry(0.1, 16, 12), 'move', 0.86);
    // Bolita amarilla = estirar a lo largo del eje. Más cerca del centro
    // (0.55) que de los aros (que cruzan cada eje a 0.7): si coincidiera
    // ahí sería muy difícil cogerla con el ratón sin tocar el aro.
    handle(
      new THREE.SphereGeometry(0.038, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd93d, depthTest: false }),
      'scale',
      0.55
    );
    hitHandle(new THREE.SphereGeometry(0.1, 16, 12), 'scale', 0.55);
    // Aro = rotar alrededor del eje
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.008, 10, 64),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.55,
      })
    );
    ring.userData = { axis, mode: 'rotate' };
    ring.rotation.x = Math.PI / 2; // normal del toro ⟂ al eje
    ring.renderOrder = 999;
    axisGroup.add(ring);
    handles.push(ring);
    const hitRing = hitHandle(new THREE.TorusGeometry(0.7, 0.06, 10, 64), 'rotate', 0);
    hitRing.rotation.x = Math.PI / 2;
  }
  return handles;
}

/**
 * Builds 3-axis move arrows and 2 rotation rings for the light gizmo.
 * Each arrow is colored by axis (red X, green Y, blue Z) with depthTest
 * false so it's always visible. The rotation rings let you tilt the
 * spotlight direction (like 3D Studio Max's spotlight gizmo).
 */
function buildLightGizmoHandles(group: THREE.Group): THREE.Mesh[] {
  const handles: THREE.Mesh[] = [];
  for (const axis of ['x', 'y', 'z'] as GizmoAxis[]) {
    const color = GIZMO_AXIS_COLORS[axis];
    const axisGroup = new THREE.Group();
    if (axis === 'x') axisGroup.rotation.z = -Math.PI / 2;
    else if (axis === 'z') axisGroup.rotation.x = Math.PI / 2;
    group.add(axisGroup);

    // Visible arrow: cylinder shaft + cone tip
    const arrowMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.8, 12),
      arrowMat
    );
    shaft.position.y = 0.4;
    shaft.userData = { axis, mode: 'move' };
    shaft.renderOrder = 999;
    axisGroup.add(shaft);
    handles.push(shaft);

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.12, 16),
      arrowMat
    );
    tip.position.y = 0.86;
    tip.userData = { axis, mode: 'move' };
    tip.renderOrder = 999;
    axisGroup.add(tip);
    handles.push(tip);

    // Invisible hit area for easier grabbing
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const hitShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.9, 12),
      hitMat
    );
    hitShaft.position.y = 0.45;
    hitShaft.userData = { axis, mode: 'move' };
    hitShaft.renderOrder = 1000;
    axisGroup.add(hitShaft);
    handles.push(hitShaft);

    const hitTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 16),
      hitMat
    );
    hitTip.position.y = 0.86;
    hitTip.userData = { axis, mode: 'move' };
    hitTip.renderOrder = 1000;
    axisGroup.add(hitTip);
    handles.push(hitTip);
  }

  // Rotation rings for tilting the spotlight direction.
  // Three rings (X, Y, Z): each rotates the spotlight's target around its
  // position around that axis — like the 3-axis object transform gizmo.
  for (const axis of ['x', 'y', 'z'] as GizmoAxis[]) {
    const color = GIZMO_AXIS_COLORS[axis];
    const ringGroup = new THREE.Group();
    // Orient the ring perpendicular to the rotation axis (TorusGeometry
    // defaults to XY plane; rotate so its normal aligns with the axis)
    if (axis === 'x') ringGroup.rotation.y = Math.PI / 2;
    else if (axis === 'y') ringGroup.rotation.x = Math.PI / 2;
    group.add(ringGroup);

    // Visible ring (semi-transparent)
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.TorusGeometry(1.0, 0.02, 8, 32);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.userData = { axis, mode: 'rotate' };
    ring.renderOrder = 999;
    ringGroup.add(ring);
    handles.push(ring);

    // Invisible hit ring (larger for easier grabbing)
    const hitRingGeo = new THREE.TorusGeometry(1.1, 0.08, 8, 32);
    const hitRing = new THREE.Mesh(hitRingGeo, new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    }));
    hitRing.userData = { axis, mode: 'rotate' };
    hitRing.renderOrder = 1000;
    ringGroup.add(hitRing);
    handles.push(hitRing);
  }

  return handles;
}

/**
 * Parámetro s del punto más cercano de la línea (origin + s·dir) al rayo,
 * o null si el rayo es casi paralelo a la línea (el arrastre no define
 * avance en esa situación).
 */
function closestPointOnAxis(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  dir: THREE.Vector3
): number | null {
  const w0 = new THREE.Vector3().subVectors(origin, ray.origin);
  const b = dir.dot(ray.direction);
  const c = dir.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * e - c) / denom;
}

/**
 * Pieza amarilla de la ayuda de proyección: el marco que enseña dónde
 * está sentada la textura y que se mueve/gira/estira con su propio
 * manipulador. Se dibuja en las coordenadas LOCALES del objeto (las
 * mismas con las que se calculan las UV), así que en reposo la pieza
 * abraza la figura y la textura queda igual que sin ayuda.
 *
 * - Plana: rectángulo delante de la figura con una rayita arriba (la
 *   proyección va a lo largo de Z, así que alejarlo del objeto no
 *   cambia el mapeo, solo dónde se ve el marco).
 * - Envolvente cilíndrica: tubo de segmentos alrededor del eje Y.
 * - Esférica: esfera envolviendo la figura.
 */
function buildTextureHelperVisual(
  projection: LatheTextureProjection,
  vertices: Vertex3D[]
): THREE.Group {
  const group = new THREE.Group();
  if (vertices.length === 0) return group;
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd93d,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const pts: number[] = [];
  const seg = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number
  ) => pts.push(ax, ay, az, bx, by, bz);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxR = 0; // distancia horizontal máxima al eje Y
  let maxR3 = 0; // distancia 3D máxima al origen
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
    maxR = Math.max(maxR, Math.hypot(v.x, v.z));
    maxR3 = Math.max(maxR3, Math.hypot(v.x, v.y, v.z));
  }

  if (projection === 'planar') {
    const z = maxZ + Math.max(0.15, (maxZ - minZ) * 0.4);
    const corners: Array<[number, number]> = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      seg(ax, ay, z, bx, by, z);
    }
    // Rayita sobre el borde de arriba: marca qué lado es el de arriba
    const cx = (minX + maxX) / 2;
    const tick = Math.max(0.06, (maxY - minY) * 0.12);
    seg(cx, maxY, z, cx, maxY + tick, z);
  } else if (projection === 'cylindrical') {
    // Tubo por segmentos: aros a varias alturas + verticales en ángulo
    const r = Math.max(0.25, maxR * 1.1);
    const RINGS = 5;
    const RSEG = 48;
    const VSEG = 12;
    for (let i = 0; i < RINGS; i++) {
      const y = minY + ((maxY - minY) * i) / (RINGS - 1);
      for (let k = 0; k < RSEG; k++) {
        const a0 = (k / RSEG) * Math.PI * 2;
        const a1 = ((k + 1) / RSEG) * Math.PI * 2;
        seg(
          r * Math.cos(a0), y, r * Math.sin(a0),
          r * Math.cos(a1), y, r * Math.sin(a1)
        );
      }
    }
    for (let k = 0; k < VSEG; k++) {
      const a = (k / VSEG) * Math.PI * 2;
      seg(
        r * Math.cos(a), minY, r * Math.sin(a),
        r * Math.cos(a), maxY, r * Math.sin(a)
      );
    }
  } else {
    // Esfera: paralelos de latitud + meridianos completos por los polos
    const r = Math.max(0.25, maxR3 * 1.05);
    const SEG = 48;
    for (let i = 1; i < 5; i++) {
      const phi = (i / 5) * Math.PI; // 0 = polo norte
      const rr = r * Math.sin(phi);
      const y = r * Math.cos(phi);
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2;
        const a1 = ((k + 1) / SEG) * Math.PI * 2;
        seg(
          rr * Math.cos(a0), y, rr * Math.sin(a0),
          rr * Math.cos(a1), y, rr * Math.sin(a1)
        );
      }
    }
    for (let m = 0; m < 8; m++) {
      const theta = (m / 8) * Math.PI * 2;
      for (let k = 0; k < SEG; k++) {
        const p0 = (k / SEG) * Math.PI * 2;
        const p1 = ((k + 1) / SEG) * Math.PI * 2;
        seg(
          r * Math.sin(p0) * Math.cos(theta), r * Math.cos(p0), r * Math.sin(p0) * Math.sin(theta),
          r * Math.sin(p1) * Math.cos(theta), r * Math.cos(p1), r * Math.sin(p1) * Math.sin(theta)
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 998; // visible por delante del objeto, como el gizmo
  group.add(lines);
  return group;
}

export default function Viewer3D({
   mesh,
   objects,
   selectedObjectId,
   configObjectId,
   configMesh,
   booleanToolObjectId = null,
   forceObjectsUpdate = 0,
   configSmooth,
  configProjection,
  onObjectSelect,
  onVerticesChange,
  showVerticesDefault = true,
  smoothShading = false,
  showLatheAxis = false,
  textureProjection = 'cylindrical',
  textureHelper = false,
  textureHelperTransform,
  onTextureHelperTransform,
  gizmo = false,
  objectTransform,
   camera3D,
    onCameraChange,
    onCameraMove,
    onObjectTransform,
   lightConfig,
   onLightConfigChange,
   showLightHelpers = true,
     showGround = false,
     groundTexture = null,
     groundTextureFinish = 'semi-matte',
     objectTextureFinish = 'semi-matte',
     skyboxImage = null,
    fxConfig,
    onFxChange,
    showGrid: showGridProp,
     onShowGridChange,
      animationTracks,
      animationTime = 0,
      onAnimationComplete,
      showCameraPathGizmo = false,
      cameraViewMode = false,
      onCameraGizmoMove,
      selectedKeyframeIndex,
    }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cubeCameraRef = useRef<THREE.CubeCamera | null>(null);
  const cubeRenderTargetRef = useRef<THREE.WebGLCubeRenderTarget | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const selectedObjectIdRef = useRef(selectedObjectId);
  selectedObjectIdRef.current = selectedObjectId;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  // Identificador de la pieza que ocupa la malla principal del visor.
  // No se actualiza durante el render: se confirma tras intercambiarla
  // con una copia al seleccionar otro objeto.
  const displayedObjectIdRef = useRef<string | undefined>(selectedObjectId);
  const onObjectSelectRef = useRef(onObjectSelect);
  onObjectSelectRef.current = onObjectSelect;
   const onCameraChangeRef = useRef(onCameraChange);
    onCameraChangeRef.current = onCameraChange;
    const onCameraMoveRef = useRef(onCameraMove);
    onCameraMoveRef.current = onCameraMove;
   const animationTracksRef = useRef<AnimationTrack[] | undefined>(animationTracks);
   animationTracksRef.current = animationTracks;
   const animationTimeRef = useRef(animationTime);
   animationTimeRef.current = animationTime;
   const onAnimationCompleteRef = useRef(onAnimationComplete);
   onAnimationCompleteRef.current = onAnimationComplete;
   const completedTracksRef = useRef<Set<string>>(new Set());
   const vertexHelpersRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const dragRef = useRef<{
    object: THREE.Mesh;
    offset: THREE.Vector3;
    index: number;
  } | null>(null);
  const planeRef = useRef<THREE.Plane | null>(null);
  const lightConfigRef = useRef(lightConfig);
  lightConfigRef.current = lightConfig;

   const [showVertices, setShowVertices] = useState(showVerticesDefault);
   const [smoothCapture, setSmoothCapture] = useState(true);
   const [fxGlow, setFxGlow] = useState(fxConfig?.glow ?? false);
   const [fxSparks, setFxSparks] = useState(fxConfig?.sparks ?? false);
   const [fxFire, setFxFire] = useState(fxConfig?.fire ?? false);

   // Controlled/uncontrolled helpers for effects
   const glowValue = fxConfig ? fxConfig.glow : fxGlow;
   const sparksValue = fxConfig ? fxConfig.sparks : fxSparks;
   const fireValue = fxConfig ? fxConfig.fire : fxFire;
   const toggleGlow = useCallback(() => {
     if (fxConfig !== undefined) { onFxChange?.({ glow: !fxConfig.glow }); }
     else { setFxGlow(!fxGlow); }
   }, [fxConfig, onFxChange, fxGlow]);
   const toggleSparks = useCallback(() => {
     if (fxConfig !== undefined) { onFxChange?.({ sparks: !fxConfig.sparks }); }
     else { setFxSparks(!fxSparks); }
   }, [fxConfig, onFxChange, fxSparks]);
   const toggleFire = useCallback(() => {
     if (fxConfig !== undefined) { onFxChange?.({ fire: !fxConfig.fire }); }
     else { setFxFire(!fxFire); }
   }, [fxConfig, onFxChange, fxFire]);
  const [fxStars, setFxStars] = useState(false);
  const [starPlacement, setStarPlacement] = useState(false);
  const [starSize, setStarSize] = useState(1);
   const [showGridInternal, setShowGridInternal] = useState(true);
   const gridValue = showGridProp !== undefined ? showGridProp : showGridInternal;
   const toggleGrid = useCallback(() => {
     if (showGridProp !== undefined) {
       onShowGridChange?.(!showGridProp);
     } else {
       setShowGridInternal(!showGridInternal);
     }
   }, [showGridProp, onShowGridChange, showGridInternal]);
  const [gridScale, setGridScale] = useState(1);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [lightPreset, setLightPreset] = useState(0);
  const lightPresetRef = useRef(lightPreset);
  lightPresetRef.current = lightPreset;
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const [vertexSize, setVertexSize] = useState(0.008);
  const vertexSizeRef = useRef(vertexSize);
  vertexSizeRef.current = vertexSize;
  const meshRef = useRef(mesh);
  meshRef.current = mesh;
   const gridGroupRef = useRef<THREE.Group | null>(null);
   const groundRef = useRef<THREE.Mesh | null>(null);
   const skyboxRef = useRef<THREE.Mesh | null>(null);
  const cameraPathRef = useRef<THREE.Group | null>(null);
  const cameraGizmoRef = useRef<THREE.Group | null>(null);
  const getCameraPositionFromStateRef = useRef<(camState: Camera3D) => THREE.Vector3>();
  const drawCameraPathRef = useRef<(track: AnimationTrack) => void>();
  const latheAxisRef = useRef<THREE.Group | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const spotlightRefs = useRef<THREE.SpotLight[]>([]);

  const onVerticesChangeRef = useRef(onVerticesChange);
  onVerticesChangeRef.current = onVerticesChange;

  const onLightConfigChangeRef = useRef(onLightConfigChange);
  onLightConfigChangeRef.current = onLightConfigChange;

  // Visual helpers for lights
  const lightHelpersGroupRef = useRef<THREE.Group | null>(null);
  const lightPositionHelpersRef = useRef<THREE.Mesh[]>([]);
  const lightAngleRingsRef = useRef<THREE.Mesh[]>([]);
  const lightForwardCirclesRef = useRef<THREE.Mesh[]>([]);
  const buildLightHelpersRef = useRef<(config: LightConfig | null) => void>();
  // Drag state for light helpers
  const lightDragRef = useRef<{
    type: 'position' | 'angle';
    spotlightIdx: number;
    plane: THREE.Plane;
    offset: THREE.Vector3;
    axisConstraint: 'x' | 'y' | 'z' | null;
    startAngle?: number;
    startScreenPos?: { x: number; y: number };
  } | null>(null);

  // Light gizmo: 3-axis arrows shown at the selected spotlight position
  const lightGizmoGroupRef = useRef<THREE.Group | null>(null);
  const lightGizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const lightGizmoDragRef = useRef<{
    spotlightIdx: number;
    axis: 'x' | 'y' | 'z';
    axisWorld: THREE.Vector3;
    startPos: THREE.Vector3;
    startT: number;
    mode: 'move' | 'rotate';
    startDir?: THREE.Vector3;
  } | null>(null);

  // --- Efectos de iluminación (chispas, fuego, estrellas, neón) ---
  const effectsGroupRef = useRef<THREE.Group | null>(null);
  const glowGroupRef = useRef<THREE.Group | null>(null);
  const sparksRef = useRef<ParticleSystem | null>(null);
  const fireRef = useRef<ParticleSystem | null>(null);
  const starsRef = useRef<StarSystem | null>(null);
  const fireLightRef = useRef<THREE.PointLight | null>(null);
   const fxFireRef = useRef(fireValue);
   fxFireRef.current = fireValue;
  const fxStarsRef = useRef(fxStars);
  fxStarsRef.current = fxStars;
  const starPlacementRef = useRef(starPlacement);
  starPlacementRef.current = starPlacement;
  const placedStarsRef = useRef<PlacedStarSystem | null>(null);
  const placeDownRef = useRef<{ x: number; y: number } | null>(null);
  const starSizeRef = useRef(starSize);
  starSizeRef.current = starSize;

  // --- Manipulador (flechas X/Y/Z: mover, estirar y rotar) ---
  const gizmoGroupRef = useRef<THREE.Group | null>(null);
  const gizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const gizmoDragRef = useRef<GizmoDrag | null>(null);
  // --- Pieza amarilla de la ayuda de proyección (marco editable) ---
  // El marco vive DENTRO del grupo de la malla (pegado al objeto), porque
  // su transform se define en las coordenadas locales con las que se
  // calculan las UV. Las asas van en un grupo hermano sin escala, para
  // que las flechas no se estiren al cambiar el tamaño de la pieza.
  const textureHelperGroupRef = useRef<THREE.Group | null>(null);
  const textureHelperGizmoGroupRef = useRef<THREE.Group | null>(null);
  const textureHelperHandlesRef = useRef<THREE.Mesh[]>([]);
  const textureHelperOnRef = useRef(textureHelper);
  textureHelperOnRef.current = textureHelper;
  const textureHelperTransformRef = useRef<ObjectTransform>(
    textureHelperTransform ?? IDENTITY_TRANSFORM
  );
  textureHelperTransformRef.current =
    textureHelperTransform ?? IDENTITY_TRANSFORM;
  const onTextureHelperTransformRef = useRef(onTextureHelperTransform);
  onTextureHelperTransformRef.current = onTextureHelperTransform;
  const [showGizmo, setShowGizmo] = useState(gizmo);
  useEffect(() => setShowGizmo(gizmo), [gizmo]);
  const gizmoOnRef = useRef(showGizmo);
  gizmoOnRef.current = showGizmo;
  // Posición/rotación/escala del objeto: el manipulador las fija
  // arrastrando y se aplican a la malla y a todo lo que la acompaña
  // (halo, partículas, estrellas, helpers de vértices).
  const [transform, setTransform] = useState<ObjectTransform>(
    objectTransform ?? IDENTITY_TRANSFORM
  );
  const transformRef = useRef(transform);
  const onObjectTransformRef = useRef(onObjectTransform);
  onObjectTransformRef.current = onObjectTransform;


  // Aplica el transform a la malla y a sus acompañantes. El gizmo y las
  // partículas solo toman posición y rotación: las flechas mantienen su
  // tamaño y las partículas no se estiran con el objeto.
  const applyObjectTransform = useCallback((t: ObjectTransform) => {
    const full = (
      g: THREE.Group | null,
      scale: boolean
    ) => {
      if (!g) return;
      g.position.set(t.px, t.py, t.pz);
      g.rotation.set(t.rx, t.ry, t.rz);
      if (scale) g.scale.set(t.sx, t.sy, t.sz);
    };
    full(meshGroupRef.current, true);
    // Las copias viven como matrices relativas al objeto activo. Al
    // arrastrar este, actualizamos esas matrices en cada movimiento para
    // que las demás piezas permanezcan inmóviles, no solo al soltar.
    const meshGroup = meshGroupRef.current;
    const selectedId = selectedObjectIdRef.current;
    if (meshGroup && selectedId) {
      const selectedMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(t.px, t.py, t.pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz)),
        new THREE.Vector3(t.sx, t.sy, t.sz)
      );
      const inverseSelected = selectedMatrix.invert();
      for (const child of meshGroup.children) {
        if (!child.userData.sceneObjectDuplicate) continue;
        const object = objectsRef.current?.find(
          (candidate) => candidate.id === child.userData.sceneObjectId
        );
        if (!object) continue;
        const objectMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(object.transform.px, object.transform.py, object.transform.pz),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(object.transform.rx, object.transform.ry, object.transform.rz)
          ),
          new THREE.Vector3(object.transform.sx, object.transform.sy, object.transform.sz)
        );
        child.matrix.copy(inverseSelected).multiply(objectMatrix);
        child.matrixAutoUpdate = false;
      }
    }
    full(glowGroupRef.current, true);
    full(vertexHelpersRef.current, true);
    full(placedStarsRef.current?.group ?? null, true);
    full(effectsGroupRef.current, false);
    full(gizmoGroupRef.current, false);
    if (lightGizmoGroupRef.current) {
      lightGizmoGroupRef.current.visible = false;
    }
  }, []);

  // Aplica el transform de la pieza de textura: al marco entero
  // (posición, rotación y escala — la escala ES el tamaño de la pieza) y
  // a sus asas solo posición y rotación, para que las flechas del
  // manipulador mantengan su tamaño.
  const applyTextureHelperTransform = useCallback((t: ObjectTransform) => {
    const visual = textureHelperGroupRef.current;
    if (visual) {
      visual.position.set(t.px, t.py, t.pz);
      visual.rotation.set(t.rx, t.ry, t.rz);
      visual.scale.set(t.sx, t.sy, t.sz);
    }
    const giz = textureHelperGizmoGroupRef.current;
    if (giz) {
      giz.position.set(t.px, t.py, t.pz);
      giz.rotation.set(t.rx, t.ry, t.rz);
    }
  }, []);
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || !camera3D) return;
    applyCamera(camera, controls, camera3D);
  }, [camera3D]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    // Fondo del lienzo: el mismo azul oscuro de la interfaz
    // (paneles bg-[hsl(224_50%_7%)])
    scene.background = new THREE.Color('hsl(224, 50%, 7%)');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100
    );
    camera.position.set(3, 2.5, 4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 1.5;
    controlsRef.current = controls;

    // Sincronizar el estado de la cámara con el padre cuando el usuario
    // mueve la cámara con el ratón/scroll. Sin esto, los botones de pan
    // usan el offset inicial (0,0) en vez de la posición actual.
    const handleControlsChange = () => {
      const onCamChange = onCameraChangeRef.current;
      if (!onCamChange) return;
      const pos = camera.position;
      const tgt = controls.target;
      const baseDistance = 5.5;
      const dist = pos.distanceTo(tgt);
      const zoom = Math.max(0.1, Math.min(5, dist > 0 ? baseDistance / dist : 1));
      // Calcular rotaciones desde la dirección cámara→target
      const dir = pos.clone().sub(tgt).normalize();
       const rotX = Math.asin(Math.max(-1, Math.min(1, dir.y)));
       const rotY = Math.atan2(dir.x, dir.z);
       const camState = {
         zoom,
         offsetX: tgt.x,
         offsetY: tgt.y,
         rotationX: Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotX)),
         rotationY: rotY,
       };
      onCamChange(camState);
      const onCamMove = onCameraMoveRef.current;
      if (onCamMove) onCamMove(camState);
    };
    controls.addEventListener('change', handleControlsChange);

    const initPreset = LIGHT_PRESETS[lightPresetRef.current] ?? LIGHT_PRESETS[0];

    // Si hay configuración de luces personalizada, usar sus valores;
    // si no, usar los del preset.
    const cfg = lightConfig;
    const ambientColor = cfg?.ambient.enabled ? cfg.ambient.color : initPreset.ambient;
    const ambientIntensity = cfg?.ambient.enabled ? cfg.ambient.intensity : initPreset.ambientIntensity;

    const ambient = new THREE.AmbientLight(
      ambientColor,
      ambientIntensity
    );
    ambientLightRef.current = ambient;
    scene.add(ambient);

    // Environment map dinámico usando CubeCamera para reflejos reales de la escena
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    cubeRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    cubeRenderTarget.texture.generateMipmaps = true;
    const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
    cubeCamera.position.set(0, 1, 0);
    cubeCameraRef.current = cubeCamera;
    cubeRenderTargetRef.current = cubeRenderTarget;
    scene.environment = cubeRenderTarget.texture;

    // Directional lights (main, fill, rim) - only if not using custom config
    // or ambient is the only custom light
    const dirLight = new THREE.DirectionalLight(
      initPreset.dir,
      initPreset.dirIntensity
    );
    dirLightRef.current = dirLight;
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.visible = !cfg;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(
      initPreset.fill,
      initPreset.fillIntensity
    );
    fillLightRef.current = fillLight;
    fillLight.position.set(-5, 3, -5);
    fillLight.visible = !cfg;
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(
      initPreset.rim,
      initPreset.rimIntensity
    );
    rimLightRef.current = rimLight;
    rimLight.position.set(0, -2, -5);
    rimLight.visible = !cfg;
    scene.add(rimLight);

    // Visual helpers for lights: ambient star + spotlight cones with handles.
    // These helpers are rebuilt whenever lightConfig changes (see the
    // lightConfig useEffect below).
    const lightHelpers = new THREE.Group();
    lightHelpers.name = 'lightHelpers';
    scene.add(lightHelpers);
    lightHelpersGroupRef.current = lightHelpers;

    const buildLightHelpers = (config: LightConfig | null) => {
      // Clear previous helpers
       lightHelpers.clear();
      lightPositionHelpersRef.current = [];
      lightAngleRingsRef.current = [];
      lightForwardCirclesRef.current = [];

      // Ambient light star at origin
      if (config?.ambient.enabled) {
        const starGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const starMat = new THREE.MeshBasicMaterial({
          color: 0xffcc33,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        });
        const star = new THREE.Mesh(starGeo, starMat);
        star.name = 'ambient-star';
        star.userData = { lightType: 'ambient' };
        lightHelpers.add(star);
      }

      // Spotlight cones + handles
      if (config) {
        config.spotlights.forEach((sp, idx) => {
          if (!sp.enabled) return;

          const spotlight = spotlightRefs.current[idx];
          if (!spotlight) return; // spotlights may not be created yet on first build

          // Cone visualization using LineSegments - a wireframe cone outline
          // that's always visible (depthTest false). Blue by default.
          const coneColor = sp.color === 0xffffff ? 0x44aaff : sp.color;
          const coneHeight = 3;
          const coneRadius = coneHeight * Math.tan(sp.angle);
          const segs = 16;
          const conePts: THREE.Vector3[] = [];
          // Tip at origin (before transform), base at -height
          const tip = new THREE.Vector3(0, 0, 0);
          const baseCenter = new THREE.Vector3(0, 0, -coneHeight);
          // Base circle
          for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            const p = new THREE.Vector3(
              Math.cos(a) * coneRadius,
              Math.sin(a) * coneRadius,
              -coneHeight
            );
            conePts.push(tip, p); // lines from tip to base perimeter
          }
          // Base ring
          for (let i = 0; i < segs; i++) {
            const a1 = (i / segs) * Math.PI * 2;
            const a2 = ((i + 1) / segs) * Math.PI * 2;
            conePts.push(
              new THREE.Vector3(Math.cos(a1) * coneRadius, Math.sin(a1) * coneRadius, -coneHeight),
              new THREE.Vector3(Math.cos(a2) * coneRadius, Math.sin(a2) * coneRadius, -coneHeight)
            );
          }
          const coneGeo = new THREE.BufferGeometry().setFromPoints(conePts);
          const coneMat = new THREE.LineBasicMaterial({
            color: coneColor,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
            linewidth: 2,
          });
          const cone = new THREE.LineSegments(coneGeo, coneMat);
          cone.name = `spotlight-cone-${idx}`;
          cone.position.set(
            sp.position.x,
            sp.position.y,
            sp.position.z
          );
            cone.userData = { spotlightIdx: idx, lightType: 'spotlight', handleType: 'cone', initialAngle: sp.angle };
           lightHelpers.add(cone);

          // Base circle (disk) at the cone's end - visualizes where light hits
          const baseGeo = new THREE.CircleGeometry(coneRadius, segs);
          const baseMat = new THREE.MeshBasicMaterial({
            color: coneColor,
            transparent: true,
            opacity: 0.08,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const base = new THREE.Mesh(baseGeo, baseMat);
          base.rotation.x = Math.PI;
          base.position.set(0, 0, -coneHeight);
          base.userData = { spotlightIdx: idx, lightType: 'spotlight', handleType: 'cone-base' };
          lightHelpers.add(base);

          // Position handle: sphere at the spotlight position for dragging
          const posGeo = new THREE.SphereGeometry(0.25, 16, 16);
          const posMat = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
          });
          const posHandle = new THREE.Mesh(posGeo, posMat);
          posHandle.name = `spotlight-pos-${idx}`;
          posHandle.position.set(
            sp.position.x,
            sp.position.y,
            sp.position.z
          );
          posHandle.userData = {
            spotlightIdx: idx,
            lightType: 'spotlight',
            handleType: 'position',
          };
          lightHelpers.add(posHandle);
          lightPositionHelpersRef.current.push(posHandle);

          // Angle ring: torus at the spotlight position, radius proportional
          // to angle at a representative distance. Dragging changes angle.
          const ringRadius = coneHeight * Math.tan(sp.angle);
          const ringGeo = new THREE.TorusGeometry(
            ringRadius, // radius matching the cone's beam at distance
            0.03,
            8,
            32
          );
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.7,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.name = `spotlight-angle-${idx}`;
          ring.position.copy(posHandle.position);
          ring.userData = {
            spotlightIdx: idx,
            lightType: 'spotlight',
            handleType: 'angle',
          };
           lightHelpers.add(ring);
          lightAngleRingsRef.current.push(ring);

          // Forward direction circle: a ring around the yellow position ball,
          // oriented in the plane perpendicular to the spotlight's forward
          // direction (position → target). Shows where the light projects.
          const fwdGeo = new THREE.TorusGeometry(0.4, 0.03, 6, 32);
          const fwdMat = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          const fwdCircle = new THREE.Mesh(fwdGeo, fwdMat);
          fwdCircle.name = `spotlight-forward-${idx}`;
          fwdCircle.position.copy(posHandle.position);
          const lightDir = new THREE.Vector3(
            (sp.target?.x ?? 0) - sp.position.x,
            (sp.target?.y ?? 0) - sp.position.y,
            (sp.target?.z ?? 0) - sp.position.z
          );
          if (lightDir.lengthSq() > 1e-9) {
            lightDir.normalize();
            fwdCircle.quaternion.setFromUnitVectors(
              new THREE.Vector3(0, 0, 1),
              lightDir
            );
          }
          fwdCircle.userData = {
            spotlightIdx: idx,
            lightType: 'spotlight',
            handleType: 'forward',
          };
          lightHelpers.add(fwdCircle);
          lightForwardCirclesRef.current.push(fwdCircle);
        });
      }
    };

    // Initial build
    buildLightHelpers(cfg ?? null);
    buildLightHelpersRef.current = buildLightHelpers;


    const gridGroup = new THREE.Group();
    // Rejilla azulada (hsl ~224), a juego con el fondo navy del interface
    const grid = new THREE.GridHelper(4, 16, 0x8fb0cc, 0x44506a);
    (grid.material as THREE.Material).opacity = 0.3;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = -1.05;
    gridGroup.add(grid);

    const gridAxes = new THREE.Group();
    const axisX = new THREE.Mesh(
      new THREE.BoxGeometry(2.02, 0.01, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.6 })
    );
    axisX.position.set(0, -1.04, 0);
    const axisZ = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 2.02),
      new THREE.MeshBasicMaterial({ color: 0x3366ff, transparent: true, opacity: 0.6 })
    );
    axisZ.position.set(0, -1.04, 0);
    gridAxes.add(axisX, axisZ);
     gridGroup.add(gridAxes);
     scene.add(gridGroup);
     gridGroupRef.current = gridGroup;

     // Ground plane: a large flat surface below the object that receives
     // shadows, giving the illusion of a real ground.
     const groundGeo = new THREE.PlaneGeometry(50, 50);
      const groundMat = new THREE.MeshPhysicalMaterial({
       color: 0x1a1a2e,
       roughness: 0.9,
       metalness: 0.0,
       side: THREE.DoubleSide,
     });
     const ground = new THREE.Mesh(groundGeo, groundMat);
     ground.rotation.x = -Math.PI / 2;
     ground.position.y = -1.1;
     ground.receiveShadow = true;
     ground.visible = showGround;
      scene.add(ground);
      groundRef.current = ground;

      const skyboxGeo = new THREE.SphereGeometry(50, 32, 32);
      skyboxRef.current = new THREE.Mesh(
        skyboxGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.BackSide,
          visible: true,
        })
      );
      skyboxRef.current.visible = false;
      scene.add(skyboxRef.current);

 
      const pathGroup = new THREE.Group();
      const pathTubeMat = new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const initialCurve = new THREE.CatmullRomCurve3(
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.001, 0)],
        false,
        'chordal'
      );
      const pathTubeGeo = new THREE.TubeGeometry(initialCurve, 1, 0.05, 8, false);
      const pathTube = new THREE.Mesh(pathTubeGeo, pathTubeMat);
      pathGroup.add(pathTube);

      const markerMat = new THREE.MeshBasicMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.9,
      });
      const markerGeo = new THREE.SphereGeometry(0.12, 8, 6);
      const marker1 = new THREE.Mesh(markerGeo, markerMat);
      const marker2 = new THREE.Mesh(markerGeo, markerMat);
      pathGroup.add(marker1);
      pathGroup.add(marker2);

      cameraPathRef.current = pathGroup;
      pathGroup.visible = false;
      scene.add(pathGroup);

      const cameraGizmoGroup = new THREE.Group();
      const gizmoCamGeo = new THREE.ConeGeometry(0.3, 0.5, 8);
      const gizmoCamMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
      const gizmoCam = new THREE.Mesh(gizmoCamGeo, gizmoCamMat);
      gizmoCam.rotation.z = Math.PI;
      const gizmoBodyGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8);
      const gizmoBody = new THREE.Mesh(gizmoBodyGeo, gizmoCamMat);
      gizmoBody.position.y = -0.65;
      cameraGizmoGroup.add(gizmoCam);
      cameraGizmoGroup.add(gizmoBody);
      cameraGizmoGroup.visible = false;
      scene.add(cameraGizmoGroup);
      cameraGizmoRef.current = cameraGizmoGroup;

      const meshGroup = new THREE.Group();
    meshGroup.receiveShadow = true;
    meshGroup.castShadow = true;
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const latheAxis = new THREE.Group();
    const latheAxisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.8, 0),
        new THREE.Vector3(0, 1.8, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0x55dd88,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: false,
      })
    );
    latheAxisLine.renderOrder = 10;
    latheAxis.add(latheAxisLine);
    latheAxis.visible = showLatheAxis;
    meshGroup.add(latheAxis);
    latheAxisRef.current = latheAxis;

    // Pieza amarilla de la ayuda de proyección: marco editable pegado al
    // objeto (hijo del grupo de la malla) con su propio manipulador.
    const textureHelperGroup = new THREE.Group();
    const textureHelperGizmoGroup = new THREE.Group();
    textureHelperGroup.visible = false;
    textureHelperGizmoGroup.visible = false;
    meshGroup.add(textureHelperGroup, textureHelperGizmoGroup);
    textureHelperGroupRef.current = textureHelperGroup;
    textureHelperGizmoGroupRef.current = textureHelperGizmoGroup;
    textureHelperHandlesRef.current = buildGizmoHandles(textureHelperGizmoGroup);

    const vertexGroup = new THREE.Group();
    scene.add(vertexGroup);
    vertexHelpersRef.current = vertexGroup;

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    planeRef.current = plane;

    // Grupos de efectos (partículas, halo de neón) y luz de fuego
    const effectsGroup = new THREE.Group();
    scene.add(effectsGroup);
    effectsGroupRef.current = effectsGroup;

    const glowGroup = new THREE.Group();
    scene.add(glowGroup);
    glowGroupRef.current = glowGroup;

    const fireLight = new THREE.PointLight(0xff8040, 0, 6, 1.6);
    fireLight.position.set(0, 0.2, 1.4);
    scene.add(fireLight);
    fireLightRef.current = fireLight;

    // Estrellas colocadas a mano (clic en el texto)
    const placedGroup = new THREE.Group();
    scene.add(placedGroup);
    placedStarsRef.current = { group: placedGroup, stars: [] };

    // Manipulador: flechas de ejes X/Y/Z (mover/estirar/rotar). Solo se
    // ve si el usuario lo activa con la casilla de la barra.
    const gizmoGroup = new THREE.Group();
    scene.add(gizmoGroup);
    gizmoGroup.visible = true;
    gizmoGroupRef.current = gizmoGroup;
    gizmoHandlesRef.current = buildGizmoHandles(gizmoGroup);

    // Light gizmo: 3-axis arrows for moving spotlights
    const lightGizmoGroup = new THREE.Group();
    lightGizmoGroup.visible = false;
    scene.add(lightGizmoGroup);
    lightGizmoGroupRef.current = lightGizmoGroup;
    lightGizmoHandlesRef.current = buildLightGizmoHandles(lightGizmoGroup);

    // Punto aleatorio de la superficie del texto: emisor de partículas
    const randomSurfacePoint = (): THREE.Vector3 | null => {
      const m = meshRef.current;
      if (!m || m.vertices.length === 0) return null;
      if (m.texture) {
        // Modo "vista plana": muestrea el rectángulo del panel
        const v = m.vertices;
        const x = v[0].x + Math.random() * (v[1].x - v[0].x);
        const y = v[0].y + Math.random() * (v[3].y - v[0].y);
        return new THREE.Vector3(x, y, 0);
      }
      const v = m.vertices[(Math.random() * m.vertices.length) | 0];
      return new THREE.Vector3(v.x, v.y, v.z);
    };
 
    getCameraPositionFromStateRef.current = (camState: Camera3D): THREE.Vector3 => {
     const dir = new THREE.Vector3();
     dir.x = Math.sin(camState.rotationY) * Math.cos(camState.rotationX);
     dir.y = Math.sin(camState.rotationX);
     dir.z = Math.cos(camState.rotationY) * Math.cos(camState.rotationX);
     dir.normalize();
     const dist = 5.5 / (camState.zoom || 1);
     return new THREE.Vector3(
       camState.offsetX + dir.x * dist,
       camState.offsetY + dir.y * dist,
       dir.z * dist
     );
   };
 
   const getCameraQuaternionFromState = (camState: Camera3D): THREE.Quaternion => {
     const rotX = camState.rotationX;
     const rotY = camState.rotationY;
     const quaternion = new THREE.Quaternion();
     quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
     const qY = new THREE.Quaternion();
     qY.setFromAxisAngle(new THREE.Vector3(0, 1, 1), rotY);
     quaternion.multiply(qY);
      return quaternion;
    };
  
    drawCameraPathRef.current = (track: AnimationTrack) => {
    if (!cameraPathRef.current) return;
    const pathGroup = cameraPathRef.current;
    const sortedKeys = [...track.keyframes].sort((a, b) => a.time - b.time);
    if (sortedKeys.length === 0) return;

    const positions: THREE.Vector3[] = [];
    for (const kf of sortedKeys) {
      const camState: Camera3D = {
        zoom: kf.values?.zoom ?? 1,
        offsetX: kf.values?.offsetX ?? 0,
        offsetY: kf.values?.offsetY ?? 0,
        rotationX: kf.values?.rotationX ?? 0,
        rotationY: kf.values?.rotationY ?? 0,
      };
      positions.push(getCameraPositionFromStateRef.current?.(camState) ?? new THREE.Vector3());
    }

    // Draw curve path (Catmull-Rom for smooth curve)
    const curve = new THREE.CatmullRomCurve3(positions, false, 'chordal');
    const segments = Math.max(positions.length * 10, 20);
    const tubeGeo = pathGroup.children[0] as THREE.Mesh;
    tubeGeo.geometry.dispose();
    tubeGeo.geometry = new THREE.TubeGeometry(curve, segments, 0.05, 8, false);
    tubeGeo.visible = true;

    // Position markers at keyframes
    const markerMat = pathGroup.children[1] as THREE.Mesh;
    const markerGeo = pathGroup.children[2] as THREE.Mesh;
    if (positions.length >= 1) {
      markerMat.position.copy(positions[0]);
      markerMat.visible = true;
    }
    if (positions.length >= 2) {
      markerGeo.position.copy(positions[positions.length - 1]);
      markerGeo.visible = true;
    }

    pathGroup.visible = true;
  };

    const clock = new THREE.Clock();
    const animStartTime = performance.now();
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      const dt = Math.min(clock.getDelta(), 0.05);

      const hasCameraTrack = animationTracksRef.current?.some((t) => t.objectId === null) ?? false;
      const effectiveTime = hasCameraTrack && cameraViewMode
        ? (performance.now() - animStartTime) / 1000
        : animationTimeRef.current;
      if (sparksRef.current?.points.visible) {
        updateSparks(sparksRef.current, dt, randomSurfacePoint);
      }
      if (fireRef.current?.points.visible) {
        updateFire(fireRef.current, dt, randomSurfacePoint);
      }
      if (starsRef.current?.group.visible) {
        updateStars(starsRef.current, dt, randomSurfacePoint, starSizeRef.current);
      }
      // Estrellas colocadas: latido suave + giro lento. Las aleatorias
      // se pausan mientras se está colocando para editar sin ruido.
      const placed = placedStarsRef.current;
      if (placed) {
        const tNow = clock.elapsedTime;
        const starSize = starSizeRef.current;
        placed.group.visible = placed.stars.length > 0;
        for (const star of placed.stars) {
          const pulse = 0.8 + 0.2 * Math.sin(tNow * 2.2 + star.phase);
          star.sprite.scale.setScalar(star.rawScale * starSize * pulse);
          star.sprite.material.rotation += dt * 0.35;
        }
      }
      if (starsRef.current) {
        starsRef.current.group.visible =
          fxStarsRef.current && !starPlacementRef.current;
      }
      if (fireLightRef.current) {
        // Fuego: luz cálida que parpadea
        const t = clock.elapsedTime;
        fireLightRef.current.intensity = fxFireRef.current
          ? 1.1 + Math.sin(t * 11.3) * 0.3 + Math.sin(t * 27.1) * 0.25
          : 0;
      }

      // Update light helper visuals each frame so cones follow lights
      const cfg = lightConfigRef.current;
      if (lightHelpersGroupRef.current && cfg) {
        for (const child of lightHelpersGroupRef.current.children) {
          const ud = child.userData as { lightType?: string; handleType?: string; spotlightIdx?: number };
          if (ud.lightType !== 'spotlight' || ud.spotlightIdx === undefined) continue;
          const idx = ud.spotlightIdx;
          const sp = cfg.spotlights[idx];
          if (!sp) continue;
          const lightPos = new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z);
          const lightDir = new THREE.Vector3(
            (sp.target?.x ?? 0) - lightPos.x,
            (sp.target?.y ?? 0) - lightPos.y,
            (sp.target?.z ?? 0) - lightPos.z
          );
          const hasDir = lightDir.lengthSq() > 1e-9;
          if (hasDir) lightDir.normalize();

          if (ud.handleType === 'cone' || ud.handleType === 'cone-base') {
            child.position.copy(lightPos);
            const initialAngle = child.userData.initialAngle || sp.angle;
            const scaleRatio = Math.tan(sp.angle) / Math.tan(initialAngle);
            child.scale.set(scaleRatio, 1, scaleRatio);
            // Orient cone to point from position toward target (cone built in -Z)
            if (hasDir) {
              child.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, -1),
                lightDir
              );
            }
          } else if (ud.handleType === 'forward') {
            child.position.copy(lightPos);
            // Orient so the ring is perpendicular to the forward direction
            if (hasDir) {
              child.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                lightDir
              );
            }
          }
        }
      }

      if (animationTracksRef.current && effectiveTime >= 0 && animationTracksRef.current.length > 0) {
        const tracks = animationTracksRef.current;
        for (const track of tracks) {
          const evaluated = evaluateTrack(track, effectiveTime * 1000);
          if (!evaluated) continue;
          const isCameraTrack = track.objectId === null;
          if (isCameraTrack) {
            const baseCam = camera3D ?? { zoom: 1, offsetX: 0, offsetY: 0, rotationX: 0, rotationY: 0 };
            const interpolated: Camera3D = {
              zoom: evaluated.zoom ?? baseCam.zoom,
              offsetX: evaluated.offsetX ?? baseCam.offsetX,
              offsetY: evaluated.offsetY ?? baseCam.offsetY,
              rotationX: evaluated.rotationX ?? baseCam.rotationX,
              rotationY: evaluated.rotationY ?? baseCam.rotationY,
            };
            if (cameraViewMode) {
              applyCamera(camera, controls, interpolated);
            } else if (showCameraPathGizmo) {
              const camPos = getCameraPositionFromStateRef.current?.(interpolated) ?? new THREE.Vector3();
              const camQuat = getCameraQuaternionFromState(interpolated);
              cameraGizmoRef.current!.position.copy(camPos);
              cameraGizmoRef.current!.quaternion.copy(camQuat);
              cameraGizmoRef.current!.visible = true;
            }
            if (!track.looping && effectiveTime * 1000 >= track.duration && !completedTracksRef.current.has(track.id)) {
              completedTracksRef.current.add(track.id);
              onAnimationCompleteRef.current?.(track.id);
            }
          }
          }
        }
       // Actualizar el CubeCamera para reflejos de espejo
       const cubeCam = cubeCameraRef.current;
       if (cubeCam) {
         cubeCam.position.copy(camera.position);
         cubeCam.position.y = Math.max(0.5, cubeCam.position.y);
         cubeCam.update(renderer, scene);
       }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    if (camera3D) {
      applyCamera(camera, controls, camera3D);
    }

    // Arrastre activo del manipulador: aplicar el movimiento/estirado/
    // rotación según cuánto avanza el puntero sobre el eje (o el ángulo
    // que barre alrededor de él).
    const updateGizmoDrag = () => {
      const drag = gizmoDragRef.current;
      if (!drag) return;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const isHelper = drag.target === 'texture';
      const t = isHelper
        ? textureHelperTransformRef.current
        : transformRef.current;
      // La pieza de textura vive en las coordenadas locales de la malla:
      // el rayo se pasa a ese espacio antes de medir el arrastre
      const ray =
        isHelper && drag.rayToLocal
          ? raycasterRef.current.ray.clone().applyMatrix4(drag.rayToLocal)
          : raycasterRef.current.ray;
      let next: ObjectTransform;
      if (drag.mode === 'rotate') {
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(drag.plane, hit)) return;
        const d = hit.sub(drag.startPos);
        const ang = Math.atan2(d.dot(drag.basisV), d.dot(drag.basisU));
        const dq = new THREE.Quaternion().setFromAxisAngle(
          drag.axisWorld,
          ang - drag.startAngle
        );
        const e = new THREE.Euler().setFromQuaternion(
          drag.startQuat.clone().premultiply(dq)
        );
        next = { ...t, rx: e.x, ry: e.y, rz: e.z };
      } else if (drag.mode === 'uniform-scale') {
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(drag.plane, hit)) return;
        const delta = hit.sub(drag.startPos).dot(drag.basisU);
        const factor = Math.max(0.05, 1 + delta);
        next = {
          ...t,
          sx: Math.max(0.05, drag.startScale.x * factor),
          sy: Math.max(0.05, drag.startScale.y * factor),
          sz: Math.max(0.05, drag.startScale.z * factor),
        };
      } else if (drag.mode === 'planar-scale') {
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(drag.plane, hit)) return;
        const delta = hit.sub(drag.startPos).dot(drag.basisU);
        const factor = Math.max(0.05, 1 + delta);
        next = { ...t };
        // Se estiran los dos ejes que NO son drag.axis (el eje guardado,
        // la altura, se queda tal cual)
        if (drag.axis === 'x') {
          next.sy = Math.max(0.05, drag.startScale.y * factor);
          next.sz = Math.max(0.05, drag.startScale.z * factor);
        } else if (drag.axis === 'y') {
          next.sx = Math.max(0.05, drag.startScale.x * factor);
          next.sz = Math.max(0.05, drag.startScale.z * factor);
        } else {
          next.sx = Math.max(0.05, drag.startScale.x * factor);
          next.sy = Math.max(0.05, drag.startScale.y * factor);
        }
      } else {
        const tc = closestPointOnAxis(ray, drag.startPos, drag.axisWorld);
        if (tc === null) return;
        const delta = tc - drag.startT;
        if (drag.mode === 'move') {
          next = {
            ...t,
            px: drag.startPos.x + drag.axisWorld.x * delta,
            py: drag.startPos.y + drag.axisWorld.y * delta,
            pz: drag.startPos.z + drag.axisWorld.z * delta,
          };
        } else {
          // Estirado: la distancia arrastrada se
          // suma al factor de escala de ese eje
          const s = Math.max(0.05, drag.startScale[drag.axis] + delta);
          next = { ...t };
          if (drag.axis === 'x') next.sx = s;
          else if (drag.axis === 'y') next.sy = s;
          else next.sz = s;
        }
      }
      if (isHelper) {
        // Se avisa en cada movimiento: así la textura va siguiendo la
        // pieza en vivo mientras se arrastra (igual que los vértices).
        textureHelperTransformRef.current = next;
        applyTextureHelperTransform(next);
        onTextureHelperTransformRef.current?.(next);
      } else {
        transformRef.current = next;
        applyObjectTransform(next);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (gizmoDragRef.current) {
        updateGizmoDrag();
        return;
      }

      // Light helper drag update
      if (lightDragRef.current) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const intersection = new THREE.Vector3();
        if (
          raycasterRef.current.ray.intersectPlane(
            lightDragRef.current.plane,
            intersection
          )
        ) {
          intersection.add(lightDragRef.current.offset);

          const cfg = lightConfigRef.current;
          if (!cfg) return;
          const idx = lightDragRef.current.spotlightIdx;
          const sp = cfg.spotlights[idx];
          if (!sp) return;

          if (lightDragRef.current.type === 'angle') {
            // Angle drag: vary the beam diameter — drag radially to make
            // the cone wider (outward) or narrower (inward)
            const lightPos = new THREE.Vector3(
              sp.position.x, sp.position.y, sp.position.z
            );
            const radialDist = intersection.distanceTo(lightPos);
            const coneHeight = 3;
            const newAngle = Math.atan(radialDist / coneHeight);
            const clampedAngle = Math.max(
              0.05,
              Math.min(Math.PI / 2 - 0.05, newAngle)
            );

            const updated: LightConfig = {
              ...cfg,
              spotlights: cfg.spotlights.map((s, i) =>
                i === idx ? { ...s, angle: clampedAngle } : s
              ),
            };
            onLightConfigChangeRef.current?.(updated);

             // Update angle ring + cone visuals: scale to reflect new angle
            const angleRing = lightAngleRingsRef.current[idx];
            const startAngle = lightDragRef.current.startAngle ?? sp.angle;
            const startScaleRatio = Math.tan(startAngle);
            const newScaleRatio = Math.tan(clampedAngle);
            const scaleRatio = startScaleRatio > 1e-9 ? newScaleRatio / startScaleRatio : 1;
            if (angleRing) {
              angleRing.scale.set(scaleRatio, scaleRatio, scaleRatio);
            }
            // Update cone + base scale immediately for visual feedback
            for (const child of lightHelpersGroupRef.current?.children ?? []) {
              if (
                child.userData.lightType === 'spotlight' &&
                child.userData.spotlightIdx === idx &&
                (child.userData.handleType === 'cone' || child.userData.handleType === 'cone-base')
              ) {
                child.scale.set(scaleRatio, 1, scaleRatio);
              }
            }
            return;
          }

          // Position drag: apply axis constraint if a modifier key is held
          const axis = lightDragRef.current.axisConstraint;
          if (axis && cfg) {
            if (sp) {
              if (axis === 'x') { intersection.y = sp.position.y; intersection.z = sp.position.z; }
              if (axis === 'y') { intersection.x = sp.position.x; intersection.z = sp.position.z; }
              if (axis === 'z') { intersection.x = sp.position.x; intersection.y = sp.position.y; }
            }
          }

          if (cfg && spotlightRefs.current[lightDragRef.current.spotlightIdx]) {
            const spotlight = spotlightRefs.current[lightDragRef.current.spotlightIdx];
            spotlight.position.copy(intersection);

            // Update the position handle visual
            const posHelper = lightPositionHelpersRef.current[lightDragRef.current.spotlightIdx];
            if (posHelper) {
              posHelper.position.copy(intersection);
            }

            // Update angle ring visual
            const angleRing = lightAngleRingsRef.current[lightDragRef.current.spotlightIdx];
            if (angleRing) {
              angleRing.position.copy(intersection);
            }

            // Update forward direction circle position
            const fwdCircle = lightForwardCirclesRef.current[lightDragRef.current.spotlightIdx];
            if (fwdCircle) {
              fwdCircle.position.copy(intersection);
            }

          // Update cone + base visual
          for (const child of lightHelpersGroupRef.current?.children ?? []) {
            if (child.userData.lightType === 'spotlight' && child.userData.spotlightIdx === lightDragRef.current.spotlightIdx) {
              if (child.userData.handleType === 'cone' || child.userData.handleType === 'cone-base') {
                child.position.copy(intersection);
              }
            }
          }

            // Notify parent of the change with updated position
            const idx = lightDragRef.current.spotlightIdx;
            const updated: LightConfig = {
              ...cfg,
              spotlights: cfg.spotlights.map((sp, i) =>
                i === idx
                  ? { ...sp, position: { x: intersection.x, y: intersection.y, z: intersection.z } }
                  : sp
              ),
            };
            onLightConfigChangeRef.current?.(updated);
          }
        }
        return;
      }

      // Light gizmo drag update (3-axis arrows + rotation rings)
      if (lightGizmoDragRef.current) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const t = lightGizmoDragRef.current;
        const cfg = lightConfigRef.current;
        if (!cfg) return;

        if (t.mode === 'move') {
          const tc = closestPointOnAxis(raycasterRef.current.ray, t.startPos, t.axisWorld);
          if (tc !== null) {
            const delta = tc - t.startT;
            const newPos = {
              x: t.startPos.x + t.axisWorld.x * delta,
              y: t.startPos.y + t.axisWorld.y * delta,
              z: t.startPos.z + t.axisWorld.z * delta,
            };

            const idx = t.spotlightIdx;
            spotlightRefs.current[idx]?.position.copy(
              new THREE.Vector3(newPos.x, newPos.y, newPos.z)
            );
            const updated: LightConfig = {
              ...cfg,
              spotlights: cfg.spotlights.map((sp, i) =>
                i === idx
                  ? { ...sp, position: { x: newPos.x, y: newPos.y, z: newPos.z } }
                  : sp
              ),
            };
              onLightConfigChangeRef.current?.(updated);

             lightGizmoGroupRef.current?.position.add(
               new THREE.Vector3(
                 t.axisWorld.x * delta,
                 t.axisWorld.y * delta,
                 t.axisWorld.z * delta
               )
             );

             // Rebuild cone + handles with updated position so forward circle
             // and cone follow immediately as a rigid body.
             buildLightHelpersRef.current?.(updated);
          }
        } else if (t.mode === 'rotate') {
           // Rotate: compute angle on the plane perpendicular to the axis.
           // The spotlight direction (startDir) is rotated around the axis
           // by deltaAngle — everything (cone, forward circle, angle ring)
           // follows as a rigid body via buildLightHelpers(updated).
           const plane = new THREE.Plane();
           plane.setFromNormalAndCoplanarPoint(t.axisWorld, t.startPos);
           const hit = new THREE.Vector3();
           if (raycasterRef.current.ray.intersectPlane(plane, hit)) {
             const dir = new THREE.Vector3().subVectors(hit, t.startPos);
             dir.projectOnPlane(t.axisWorld);
             if (dir.lengthSq() > 1e-6) {
               dir.normalize();

               const refDir = new THREE.Vector3().crossVectors(t.axisWorld, new THREE.Vector3(0, 1, 0));
               if (refDir.lengthSq() < 1e-6) {
                 refDir.crossVectors(t.axisWorld, new THREE.Vector3(0, 0, 1));
               }
               refDir.normalize();

               const newAngle = Math.atan2(
                 dir.dot(new THREE.Vector3().crossVectors(t.axisWorld, refDir)),
                 dir.dot(refDir)
               );
               const deltaAngle = newAngle - t.startT;

               // Rotate the spotlight direction around the light position.
               // Everything rotates together as a rigid body.
               const idx = t.spotlightIdx;
               const sp = cfg.spotlights[idx];
               if (sp) {
                 const lightPos = new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z);
                 const targetPos = new THREE.Vector3(
                   sp.target?.x ?? 0,
                   sp.target?.y ?? 0,
                   sp.target?.z ?? 0
                 );
                 // Current direction and distance from light to target
                 const dirToTarget = new THREE.Vector3().subVectors(targetPos, lightPos);
                 const targetDist = dirToTarget.length();

                 // Use stored startDir if available (from pointer-down),
                 // otherwise fall back to current direction.
                 const baseDir = (t.startDir && t.startDir.lengthSq() > 1e-9)
                   ? t.startDir.clone()
                   : (targetDist > 1e-9 ? dirToTarget.clone().normalize() : new THREE.Vector3(0, 0, -1));

                 // Rotate baseDir around axisWorld by deltaAngle
                 const rotMatrix = new THREE.Matrix4().makeRotationAxis(t.axisWorld, deltaAngle);
                 baseDir.applyMatrix4(rotMatrix).normalize();

                 const newTarget = lightPos.clone().add(baseDir.multiplyScalar(targetDist || 1));
                 const updated: LightConfig = {
                   ...cfg,
                   spotlights: cfg.spotlights.map((s, i) =>
                     i === idx
                       ? {
                           ...s,
                           position: { x: lightPos.x, y: lightPos.y, z: lightPos.z },
                           target: { x: newTarget.x, y: newTarget.y, z: newTarget.z },
                         }
                       : s
                   ),
                 };
                 onLightConfigChangeRef.current?.(updated);

                 // Update the actual spotlight target
                 const spotlight = spotlightRefs.current[idx];
                 if (spotlight) {
                   spotlight.target.position.copy(newTarget);
                 }

                 // Update light gizmo position
                 lightGizmoGroupRef.current?.position.copy(lightPos);

                 // Rebuild cone + handles with updated target so forward circle
                 // and cone orient to the new direction immediately.
                 buildLightHelpersRef.current?.(updated);
               }
             }
           }
         }
        return;
      }

      // Cursor de mano al pasar por encima de un asa del manipulador o de
      // la pieza de textura
      const hoverHandles =
        gizmoOnRef.current && gizmoGroupRef.current?.visible
          ? gizmoHandlesRef.current
          : [];
      const helperHandles =
        textureHelperOnRef.current && textureHelperGizmoGroupRef.current?.visible
          ? textureHelperHandlesRef.current
          : [];
      if (
        (hoverHandles.length > 0 || helperHandles.length > 0) &&
        !dragRef.current
      ) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hover = raycasterRef.current.intersectObjects(
          [...hoverHandles, ...helperHandles],
          false
        );
        renderer.domElement.style.cursor = hover.length > 0 ? 'pointer' : '';
      }

      // Hover cursor for light helpers (when not dragging)
      if (lightHelpersGroupRef.current && !lightDragRef.current && !dragRef.current) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const interactiveHelpers = [
          ...lightPositionHelpersRef.current,
          ...lightAngleRingsRef.current,
        ];
        if (interactiveHelpers.length > 0) {
          const lightHover = raycasterRef.current.intersectObjects(
            interactiveHelpers,
            false
          );
          renderer.domElement.style.cursor = lightHover.length > 0 ? 'grab' : '';
        }

        // Hover for light gizmo arrows
        if (lightGizmoGroupRef.current?.visible && !lightDragRef.current) {
          const gizmoHits = raycasterRef.current.intersectObjects(
            lightGizmoHandlesRef.current,
            false
          );
          if (gizmoHits.length > 0) {
            const ud = gizmoHits[0].object.userData as { axis: GizmoAxis; mode: string };
            renderer.domElement.style.cursor = ud.mode === 'move' ? `grab` : '';
          }
        }
      }
      if (dragRef.current) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const intersection = new THREE.Vector3();
        if (
          planeRef.current &&
          raycasterRef.current.ray.intersectPlane(
            planeRef.current,
            intersection
          )
        ) {
          intersection.add(dragRef.current.offset);
          // El plano de arrastre vive en coordenadas de MUNDO, pero los
          // helpers (y los vértices de la malla) están en el espacio
          // LOCAL del grupo, que puede estar movido/rotado/estirado
          const group = vertexHelpersRef.current;
          const local = group
            ? group.worldToLocal(intersection.clone())
            : intersection.clone();
          dragRef.current.object.position.copy(local);
          const idx = dragRef.current.index;
          const verts = [...meshRef.current.vertices];
          verts[idx] = {
            x: local.x,
            y: local.y,
            z: local.z,
          };
          onVerticesChangeRef.current?.(verts);
        }
      }
    };

    // Colocación de estrellas: clic (sin arrastre) sobre el texto añade
    // una estrella; clic cerca de una colocada la quita.
    const handleStarPlacementClick = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const placed = placedStarsRef.current;
      // Las estrellas colocadas viven en el espacio LOCAL del grupo
      // (que sigue la transform del objeto): el rayo se pasa a local
      // para poder comparar contra sus posiciones.
      if (placed) {
        const inv = new THREE.Matrix4()
          .copy(placed.group.matrixWorld)
          .invert();
        const localRay = raycasterRef.current.ray.clone().applyMatrix4(inv);
        if (removePlacedStarAt(placed, localRay)) {
          return;
        }
      }
      if (!placed || !meshGroupRef.current) return;
      const meshes = meshGroupRef.current.children.filter(
        (c): c is THREE.Mesh => c instanceof THREE.Mesh
      );
      const hits = raycasterRef.current.intersectObjects(meshes, false);
      if (hits.length > 0 && placed) {
        addPlacedStar(
          placed,
          placed.group.worldToLocal(hits[0].point.clone()),
          starSizeRef.current
        );
      }
    };

    // Construye los datos de un arrastre del manipulador para el
    // transform dado. `ray`, `camDir` y `screenUp` van en el mismo
    // espacio en el que viven px/py/pz y rx/ry/rz (mundo para el objeto,
    // local de la malla para la pieza de textura), así la misma
    // matemática sirve para los dos.
    const makeGizmoDrag = (
      ud: {
        axis: GizmoAxis;
        mode: 'move' | 'scale' | 'uniform-scale' | 'planar-scale' | 'rotate';
      },
      t: ObjectTransform,
      ray: THREE.Ray,
      camDir: THREE.Vector3,
      screenUp: THREE.Vector3,
      target: 'object' | 'texture',
      rayToLocal?: THREE.Matrix4
    ): GizmoDrag | null => {
      const pos = new THREE.Vector3(t.px, t.py, t.pz);
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(t.rx, t.ry, t.rz)
      );
      // El eje local, girado por la rotación actual
      const axisWorld = GIZMO_AXIS_DIR[ud.axis]
        .clone()
        .applyQuaternion(quat);
      if (ud.mode === 'rotate') {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          axisWorld,
          pos
        );
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(plane, hit)) return null;
        // Base del plano: la dirección de la cámara proyectada, para
        // que el ángulo no salte aunque se gire la vista
        let basisU = camDir
          .clone()
          .sub(axisWorld.clone().multiplyScalar(camDir.dot(axisWorld)));
        if (basisU.lengthSq() < 1e-6) {
          basisU = new THREE.Vector3(1, 0, 0);
        }
        basisU.normalize();
        const basisV = new THREE.Vector3().crossVectors(axisWorld, basisU);
        const d = hit.clone().sub(pos);
        return {
          target,
          axis: ud.axis,
          mode: 'rotate',
          axisWorld,
          startPos: pos,
          startScale: new THREE.Vector3(t.sx, t.sy, t.sz),
          startQuat: quat,
          startT: 0,
          plane,
          basisU,
          basisV,
          startAngle: Math.atan2(d.dot(basisV), d.dot(basisU)),
          rayToLocal,
        };
      }
      if (ud.mode === 'uniform-scale' || ud.mode === 'planar-scale') {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camDir,
          pos
        );
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(plane, hit)) return null;
        return {
          target,
          axis: ud.axis,
          mode: ud.mode,
          axisWorld: screenUp,
          startPos: hit,
          startScale: new THREE.Vector3(t.sx, t.sy, t.sz),
          startQuat: quat,
          startT: 0,
          plane,
          basisU: screenUp,
          basisV: new THREE.Vector3(),
          startAngle: 0,
          rayToLocal,
        };
      }
      const t0 = closestPointOnAxis(ray, pos, axisWorld);
      if (t0 === null) return null;
      return {
        target,
        axis: ud.axis,
        mode: ud.mode,
        axisWorld,
        startPos: pos,
        startScale: new THREE.Vector3(t.sx, t.sy, t.sz),
        startQuat: quat,
        startT: t0,
        plane: new THREE.Plane(),
        basisU: new THREE.Vector3(),
        basisV: new THREE.Vector3(),
        startAngle: 0,
        rayToLocal,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (starPlacementRef.current) {
        // Registrar el punto inicial: solo coloca si NO hubo arrastre
        // (así girar la cámara con arrastre no coloca estrellas).
        placeDownRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // Light gizmo (3-axis arrows + rotation rings): if click hits a handle, start drag
      if (lightGizmoGroupRef.current?.visible && !lightDragRef.current) {
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const lightGizmoHits = raycasterRef.current.intersectObjects(
          lightGizmoHandlesRef.current,
          false
        );
        if (lightGizmoHits.length > 0) {
          const ud = lightGizmoHits[0].object.userData as {
            axis: GizmoAxis;
            mode: 'move' | 'rotate';
          };
          const cfg = lightConfigRef.current;
          if (cfg) {
            const firstSpot = cfg.spotlights.find((s) => s.enabled);
            if (firstSpot) {
              const spotlightIdx = cfg.spotlights.indexOf(firstSpot);
              const startPos = new THREE.Vector3(
                firstSpot.position.x,
                firstSpot.position.y,
                firstSpot.position.z
              );

              if (ud.mode === 'move') {
                const axisWorld = GIZMO_AXIS_DIR[ud.axis].clone();
                const t0 = closestPointOnAxis(
                  raycasterRef.current.ray,
                  startPos,
                  axisWorld
                );
                if (t0 !== null) {
                  lightGizmoDragRef.current = {
                    spotlightIdx,
                    axis: ud.axis,
                    axisWorld,
                    startPos,
                    startT: t0,
                    mode: 'move',
                  };
                  controls.enabled = false;
                  renderer.domElement.style.cursor = 'grabbing';
                  return;
                }
              } else if (ud.mode === 'rotate') {
                // Rotation: rotate spotlight direction around this axis
                const axisWorld = GIZMO_AXIS_DIR[ud.axis].clone();
                // Plane perpendicular to the rotation axis
                const plane = new THREE.Plane();
                plane.setFromNormalAndCoplanarPoint(
                  axisWorld,
                  startPos
                );
                const hit = new THREE.Vector3();
               if (raycasterRef.current.ray.intersectPlane(plane, hit)) {
                  // Reference direction: from spotlight position toward target
                  const lightDir = new THREE.Vector3(
                    (firstSpot.target?.x ?? 0) - startPos.x,
                    (firstSpot.target?.y ?? 0) - startPos.y,
                    (firstSpot.target?.z ?? 0) - startPos.z
                  );
                  const targetDist = lightDir.length();
                  const startDir = targetDist > 1e-9
                    ? lightDir.normalize()
                    : new THREE.Vector3(0, 0, -1);

                   const refDir = new THREE.Vector3().crossVectors(axisWorld, new THREE.Vector3(0, 1, 0));
                   if (refDir.lengthSq() < 1e-6) {
                     refDir.crossVectors(axisWorld, new THREE.Vector3(0, 0, 1));
                   }
                   refDir.normalize();

                   // Project startDir onto the rotation plane to get start angle
                   const startProj = startDir.clone().projectOnPlane(axisWorld);
                   if (startProj.lengthSq() < 1e-6) {
                     startProj.crossVectors(axisWorld, refDir).cross(axisWorld);
                   }
                   if (startProj.lengthSq() < 1e-6) startProj.set(1, 0, 0);
                   startProj.normalize();

                   const startAngle = Math.atan2(
                     startProj.dot(new THREE.Vector3().crossVectors(axisWorld, refDir)),
                     startProj.dot(refDir)
                   );

                  lightGizmoDragRef.current = {
                    spotlightIdx,
                    axis: ud.axis,
                    axisWorld,
                    startPos,
                    startT: startAngle,
                    mode: 'rotate',
                    startDir,
                  };
                  controls.enabled = false;
                  renderer.domElement.style.cursor = 'grabbing';
                  return;
                }
              }
            }
          }
        }
      }

      // Light helper drag: intercept clicks on spotlight position handles or angle rings.
      // Only check handles, not the cone visualization (which is non-interactive).
      if (lightHelpersGroupRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        // Build list of interactive helpers only (position handles + angle rings)
        const interactiveHelpers = [
          ...lightPositionHelpersRef.current,
          ...lightAngleRingsRef.current,
        ];
        const lightHits = raycasterRef.current.intersectObjects(
          interactiveHelpers,
          false
        );
        if (lightHits.length > 0) {
          const hit = lightHits[0];
          const ud = hit.object.userData as {
            lightType: 'ambient' | 'spotlight';
            handleType?: 'position' | 'angle';
            spotlightIdx?: number;
          };
          if (ud.lightType === 'spotlight' && ud.handleType) {
            const rect2 = renderer.domElement.getBoundingClientRect();
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            const worldPos = hit.object.getWorldPosition(
              new THREE.Vector3()
            );
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(
              camDir.clone().negate(),
              worldPos
            );
             const offset = new THREE.Vector3().subVectors(
               worldPos,
               hit.point
             );
             const dragType = ud.handleType ?? 'position';
             const cfg = lightConfigRef.current;
             const sp = cfg?.spotlights[ud.spotlightIdx ?? 0];
             lightDragRef.current = {
                type: dragType,
                spotlightIdx: ud.spotlightIdx ?? 0,
                plane,
                offset,
                axisConstraint: e.shiftKey ? 'x' : e.altKey ? 'y' : e.ctrlKey ? 'z' : null,
                startAngle: sp ? sp.angle : undefined,
                startScreenPos: dragType === 'angle' && sp
                  ? { x: e.clientX - rect2.left, y: e.clientY - rect2.top }
                  : undefined,
              };
            controls.enabled = false;
            renderer.domElement.style.cursor = 'grabbing';
            return;
          }
        }
      }

      // Manipulador: si el clic cae sobre un asa, empieza su arrastre y
      // no se toca nada más (ni vértices ni cámara)
      if (gizmoOnRef.current && gizmoGroupRef.current?.visible) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hits = raycasterRef.current.intersectObjects(
          gizmoHandlesRef.current,
          false
        );
        if (hits.length > 0) {
          const ud = hits[0].object.userData as {
            axis: GizmoAxis;
            mode: 'move' | 'scale' | 'uniform-scale' | 'planar-scale' | 'rotate';
          };
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const screenUp = camera.up
            .clone()
            .applyQuaternion(camera.quaternion)
            .normalize();
          const drag = makeGizmoDrag(
            ud,
            transformRef.current,
            raycasterRef.current.ray,
            camDir,
            screenUp,
            'object'
          );
          if (!drag) return;
          gizmoDragRef.current = drag;
          controls.enabled = false;
          renderer.domElement.style.cursor = 'grabbing';
          return;
        }
      }
      // Manipulador de la pieza de textura: igual que el del objeto, pero
      // su transform vive en las coordenadas LOCALES de la malla (las
      // mismas con las que se calculan las UV), así que el rayo del
      // puntero se pasa a ese espacio antes de medir el arrastre.
      if (
        textureHelperOnRef.current &&
        textureHelperGizmoGroupRef.current?.visible
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hits = raycasterRef.current.intersectObjects(
          textureHelperHandlesRef.current,
          false
        );
        if (hits.length > 0) {
          const ud = hits[0].object.userData as {
            axis: GizmoAxis;
            mode: 'move' | 'scale' | 'uniform-scale' | 'planar-scale' | 'rotate';
          };
          const meshGroup = meshGroupRef.current;
          if (!meshGroup) return;
          meshGroup.updateMatrixWorld();
          const rayToLocal = new THREE.Matrix4()
            .copy(meshGroup.matrixWorld)
            .invert();
          const localRay = raycasterRef.current.ray
            .clone()
            .applyMatrix4(rayToLocal);
          // Direcciones de la cámara pasadas a local (solo el giro: una
          // dirección no se estira con la escala del grupo)
          const invRot = meshGroup
            .getWorldQuaternion(new THREE.Quaternion())
            .invert();
          const camDir = camera
            .getWorldDirection(new THREE.Vector3())
            .applyQuaternion(invRot)
            .normalize();
          const screenUp = camera.up
            .clone()
            .applyQuaternion(camera.quaternion)
            .applyQuaternion(invRot)
            .normalize();
          const drag = makeGizmoDrag(
            ud,
            textureHelperTransformRef.current,
            localRay,
            camDir,
            screenUp,
            'texture',
            rayToLocal
          );
          if (!drag) return;
          gizmoDragRef.current = drag;
          controls.enabled = false;
          renderer.domElement.style.cursor = 'grabbing';
          return;
        }
      }
      if (meshGroupRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const objectHits = raycasterRef.current.intersectObjects(
          meshGroupRef.current.children,
          true
        );
        if (objectHits.length > 0) {
          let selectedObject: THREE.Object3D | null = objectHits[0].object;
          while (selectedObject && !selectedObject.userData.sceneObjectId) {
            selectedObject = selectedObject.parent;
          }
          if (selectedObject?.userData.sceneObjectId) {
            onObjectSelectRef.current?.(selectedObject.userData.sceneObjectId);
            if (selectedObject.userData.sceneObjectId !== selectedObjectIdRef.current) return;
          }
        }
      }
      if (!showVertices) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      if (!vertexHelpersRef.current) return;
      const hits = raycasterRef.current.intersectObjects(
        vertexHelpersRef.current.children,
        false
      );
      raycasterRef.current.params.Mesh.threshold = 0.05;
      if (hits.length > 0) {
        const hit = hits[0];
        let selectedObject: THREE.Object3D | null = hit.object;
        while (selectedObject && !selectedObject.userData.sceneObjectId) {
          selectedObject = selectedObject.parent;
        }
        if (selectedObject?.userData.sceneObjectId) {
          onObjectSelectRef.current?.(selectedObject.userData.sceneObjectId);
          if (!showVertices) return;
        }
        const obj = hit.object as THREE.Mesh;
        const idx = (obj.userData as any).index;
        controls.enabled = false;
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        // El plano de arrastre y el desfase se miden en MUNDO: el grupo
        // de helpers puede estar movido/rotado/estirado (manipulador)
        const worldPos = obj.getWorldPosition(new THREE.Vector3());
        planeRef.current = new THREE.Plane();
        planeRef.current.setFromNormalAndCoplanarPoint(
          camDir.clone().negate(),
          worldPos
        );
        const offset = new THREE.Vector3().subVectors(
          worldPos,
          hit.point
        );
        dragRef.current = { object: obj, offset, index: idx };
        setSelectedVertex(idx);
        renderer.domElement.style.cursor = 'grabbing';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (starPlacementRef.current && placeDownRef.current) {
        const dx = e.clientX - placeDownRef.current.x;
        const dy = e.clientY - placeDownRef.current.y;
        placeDownRef.current = null;
        if (dx * dx + dy * dy < 36) {
          handleStarPlacementClick(e.clientX, e.clientY);
        }
        return;
      }

      // Release light helper drag
      if (lightDragRef.current) {
        lightDragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        return;
      }

      // Release light gizmo drag (3-axis arrows)
      if (lightGizmoDragRef.current) {
        lightGizmoDragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        return;
      }

      if (gizmoDragRef.current) {
        const wasHelper = gizmoDragRef.current.target === 'texture';
        gizmoDragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        // Confirma el transform arrastrado (estado + aviso al editor).
        // La pieza de textura ya avisó en cada movimiento (la textura va
        // en vivo), así que aquí solo queda confirmar el del objeto.
        if (!wasHelper) {
          const t = transformRef.current;
          setTransform(t);
          onObjectTransformRef.current?.(t);
        }
        return;
      }
      if (dragRef.current) {
        dragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      for (const h of gizmoHandlesRef.current) {
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
      }
      gizmoHandlesRef.current = [];
      for (const h of textureHelperHandlesRef.current) {
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
      }
      textureHelperHandlesRef.current = [];
      gizmoDragRef.current = null;
      renderer.dispose();
      for (const sys of [sparksRef.current, fireRef.current]) {
        if (sys) {
          sys.points.geometry.dispose();
          (sys.points.material as THREE.Material)?.dispose();
        }
      }
      sparksRef.current = null;
      fireRef.current = null;
      if (starsRef.current) {
        for (const star of starsRef.current.stars) {
          star.sprite.material.dispose();
        }
      }
      starsRef.current = null;
      if (placedStarsRef.current) {
        for (const star of placedStarsRef.current.stars) {
          star.sprite.material.dispose();
        }
        placedStarsRef.current.stars = [];
        placedStarsRef.current = null;
      }
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [showVertices]);

  useEffect(() => {
    if (latheAxisRef.current) latheAxisRef.current.visible = showLatheAxis;
  }, [showLatheAxis]);

  useEffect(() => {
    const axis = latheAxisRef.current;
    if (!axis || mesh.vertices.length === 0) return;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const vertex of mesh.vertices) {
      min.min(new THREE.Vector3(vertex.x, vertex.y, vertex.z));
      max.max(new THREE.Vector3(vertex.x, vertex.y, vertex.z));
    }
    const height = Math.max(0.1, max.y - min.y);
    axis.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    axis.scale.set(1, height / 3.6, 1);
  }, [mesh, showLatheAxis]);

  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;
    for (const child of [...meshGroup.children]) {
      // Las copias ya pegadas conservan su propia geometría y material.
      // Solo se vuelve a crear el objeto que se está editando.
      if (
        child === latheAxisRef.current ||
        child === textureHelperGroupRef.current ||
        child === textureHelperGizmoGroupRef.current ||
        child.userData.sceneObjectDuplicate
      ) continue;
      meshGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        disposeMaterial(child.material);
      }
    }

    // Busca esta parte donde se maneja mesh.texture y reemplázala:
    let cancelled = false;

    // --- SI HAY TEXTURA, CONSTRUIR MALLA CON TEXTURA ---
    if (mesh.texture && !smoothShading && !wireframe) {
      // Limpiar grupo
      for (const child of [...meshGroup.children]) {
        if (
          child === latheAxisRef.current ||
          child === textureHelperGroupRef.current ||
          child === textureHelperGizmoGroupRef.current ||
          child.userData.sceneObjectDuplicate
        ) continue;
        meshGroup.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          disposeMaterial(child.material);
        }
      }

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const v of mesh.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      // Pieza de textura: su colocación se aplica SIEMPRE (la casilla
      // solo esconde la pieza, no la desactiva), así que lo que se mueve
      // se mantiene al quitar la ayuda. En reposo es la identidad y las
      // UV salen exactamente igual que siempre. Con la pieza colocada,
      // cada vértice se lleva primero al espacio de la pieza (se le
      // quita su posición, su escala y su giro) y las fórmulas de
      // siempre se aplican sobre ese punto.
      const ht = textureHelperTransform ?? IDENTITY_TRANSFORM;
      const helperActive = !isIdentityTransform(ht);
      const hInv = ht
        ? new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(ht.rx, ht.ry, ht.rz))
          .invert()
        : null;
      const mapToHelper = (v: Vertex3D): Vertex3D => {
        if (!ht || !hInv) return v;
        const q = new THREE.Vector3(
          (v.x - ht.px) / (ht.sx || 1),
          (v.y - ht.py) / (ht.sy || 1),
          (v.z - ht.pz) / (ht.sz || 1)
        ).applyQuaternion(hInv);
        return { x: q.x, y: q.y, z: q.z };
      };
      const projectionUv = (v: Vertex3D): [number, number] => {
        const p = mapToHelper(v);
        const angle = Math.atan2(p.z, p.x);
        const u = (angle / (Math.PI * 2) + 1) % 1;
        if (textureProjection === 'planar') {
          return [(p.x - minX) / rangeX, 1 - (p.y - minY) / rangeY];
        }
        if (textureProjection === 'spherical') {
          const length = Math.max(1e-6, Math.hypot(p.x, p.y, p.z));
          return [u, 1 - Math.acos(p.y / length) / Math.PI];
        }
        return [u, 1 - (p.y - minY) / rangeY];
      };

      // Construir geometría con UVs
      for (const face of mesh.faces) {
        if (face.length < 3) continue;
        const v0 = mesh.vertices[face[0]];
        const v1 = mesh.vertices[face[1]];
        const v2 = mesh.vertices[face[2]];
        if (!v0 || !v1 || !v2) continue;

        const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
        const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
        const n = e1.cross(e2).normalize();

        const baseIdx = positions.length / 3;
        for (const idx of face) {
          const v = mesh.vertices[idx];
          if (!v) continue;
          positions.push(v.x, v.y, v.z);
          normals.push(n.x, n.y, n.z);

          // UVs: si existen, usarlos; si no, generar coordenadas básicas.
          // En cuanto la pieza se ha movido del reposo, ella manda (se
          // juega con la textura a mano, no con las UV precalculadas).
          if (
            !helperActive &&
            mesh.uvs &&
            mesh.uvs[idx] &&
            textureProjection === 'planar'
          ) {
            uvs.push(mesh.uvs[idx][0], mesh.uvs[idx][1]);
          } else {
            uvs.push(...projectionUv(v));
          }
        }
        // Triangulación
        for (let i = 1; i < face.length - 1; i++) {
          indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
        }
      }

      if (positions.length === 0) return;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      // Material con color blanco para que la textura se vea bien
      const opacity = typeof mesh.opacity === 'number'
        ? Math.max(0, Math.min(1, mesh.opacity))
        : 1;
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: (mesh.textureFinish ?? objectTextureFinish) === 'glossy' ? 0 : (mesh.textureFinish ?? objectTextureFinish) === 'matte' ? 0.05 : (mesh.textureFinish ?? objectTextureFinish) === 'mirror' ? 1 : 0.3,
        roughness: (mesh.textureFinish ?? objectTextureFinish) === 'glossy' ? 0 : (mesh.textureFinish ?? objectTextureFinish) === 'matte' ? 0.9 : (mesh.textureFinish ?? objectTextureFinish) === 'mirror' ? 0.05 : 0.45,
        clearcoat: (mesh.textureFinish ?? objectTextureFinish) === 'glossy' ? 0 : (mesh.textureFinish ?? objectTextureFinish) === 'mirror' ? 1 : 0,
        clearcoatRoughness: (mesh.textureFinish ?? objectTextureFinish) === 'glossy' ? 0.015 : (mesh.textureFinish ?? objectTextureFinish) === 'mirror' ? 0 : 0,
        side: THREE.DoubleSide,
        map: null, // Se cargará después
        bumpMap: null,
        bumpScale: (mesh.textureRelief ?? 0) * 0.5,
        transparent: true,
        opacity,
        alphaTest: 0,
        envMapIntensity: (mesh.textureFinish ?? objectTextureFinish) === 'mirror' ? 1.5 : 0,
      });

      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;
      meshGroup.add(meshObj);

      // Cargar la textura
      const loader = new THREE.TextureLoader();
      loader.load(
        mesh.texture,
        (texture) => {
          if (cancelled) return;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          texture.needsUpdate = true;
          material.map = texture;
          material.bumpMap = texture;
          material.bumpScale = (mesh.textureRelief ?? 0) * 0.5;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        },
        undefined,
        (err) => {
          console.error('Error loading texture:', err);
          material.color.set(0xcccccc); // Fallback
        }
      );

      // Líneas de wireframe si está activado
      if (wireframe) {
        const edgeGeo = new THREE.EdgesGeometry(geometry, 1);
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x8fb0cc,
          transparent: true,
          opacity: 0.9,
        });
        meshGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));
      }

      return () => {
        cancelled = true;
        geometry.dispose();
        material.dispose();
      };
    }

    const faceColors = mesh.faceColors;
    const useFaceColors =
      !!faceColors &&
      faceColors.length === mesh.faces.length &&
      faceColors.some((c) => !!c);

    // --- Malla lisa por cortes (vistas) y malla suave del texto: geometría
    // indexada con normales por vértice, para que la superficie entre
    // cortes se vea continua. Con caras planas (flat shading) cada banda
    // entre cortes coge su propia iluminación y el objeto parece hecho
    // de capas apiladas. Admite colores por cara (texto con emojis):
    // se vuelcan como atributo de vértice — los vértices compartidos
    // quedan con el último color escrito, imperceptible en letras
    // monocromas (todo del mismo color) y en emojis (regiones grandes).
    if (smoothShading) {
      const positions: number[] = [];
      const index: number[] = [];
      const uvs: number[] = [];
      mesh.vertices.forEach((v) => positions.push(v.x, v.y, v.z));
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const v of mesh.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      // Pieza de textura: mismo criterio que en la malla con textura —
      // la colocación se aplica SIEMPRE (la casilla solo esconde la
      // pieza); en reposo es la identidad y no cambia nada.
      const ht = textureHelperTransform ?? IDENTITY_TRANSFORM;
      const helperActive = !isIdentityTransform(ht);
      const hInv = ht
        ? new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(ht.rx, ht.ry, ht.rz))
          .invert()
        : null;
      const mapToHelper = (v: Vertex3D): Vertex3D => {
        if (!ht || !hInv) return v;
        const q = new THREE.Vector3(
          (v.x - ht.px) / (ht.sx || 1),
          (v.y - ht.py) / (ht.sy || 1),
          (v.z - ht.pz) / (ht.sz || 1)
        ).applyQuaternion(hInv);
        return { x: q.x, y: q.y, z: q.z };
      };
      mesh.vertices.forEach((vertex, index) => {
        if (!helperActive && textureProjection === 'planar' && mesh.uvs?.[index]) {
          uvs.push(mesh.uvs![index][0], mesh.uvs![index][1]);
          return;
        }
        const p = mapToHelper(vertex);
        const angle = Math.atan2(p.z, p.x);
        const u = (angle / (Math.PI * 2) + 1) % 1;
        if (textureProjection === 'planar') {
          uvs.push((p.x - minX) / rangeX, 1 - (p.y - minY) / rangeY);
          return;
        }
        if (textureProjection === 'spherical') {
          const length = Math.max(1e-6, Math.hypot(p.x, p.y, p.z));
          uvs.push(u, 1 - Math.acos(p.y / length) / Math.PI);
        } else {
          uvs.push(u, 1 - (p.y - minY) / rangeY);
        }
      });
      for (const face of mesh.faces) {
        if (face.length < 3) continue;
        for (let j = 1; j + 1 < face.length; j++) {
          index.push(face[0], face[j], face[j + 1]);
        }
      }
      if (index.length === 0) return;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
      );
      if (uvs.length > 0) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      }
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      const hasFaceOpacity =
        !!mesh.faceOpacities && mesh.faceOpacities.length === mesh.faces.length;
      if (hasFaceOpacity) {
        let indexStart = 0;
        mesh.faces.forEach((face, faceIndex) => {
          const indexCount = Math.max(0, (face.length - 2) * 3);
          if (indexCount > 0) {
            const faceOpacity = Math.max(
              0,
              Math.min(1, mesh.faceOpacities![faceIndex] ?? 1)
            );
            geometry.addGroup(indexStart, indexCount, faceOpacity < 1 ? 1 : 0);
            indexStart += indexCount;
          }
        });
      }

      if (useFaceColors) {
        const colors = new Float32Array(mesh.vertices.length * 3).fill(1);
        const col = new THREE.Color();
        let faceIndex = 0;
        for (const face of mesh.faces) {
          const hex = faceColors![faceIndex++] ?? null;
          if (!hex || face.length < 3) continue;
          col.set(hex);
          for (const vi of face) {
            colors[vi * 3] = col.r;
            colors[vi * 3 + 1] = col.g;
            colors[vi * 3 + 2] = col.b;
          }
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }

      if (wireframe) {
        const edgePositions: number[] = [];
        const edgeSet = new Set<string>();
        for (const face of mesh.faces) {
          if (face.length < 2) continue;
          for (let i = 0; i < face.length; i++) {
            const a = face[i];
            const b = face[(i + 1) % face.length];
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (edgeSet.has(key)) continue;
            edgeSet.add(key);
            const va = mesh.vertices[a];
            const vb = mesh.vertices[b];
            if (!va || !vb) continue;
            edgePositions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
          }
        }
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(edgePositions, 3)
        );
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x8fb0cc,
          transparent: true,
          opacity: 0.9,
        });
        meshGroup.add(new THREE.LineSegments(edgeGeometry, edgeMat));
      } else {
        const uniformFaceColor = useFaceColors
          ? faceColors!.find((color): color is string => !!color) ?? null
          : null;
        const allFacesShareColor = !!uniformFaceColor && faceColors!.every(
          (color) => !color || color === uniformFaceColor
        );
        const material = new THREE.MeshPhysicalMaterial({
          // Con vertexColors el color base debe ser blanco para que el
          // color de cada cara salga exacto (multiplicación)
          color: mesh.texture ? 0xffffff :
            (allFacesShareColor ? uniformFaceColor! : useFaceColors ? 0xffffff : 0xdedede),
          vertexColors: useFaceColors && !mesh.texture && !allFacesShareColor,
          metalness: mesh.textureFinish === 'glossy' ? 0.1 : mesh.textureFinish === 'matte' ? 0.05 : 0.1,
          roughness: mesh.textureFinish === 'glossy' ? 0.025 : mesh.textureFinish === 'matte' ? 0.9 : 0.45,
          clearcoat: mesh.textureFinish === 'glossy' ? 1 : 0,
          clearcoatRoughness: mesh.textureFinish === 'glossy' ? 0.015 : 0,
          side: THREE.DoubleSide,
          map: null,
          bumpMap: null,
          bumpScale: (mesh.textureRelief ?? 0) * 0.5,
          alphaTest: mesh.texture ? 0 : 0,
          // La textura del texto incluye un canal alfa, pero las tapas ya
          // siguen el contorno del glifo. Tratarlas como transparentes hace
          // que el frente parezca translúcido incluso con la opacidad de
          // costado al 100%. La transparencia de los laterales se asigna
          // abajo, en su material independiente.
          transparent: typeof mesh.opacity === 'number' && mesh.opacity < 1,
          opacity: typeof mesh.opacity === 'number' ? Math.max(0, Math.min(1, mesh.opacity)) : 1,
        });
        const sideOpacity = hasFaceOpacity
          ? Math.max(0, Math.min(1, mesh.faceOpacities!.find((value) => value < 1) ?? 1))
          : 1;
        const sideMaterial = hasFaceOpacity
          ? material.clone()
          : material;
        if (hasFaceOpacity) {
          sideMaterial.transparent = sideOpacity < 1;
          sideMaterial.opacity = sideOpacity;
          sideMaterial.depthWrite = sideOpacity >= 1;
          sideMaterial.needsUpdate = true;
        }
        const meshMaterials = hasFaceOpacity
          ? [material, sideMaterial]
          : material;
        const meshObj = new THREE.Mesh(
          geometry,
          meshMaterials
        );
        meshObj.castShadow = true;
        meshObj.receiveShadow = true;
        meshGroup.add(meshObj);

        if (mesh.texture) {
          const loader = new THREE.TextureLoader();
          loader.load(mesh.texture, (texture) => {
            if (cancelled) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            const materials = Array.isArray(meshMaterials)
              ? meshMaterials
              : [meshMaterials];
            const targetOpacity = typeof mesh.opacity === 'number'
              ? Math.max(0, Math.min(1, mesh.opacity))
              : 1;
            for (const currentMaterial of materials) {
              currentMaterial.map = texture;
              currentMaterial.bumpMap = texture;
              currentMaterial.bumpScale = (mesh.textureRelief ?? 0) * 0.5;
              currentMaterial.color.set(mesh.textureColor ?? 0xffffff);
              // NO forzar transparent = false. Respetar lo que ya tenía
              // (las caras del costado con opacidad parcial lo necesitan).
              currentMaterial.needsUpdate = true;
            }
          });
        }
      }
      return;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const colorAttr: number[] = [];
    let faceIndex = 0;

    for (const face of mesh.faces) {
      const hex = useFaceColors
        ? (faceColors![faceIndex] ?? '#ffffff')
        : null;
      faceIndex++;
      if (face.length < 3) continue;
      const v0 = mesh.vertices[face[0]];
      const v1 = mesh.vertices[face[1]];
      const v2 = mesh.vertices[face[2]];
      if (!v0 || !v1 || !v2) continue;
      const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
      const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
      const n = e1.cross(e2).normalize();
      const col = hex ? new THREE.Color(hex) : null;
      for (const idx of face) {
        const v = mesh.vertices[idx];
        if (!v) continue;
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        if (col) colorAttr.push(col.r, col.g, col.b);
      }
    }

    if (positions.length === 0) return;

    const hasVertexColors =
      useFaceColors &&
      colorAttr.length > 0 &&
      colorAttr.length === positions.length;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );
    if (hasVertexColors) {
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colorAttr, 3)
      );
    }

    if (wireframe) {
      const edgePositions: number[] = [];
      const edgeSet = new Set<string>();
      for (const face of mesh.faces) {
        if (face.length < 2) continue;
        for (let i = 0; i < face.length; i++) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          const va = mesh.vertices[a];
          const vb = mesh.vertices[b];
          if (!va || !vb) continue;
          edgePositions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        }
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(edgePositions, 3)
      );
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x8fb0cc,
        transparent: true,
        opacity: 0.9,
      });
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      meshGroup.add(edgeLines);

      const ghostMat = new THREE.MeshStandardMaterial({
        color: hasVertexColors ? 0xffffff : 0x9db4c8,
        vertexColors: hasVertexColors,
        metalness: 0.1,
        roughness: 0.6,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 0,
      });
      const ghostMesh = new THREE.Mesh(geometry, ghostMat);
      meshGroup.add(ghostMesh);
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: hasVertexColors ? 0xffffff : 0xdedede,
        vertexColors: hasVertexColors,
        metalness: 0.3,
        roughness: 0.45,
        flatShading: true,
        side: THREE.DoubleSide,
        transparent: typeof mesh.opacity === 'number' && mesh.opacity < 1,
        opacity: typeof mesh.opacity === 'number' ? Math.max(0, Math.min(1, mesh.opacity)) : 1,
        envMapIntensity: 0,
      });
      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;
      meshGroup.add(meshObj);

      const edges = new THREE.EdgesGeometry(geometry, 1);
      const lineMat = new THREE.LineBasicMaterial({
        color: hasVertexColors ? 0x000000 : 0x444444,
        transparent: true,
        opacity: hasVertexColors ? 0.35 : 0.6,
      });
      const wireOverlay = new THREE.LineSegments(edges, lineMat);
      meshGroup.add(wireOverlay);
    }
  }, [mesh, wireframe, smoothShading, textureProjection, textureHelperTransform]);

  // Pieza de textura: el transform que fija su manipulador va al marco
  // (posición, giro y tamaño) y a sus asas (solo posición y giro).
  useEffect(() => {
    applyTextureHelperTransform(
      textureHelperTransform ?? IDENTITY_TRANSFORM
    );
  }, [textureHelperTransform, applyTextureHelperTransform]);

  // La pieza amarilla se reconstruye al cambiar el tipo de proyección o
  // la malla, porque su tamaño y su sitio dependen de la figura.
  useEffect(() => {
    const visual = textureHelperGroupRef.current;
    const giz = textureHelperGizmoGroupRef.current;
    if (!visual || !giz) return;
    const on = !!textureHelper && mesh.vertices.length > 0;
    for (const child of [...visual.children]) {
      visual.remove(child);
      child.traverse((item) => {
        const mesh = item as THREE.Mesh & { geometry?: THREE.BufferGeometry };
        mesh.geometry?.dispose();
        const material = (item as THREE.Mesh).material;
        if (material) disposeMaterial(material);
      });
    }
    visual.visible = on;
    giz.visible = on;
    if (on) {
      visual.add(buildTextureHelperVisual(textureProjection, mesh.vertices));
    }
    applyTextureHelperTransform(textureHelperTransformRef.current);
  }, [textureHelper, textureProjection, mesh, applyTextureHelperTransform]);

  // Clona el material del cortador para el preview boolean (no mutar el original)
  const cloneAndStyleToolMaterial = (original: THREE.Material): THREE.Material => {
    const clone = original.clone();
    (clone as any).isPreviewClone = true;
    (clone as any).originalMaterial = original;
    clone.transparent = true;
    clone.opacity = 0.35;
    (clone as any).color = new THREE.Color(0xffaa00);
    return clone;
  };

   useEffect(() => {
   const meshGroup = meshGroupRef.current;
   if (!meshGroup || !objects?.length) return;

    const selected = objects.find((object) => object.id === selectedObjectId);
    if (!selected) return;
    const previouslyDisplayedId = displayedObjectIdRef.current;

    // La malla principal representa siempre el objeto activo: al cambiar
    // la selección se reconstruye con la figura del recién elegido (es
    // la malla que llega como prop). La copia que tenía en la escena ya
    // no hace falta —su figura es ahora la principal— y la figura del
    // que se deja la crea el bucle de abajo con sus propios datos.
    if (previouslyDisplayedId && previouslyDisplayedId !== selected.id) {
      const staleDuplicate = meshGroup.children.find(
        (child) => child.userData.sceneObjectDuplicate && child.userData.sceneObjectId === selected.id
      );
      if (staleDuplicate) {
        meshGroup.remove(staleDuplicate);
        staleDuplicate.traverse((item) => {
          const childMesh = item as THREE.Mesh;
          childMesh.geometry?.dispose();
          if (childMesh.material) disposeMaterial(childMesh.material);
        });
      }
    }

    meshGroup.userData.sceneObjectId = selected.id;
    displayedObjectIdRef.current = selected.id;
    const selectedMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(selected.transform.px, selected.transform.py, selected.transform.pz),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(selected.transform.rx, selected.transform.ry, selected.transform.rz)
      ),
      new THREE.Vector3(selected.transform.sx, selected.transform.sy, selected.transform.sz)
    );
    const inverseSelected = selectedMatrix.clone().invert();

    for (const object of objects) {
      if (object.id === selected.id) continue;
      let duplicate = meshGroup.children.find(
        (child) => child.userData.sceneObjectDuplicate && child.userData.sceneObjectId === object.id
      ) as THREE.Group | undefined;
      if (!duplicate) {
        duplicate = new THREE.Group();
        duplicate.userData.sceneObjectId = object.id;
        duplicate.userData.sceneObjectDuplicate = true;
        // El dueño de la configuración muestra la figura de la pestaña
        // actual (la malla que el editor construye ahora) pero con SU
        // textura —la guardada en su instantánea— y no la que haya en
        // pantalla mientras se ajusta una copia pegada. Sin instantánea
        // (proyectos cargados antiguos) se usa la malla de la
        // configuración tal cual. Las demás copias traen su propia
        // instantánea, y la clonación de la figura activa queda como
        // último recurso.
        if (object.id === configObjectId) {
          const ownerBase = configMesh ?? mesh;
          if (ownerBase && ownerBase.vertices.length > 0 && object.mesh && object.mesh.vertices.length > 0) {
            duplicate.add(
              buildSnapshotObjectVisual(
                {
                  ...ownerBase,
                  texture: object.mesh.texture,
                  textureColor: object.mesh.texture
                    ? object.mesh.textureColor ?? '#ffffff'
                    : undefined,
                  textureRelief: object.mesh.textureRelief,
                  textureFinish: object.mesh.textureFinish,
                },
                configSmooth ?? smoothShading,
                object.textureProjection ?? configProjection ?? textureProjection
              )
            );
          } else {
            duplicate.add(
              buildSnapshotObjectVisual(
                configMesh ?? mesh,
                configSmooth ?? smoothShading,
                configProjection ?? textureProjection
              )
            );
          }
        } else if (object.mesh && object.mesh.vertices.length > 0) {
          duplicate.add(
            buildSnapshotObjectVisual(
              object.mesh,
              object.smooth ?? false,
              object.textureProjection ?? 'planar'
            )
          );
        } else {
          for (const child of [...meshGroup.children]) {
            if (child === latheAxisRef.current || child.userData.sceneObjectDuplicate) continue;
            duplicate.add(cloneObjectVisual(child));
          }
         }
         meshGroup.add(duplicate);
       }
        // En modo boolean preview: el objeto cortador se muestra transparente
        if (booleanToolObjectId === object.id) {
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && child.material) {
              const mat = Array.isArray(child.material)
                ? child.material.map((m) => cloneAndStyleToolMaterial(m))
                : cloneAndStyleToolMaterial(child.material);
              child.material = mat;
            }
          });
        }
        // Si no es el tool: restaurar material (no clone — restaurar el original)
        if (booleanToolObjectId !== object.id) {
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && child.material) {
              // Si el material fue clonado para preview, restaurar el original
              if ((child.material as any).isPreviewClone && (child.material as any).originalMaterial) {
                child.material = (child.material as any).originalMaterial;
              }
            }
          });
        }
      const objectMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(object.transform.px, object.transform.py, object.transform.pz),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(object.transform.rx, object.transform.ry, object.transform.rz)
        ),
        new THREE.Vector3(object.transform.sx, object.transform.sy, object.transform.sz)
      );
      duplicate.matrix.copy(inverseSelected).multiply(objectMatrix);
      duplicate.matrixAutoUpdate = false;
    }
  }, [
    objects,
    selectedObjectId,
    mesh,
    configObjectId,
    configMesh,
    booleanToolObjectId,
    forceObjectsUpdate,
    configSmooth,
    configProjection,
    smoothShading,
    textureProjection,
    ]);

    // --- Modo boolean preview: aplicar transparencia naranja al cortador
    // --- (toolId) tanto si es un duplicate como si es el mesh principal
    // --- (activa). El resto de objetos se muestran normales.
    useEffect(() => {
      const meshGroup = meshGroupRef.current;
      if (!meshGroup || !booleanToolObjectId) return;
      meshGroup.traverse(function (child) {
        if (!(child instanceof THREE.Mesh) || !child.material) return;
        const mat: any = child.material;
        // Sólo actuar sobre mesh principal del activo (no duplicates)
        if (!child.userData.sceneObjectDuplicate) {
          if (booleanToolObjectId === selectedObjectId) {
            // El activo es el cortador: estilizar
            if (!mat.isBooleanPreview) {
              const original = child.material;
              const clone = original.clone();
              clone.transparent = true;
              clone.opacity = 0.35;
              clone.color.set(0xffaa00);
              (clone as any).isBooleanPreview = true;
              (clone as any).originalMaterial = original;
              child.material = clone;
            }
          } else if (mat.isBooleanPreview) {
            // El activo dejó de ser el cortador: restaurar
            child.material = mat.originalMaterial;
          }
        }
      });
    }, [selectedObjectId, booleanToolObjectId, mesh, forceObjectsUpdate]);
 
    // --- Halo de neón: copia un poco más grande de cada malla, con
  // --- material aditivo por detrás: brilla alrededor del texto sin
  // --- tocar la malla original. En modo "vista plana" se omite.
  useEffect(() => {
    const glowGroup = glowGroupRef.current;
    const meshGroup = meshGroupRef.current;
    if (!glowGroup) return;
    while (glowGroup.children.length > 0) {
      glowGroup.remove(glowGroup.children[0]);
    }
    if (!glowValue || !meshGroup || meshRef.current.texture) return;
    for (const child of meshGroup.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const shell = new THREE.Mesh(child.geometry, getGlowMaterial());
      shell.scale.setScalar(1.1);
      glowGroup.add(shell);
    }
   }, [mesh, glowValue]);

   // --- Chispas: partículas brillantes que saltan desde el texto ---
   useEffect(() => {
     const group = effectsGroupRef.current;
     if (!group) return;
     if (sparksValue && !sparksRef.current) {
       sparksRef.current = createParticleSystem(140, 0.035);
       group.add(sparksRef.current.points);
     }
     if (sparksRef.current) sparksRef.current.points.visible = sparksValue;
   }, [sparksValue]);

   // --- Fuego: partículas de llama que suben por el texto ---
   useEffect(() => {
     const group = effectsGroupRef.current;
     if (!group) return;
     if (fireValue && !fireRef.current) {
       fireRef.current = createParticleSystem(160, 0.11);
       group.add(fireRef.current.points);
     }
     if (fireRef.current) fireRef.current.points.visible = fireValue;
   }, [fireValue]);

  // --- Estrellas de brillo: destellos en cruz sobre el texto ---
  useEffect(() => {
    const group = effectsGroupRef.current;
    if (!group) return;
    if (fxStars && !starsRef.current) {
      starsRef.current = createStarSystem();
      group.add(starsRef.current.group);
    }
    if (starsRef.current) starsRef.current.group.visible = fxStars;
  }, [fxStars]);

  // --- Modo colocación de estrellas: cursor de mira ---
  useEffect(() => {
    const dom = rendererRef.current?.domElement;
    if (dom) dom.style.cursor = starPlacement ? 'crosshair' : '';
  }, [starPlacement]);

  // Al cambiar el texto, las estrellas colocadas pierden su sitio:
  // se quitan para no quedar flotando fuera de la figura.
  useEffect(() => {
    clearPlacedStars(placedStarsRef.current);
  }, [mesh]);

  useEffect(() => {
    const vertexGroup = vertexHelpersRef.current;
    if (!vertexGroup) return;
    while (vertexGroup.children.length > 0) {
      const child = vertexGroup.children[0];
      vertexGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
      ((child as THREE.Mesh).material as THREE.Material)?.dispose();
    }
    if (!showVertices) return;

    // Geometría y materiales compartidos: con mallas de miles de vértices,
    // una esfera por vértice sería una geometría (y un coste) por punto
    const r = vertexSizeRef.current;
    const geo = new THREE.SphereGeometry(r, 8, 8);
    const matNormal = new THREE.MeshBasicMaterial({ color: 0x66aaff });
    const matSelected = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    mesh.vertices.forEach((v, i) => {
      const sphere = new THREE.Mesh(
        geo,
        i === selectedVertex ? matSelected : matNormal
      );
      sphere.position.set(v.x, v.y, v.z);
      sphere.scale.setScalar(r > 0.001 ? 1 : 0.0001);
      (sphere.userData as any).index = i;
      vertexGroup.add(sphere);
    });
  }, [mesh.vertices, showVertices, selectedVertex, vertexSize]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Show light gizmo at the first enabled spotlight's position
  useEffect(() => {
    const gizmo = lightGizmoGroupRef.current;
    if (!gizmo) return;

    const cfg = lightConfigRef.current;
    if (!cfg) {
      gizmo.visible = false;
      return;
    }

    const firstSpot = cfg.spotlights.find((s) => s.enabled);
    if (firstSpot) {
      gizmo.position.set(
        firstSpot.position.x,
        firstSpot.position.y,
        firstSpot.position.z
      );
      gizmo.visible = true;
    } else {
      gizmo.visible = false;
    }
   }, [lightConfig]);

   // Toggle light helper visuals (cones, rings, position balls, forward circles)
   useEffect(() => {
     const group = lightHelpersGroupRef.current;
     if (!group) return;
     group.visible = showLightHelpers;
   }, [showLightHelpers]);

   // Toggle ground plane visibility
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
    ground.visible = showGround;
  }, [showGround]);

  // Skybox background image
  useEffect(() => {
    const scene = sceneRef.current;
    const skybox = skyboxRef.current;
    if (!scene || !skybox) return;
    const material = skybox.material as THREE.MeshBasicMaterial;
    if (skyboxImage) {
      const loader = new THREE.TextureLoader();
      loader.load(skyboxImage, (texture) => {
        material.map = texture;
        material.needsUpdate = true;
      });
      skybox.visible = true;
      scene.background = null;
    } else {
      material.map = null;
      material.needsUpdate = true;
      skybox.visible = false;
      scene.background = new THREE.Color('hsl(224, 50%, 7%)');
    }
  }, [skyboxImage]);

   // Ground texture
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
     const material = ground.material as THREE.MeshPhysicalMaterial;
    if (groundTexture) {
      const loader = new THREE.TextureLoader();
      loader.load(groundTexture, (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4);
        material.map = texture;
        applyGroundTextureFinish(material, groundTextureFinish);
        material.needsUpdate = true;
      });
    } else {
      material.map = null;
      material.roughness = 0.9;
      material.metalness = 0.0;
      material.needsUpdate = true;
    }
   }, [groundTexture, groundTextureFinish]);

  const applyGroundTextureFinish = (material: THREE.MeshPhysicalMaterial, finish: string) => {
    material.envMap = cubeRenderTargetRef.current?.texture ?? null;
    material.envMapIntensity = finish === 'mirror' ? 1.5 : 0;
    material.needsUpdate = true;
    switch (finish) {
      case 'glossy':
        material.roughness = 0.1;
        material.metalness = 0.0;
        break;
      case 'mirror':
        material.roughness = 0.05;
        material.metalness = 1.0;
        material.clearcoat = 1;
        material.clearcoatRoughness = 0;
        // Reflejo dinámico del cubecamera (solo para espejo)
        material.envMap = cubeRenderTargetRef.current?.texture ?? null;
        material.envMapIntensity = 1.5;
        material.needsUpdate = true;
        break;
      case 'matte':
        material.roughness = 0.95;
        material.metalness = 0.0;
        break;
      case 'semi-matte':
      default:
        material.roughness = 0.7;
        material.metalness = 0.0;
        break;
    }
  };

   // Update camera path and gizmo when tracks change (not during playback)
   useEffect(() => {
     if (!showCameraPathGizmo) return;
     const cameraTrack = animationTracks?.find((t) => t.objectId === null);
     if (!cameraTrack || cameraTrack.keyframes.length === 0) return;
     drawCameraPathRef.current?.(cameraTrack);
   }, [animationTracks, showCameraPathGizmo]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (lightConfig) {
      // Modo personalizado: aplicar configuración de luces.
      // Always maintain a minimum ambient floor so the object is evenly
      // lit from all camera angles, regardless of spotlight direction.
      if (ambientLightRef.current) {
        ambientLightRef.current.color.setHex(lightConfig.ambient.color);
        ambientLightRef.current.intensity = Math.max(
          lightConfig.ambient.enabled ? lightConfig.ambient.intensity : 0,
          0.45
        );
        ambientLightRef.current.visible = true;
      }
      if (dirLightRef.current) dirLightRef.current.visible = false;
      if (fillLightRef.current) fillLightRef.current.visible = false;
      if (rimLightRef.current) rimLightRef.current.visible = false;

      // Remover spotlights antiguos
      spotlightRefs.current.forEach((s) => {
        scene.remove(s);
        s.dispose();
      });
      spotlightRefs.current = [];

      // Crear nuevos spotlights
      for (const sp of lightConfig.spotlights) {
        if (!sp.enabled) continue;
        const spotlight = new THREE.SpotLight(
          sp.color,
          sp.intensity,
          undefined,
          sp.angle,
          sp.penumbra
        );
        spotlight.decay = 0; // no distance attenuation - light visible at all distances
        spotlight.position.set(sp.position.x, sp.position.y, sp.position.z);
        // Set target so the spotlight points toward the model
        spotlight.target.position.set(
          sp.target?.x ?? 0,
          sp.target?.y ?? 0,
          sp.target?.z ?? 0
        );
        scene.add(spotlight);
        scene.add(spotlight.target);
        spotlight.castShadow = sp.castShadow;
        if (sp.castShadow) {
          spotlight.shadow.intensity = sp.shadowIntensity;
          (spotlight.shadow as any).color?.setHex(sp.shadowColor);
          spotlight.shadow.mapSize.width = 1024;
          spotlight.shadow.mapSize.height = 1024;
          spotlight.shadow.camera.near = 0.1;
          spotlight.shadow.camera.far = 20;
        }
        spotlightRefs.current.push(spotlight);
      }
    } else {
      const preset = LIGHT_PRESETS[lightPreset] ?? LIGHT_PRESETS[0];
      if (ambientLightRef.current) {
        ambientLightRef.current.color.setHex(preset.ambient);
        ambientLightRef.current.intensity = preset.ambientIntensity;
      }
      if (dirLightRef.current) {
        dirLightRef.current.color.setHex(preset.dir);
        dirLightRef.current.intensity = preset.dirIntensity;
        dirLightRef.current.visible = true;
      }
      if (fillLightRef.current) {
        fillLightRef.current.color.setHex(preset.fill);
        fillLightRef.current.intensity = preset.fillIntensity;
        fillLightRef.current.visible = true;
      }
      if (rimLightRef.current) {
        rimLightRef.current.color.setHex(preset.rim);
        rimLightRef.current.intensity = preset.rimIntensity;
        rimLightRef.current.visible = true;
      }
    }

    // Rebuild light helpers for whichever config is active
    buildLightHelpersRef.current?.(lightConfig ?? null);
  }, [lightPreset, lightConfig]);

   useEffect(() => {
     const gridGroup = gridGroupRef.current;
     if (gridGroup) gridGroup.visible = gridValue;
   }, [gridValue]);

  useEffect(() => {
    // La base se amplía solo sobre el suelo: su altura no cambia.
    gridGroupRef.current?.scale.set(gridScale, 1, gridScale);
  }, [gridScale]);

  // El transform del objeto (fijado por el manipulador) se aplica a la
  // malla y a todo lo que la acompaña.
  useEffect(() => {
    transformRef.current = transform;
    applyObjectTransform(transform);
  }, [transform, applyObjectTransform]);

  // Transform dictado desde fuera (prop): se adopta tal cual.
  useEffect(() => {
    if (objectTransform) setTransform(objectTransform);
  }, [objectTransform]);

  // Manipulador: visible solo si está activado y hay objeto; su tamaño
  // se ajusta al del objeto (esferas de radio de la malla).
  useEffect(() => {
    const g = gizmoGroupRef.current;
    if (!g) return;
    g.visible = showGizmo && mesh.vertices.length > 0;
    if (mesh.vertices.length === 0) return;
    const box = new THREE.Box3();
    for (const v of mesh.vertices) {
      box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
    }
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const objectScale = Math.max(
      Math.abs(transform.sx),
      Math.abs(transform.sy),
      Math.abs(transform.sz)
    );
    g.scale.setScalar(Math.min(Math.max(r * 0.9 * objectScale, 0.35), 8));
  }, [showGizmo, mesh.vertices, transform]);

  // Captura el texto 3D como PNG con fondo transparente (solo la malla).
  // Si el suavizado está activo, la captura usa una COPIA suavizada de la
  // malla (curvas redondeadas, sin escalones de vóxeles); la malla
  // original se restaura intacta inmediatamente después.
  const capturePNG = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const gridGroup = gridGroupRef.current;
    const vertexGroup = vertexHelpersRef.current;
    const gizmoGroup = gizmoGroupRef.current;
    const meshGroup = meshGroupRef.current;
    if (!renderer || !scene || !camera) return;

    const prevGridVisible = gridGroup?.visible ?? true;
    const prevVertexVisible = vertexGroup?.visible ?? true;
    const prevGizmoVisible = gizmoGroup?.visible ?? false;
    if (gridGroup) gridGroup.visible = false;
    if (vertexGroup) vertexGroup.visible = false;
    if (gizmoGroup) gizmoGroup.visible = false;

    const currentMesh = meshRef.current;
    const doSmooth =
      smoothCapture &&
      !!meshGroup &&
      !wireframe &&
      !currentMesh.texture &&
      currentMesh.vertices.length > 0;

    const savedChildren = meshGroup ? [...meshGroup.children] : [];
    let tempObjects: THREE.Object3D[] = [];
    if (doSmooth && meshGroup) {
      tempObjects = buildSmoothCaptureObjects(currentMesh);
      if (tempObjects.length > 0) {
        for (const child of savedChildren) meshGroup.remove(child);
        for (const obj of tempObjects) meshGroup.add(obj);
      } else {
        tempObjects = [];
      }
    }

    // Halo de neón durante la captura suavizada: se envuelve la
    // geometría suavizada temporal para que el brillo siga el contorno
    const glowGroup = glowGroupRef.current;
    const savedGlowChildren = glowGroup ? [...glowGroup.children] : [];
    let tempGlow: THREE.Object3D[] = [];
     if (doSmooth && glowValue && glowGroup && tempObjects[0] instanceof THREE.Mesh) {
      const shell = new THREE.Mesh(
        (tempObjects[0] as THREE.Mesh).geometry,
        getGlowMaterial()
      );
      shell.scale.setScalar(1.1);
      tempGlow = [shell];
      for (const child of savedGlowChildren) glowGroup.remove(child);
      glowGroup.add(shell);
    }

    // El scene.background pinta un color opaco sobre el canvas y anula
    // la transparencia del PNG; se quita solo durante la captura.
    const prevBackground = scene.background;
    scene.background = null;

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');

    scene.background = prevBackground;

    if (glowGroup && tempGlow.length > 0) {
      for (const obj of tempGlow) glowGroup.remove(obj);
      for (const child of savedGlowChildren) glowGroup.add(child);
    }

    if (meshGroup && tempObjects.length > 0) {
      for (const obj of tempObjects) {
        meshGroup.remove(obj);
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          disposeMaterial(obj.material);
        }
      }
      for (const child of savedChildren) meshGroup.add(child);
    }

    if (gridGroup) gridGroup.visible = prevGridVisible;
    if (vertexGroup) vertexGroup.visible = prevVertexVisible;
    if (gizmoGroup) gizmoGroup.visible = prevGizmoVisible;

    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'texto-3d.png';
    link.click();
   }, [smoothCapture, wireframe, glowValue]);

  const resetCamera = useCallback(() => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (cam && ctrl) {
      cam.position.set(3, 2.5, 4);
      ctrl.target.set(0, 0, 0);
      ctrl.update();
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold">Editor 3D</span>
          <span className="text-[10px] text-muted-foreground/60 font-mono">
            {mesh.vertices.length} vért · {mesh.faces.length} caras
          </span>
        </div>
        {mesh.texture && (
          <span className="text-[10px] text-green-400/60 font-mono">
            · textura
          </span>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <ToggleButton
            active={showVertices}
            onClick={() => setShowVertices(!showVertices)}
            title="Mostrar/ocultar vértices"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </ToggleButton>
          {showVertices && (
            <div className="flex items-center gap-1 px-1" title="Tamaño de vértices">
              <Slider
                min={0}
                max={0.04}
                step={0.002}
                value={[vertexSize]}
                onValueChange={([v]) => setVertexSize(v)}
                className="w-14"
              />
            </div>
          )}
          <label
            className="flex items-center gap-1 px-1 cursor-pointer select-none"
            title="Flechas de los ejes X/Y/Z sobre el objeto: arrastra la flecha o la bolita del color del eje para MOVERLO en esa dirección, la bolita amarilla para ESTIRARLO en esa dirección y el aro del color del eje para ROTARLO alrededor de ese eje"
          >
            <input
              type="checkbox"
              checked={showGizmo}
              onChange={(e) => setShowGizmo(e.target.checked)}
              className="w-3 h-3 accent-green-500 cursor-pointer"
            />
            <span className="text-[10px] font-medium text-muted-foreground">
              Flechas XYZ
            </span>
          </label>
          <ToggleButton
            active={wireframe}
            onClick={() => setWireframe(!wireframe)}
            title="Vista de alambre (segmentos)"
          >
            <Spline className="w-3.5 h-3.5" />
</ToggleButton>
          {!lightConfig && (
            <button
              onClick={() =>
                setLightPreset((p) => (p + 1) % LIGHT_PRESETS.length)
              }
              title="Iluminación: clic para cambiar el preset"
              className="px-1.5 py-1 rounded-md text-[10px] font-medium text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-colors flex items-center gap-1"
            >
              <Sun className="w-3 h-3" />
              {LIGHT_PRESETS[lightPreset]?.name ?? 'Natural'}
            </button>
          )}
          <ToggleButton
             active={gridValue}
             onClick={toggleGrid}
            title="Rejilla"
          >
            <Grid3x3 className="w-3.5 h-3.5" />
          </ToggleButton>
          <label
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
            title="Tamaño de la base de trabajo"
          >
            Base
            <Slider
              min={1}
              max={5}
              step={0.5}
              value={[gridScale]}
              onValueChange={([v]) => setGridScale(v)}
              className="w-16"
            />
          </label>
          <ToggleButton
            active={autoRotate}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Rotar"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </ToggleButton>
          <ToggleButton onClick={resetCamera} title="Reset cámara">
            <Maximize2 className="w-3.5 h-3.5" />
          </ToggleButton>
          <ToggleButton
             active={glowValue}
             onClick={toggleGlow}
             title="Brillo neón (halo alrededor del texto)"
           >
             <Zap className="w-3.5 h-3.5" />
           </ToggleButton>
           <ToggleButton
             active={sparksValue}
             onClick={toggleSparks}
             title="Chispas"
           >
             <Sparkle className="w-3.5 h-3.5" />
           </ToggleButton>
           <ToggleButton
             active={fireValue}
             onClick={toggleFire}
             title="Fuego"
          >
            <Flame className="w-3.5 h-3.5" />
          </ToggleButton>
          <ToggleButton
            active={fxStars}
            onClick={() => setFxStars(!fxStars)}
            title="Estrellas de brillo (aleatorias)"
          >
            <Star className="w-3.5 h-3.5" />
          </ToggleButton>
          <ToggleButton
            active={starPlacement}
            onClick={() => setStarPlacement(!starPlacement)}
            title="Colocar estrellas: clic en el texto para ponerlas, clic sobre una colocada para quitarla"
          >
            <Pin className="w-3.5 h-3.5" />
          </ToggleButton>
          {(fxStars || starPlacement) && (
            <div className="flex items-center gap-1 px-1" title="Tamaño de las estrellas">
              <Star className="w-3 h-3 text-amber-300" />
              <Slider
                min={0.3}
                max={3}
                step={0.1}
                value={[starSize]}
                onValueChange={([v]) => setStarSize(v)}
                className="w-14"
              />
            </div>
          )}
          <ToggleButton
            active={smoothCapture}
            onClick={() => setSmoothCapture(!smoothCapture)}
            title="Suavizar curvas en la captura PNG"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </ToggleButton>
          <ToggleButton onClick={capturePNG} title="Capturar PNG (fondo transparente)">
            <Camera className="w-3.5 h-3.5" />
          </ToggleButton>
        </div>
      </div>
      <div
        ref={mountRef}
        className="relative flex-1 min-h-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 40%, hsl(224 45% 16%) 0%, hsl(224 50% 7%) 80%)',
        }}
      />
      {selectedVertex !== null && (
        <div className="px-3 py-1.5 border-t border-white/5 text-[10px] font-mono text-muted-foreground">
          V{selectedVertex}: x={mesh.vertices[selectedVertex]?.x.toFixed(2)} y=
          {mesh.vertices[selectedVertex]?.y.toFixed(2)} z=
          {mesh.vertices[selectedVertex]?.z.toFixed(2)}
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${active
        ? 'text-green-400 bg-green-500/15'
        : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
        }`}
    >
      {children}
    </button>
  );
}

/**
 * Construye los objetos 3D de la versión suavizada de una malla de
 * vóxeles, para renderizarla SOLO durante la captura PNG. Devuelve la
 * malla con sombreado suave (normales por vértice) y sin las líneas de
 * aristas que marcan cada cuadradito.
 */
function buildSmoothCaptureObjects(mesh: Mesh): THREE.Object3D[] {
  const smoothed = smoothVoxelMesh(mesh);
  if (smoothed.vertices.length === 0 || smoothed.faces.length === 0) return [];

  const faceColors = smoothed.faceColors;
  const useFaceColors =
    !!faceColors &&
    faceColors.length === smoothed.faces.length &&
    faceColors.some((c) => !!c);

  // Esquinas compartidas por (posición, color): las caras contiguas del
  // mismo color comparten vértice, así computeVertexNormals produce un
  // sombreado suave entre caras en lugar de caras planas.
  const cornerMap = new Map<string, number>();
  const positions: number[] = [];
  const colorAttr: number[] = [];

  const cornerIndex = (vIdx: number, hex: string | null): number => {
    const v = smoothed.vertices[vIdx];
    const key = `${v.x.toFixed(5)}|${v.y.toFixed(5)}|${v.z.toFixed(5)}|${hex ?? ''}`;
    const existing = cornerMap.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length / 3;
    positions.push(v.x, v.y, v.z);
    const col = hex ? new THREE.Color(hex) : null;
    if (col) colorAttr.push(col.r, col.g, col.b);
    cornerMap.set(key, id);
    return id;
  };

  const indices: number[] = [];
  let faceIndex = 0;
  for (const face of smoothed.faces) {
    const hex = useFaceColors ? faceColors![faceIndex] ?? null : null;
    faceIndex++;
    if (face.length < 3) continue;
    const ids = face.map((idx) => cornerIndex(idx, hex));
    // Triangulación en abanico (caras cuadriláteras de la malla de vóxeles)
    for (let i = 1; i < ids.length - 1; i++) {
      indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }

  if (positions.length === 0) return [];

  const hasVertexColors =
    useFaceColors &&
    colorAttr.length > 0 &&
    colorAttr.length === positions.length;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  if (hasVertexColors) {
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colorAttr, 3)
    );
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: hasVertexColors ? 0xffffff : 0xdedede,
    vertexColors: hasVertexColors,
    metalness: 0.3,
    roughness: 0.45,
    side: THREE.DoubleSide,
    envMapIntensity: 0,
  });

  return [new THREE.Mesh(geometry, material)];
}

// ============================================================
// Efectos de iluminación: chispas, fuego y estrellas de brillo
// ============================================================

type ParticleSystem = {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  velocities: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
};

type StarGlint = {
  sprite: THREE.Sprite;
  state: 'wait' | 'live';
  timer: number;
  duration: number;
  baseScale: number;
};

type StarSystem = {
  group: THREE.Group;
  stars: StarGlint[];
};

type PlacedStar = {
  sprite: THREE.Sprite;
  phase: number;
  /** Tamaño base SIN el factor del deslizador (se aplica cada frame). */
  rawScale: number;
};

type PlacedStarSystem = {
  group: THREE.Group;
  stars: PlacedStar[];
};

/** Añade una estrella fija en un punto del texto. */
function addPlacedStar(
  sys: PlacedStarSystem,
  pos: THREE.Vector3,
  starSize: number
): void {
  const material = new THREE.SpriteMaterial({
    map: getStarTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false, // siempre por delante del texto
    blending: THREE.AdditiveBlending,
    rotation: Math.random() * Math.PI,
  });
  const hue = Math.random();
  if (hue < 0.7) material.color.setHex(0xffffff);
  else if (hue < 0.85) material.color.setHex(0x9fe8ff);
  else material.color.setHex(0xffe3b0);
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(pos);
  sprite.renderOrder = 999;
  const rawScale = 0.28 + Math.random() * 0.14;
  sprite.scale.setScalar(rawScale * starSize);
  sys.group.add(sprite);
  sys.stars.push({
    sprite,
    phase: Math.random() * Math.PI * 2,
    rawScale,
  });
}

/** Quita la estrella colocada más cercana al rayo del clic (si la hay). */
function removePlacedStarAt(sys: PlacedStarSystem, ray: THREE.Ray): boolean {
  let bestIdx = -1;
  let bestDist = 0.09;
  for (let i = 0; i < sys.stars.length; i++) {
    const d = ray.distanceToPoint(sys.stars[i].sprite.position);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return false;
  const [star] = sys.stars.splice(bestIdx, 1);
  sys.group.remove(star.sprite);
  star.sprite.material.dispose();
  return true;
}

/** Elimina todas las estrellas colocadas. */
function clearPlacedStars(sys: PlacedStarSystem | null): void {
  if (!sys) return;
  for (const star of sys.stars) {
    sys.group.remove(star.sprite);
    star.sprite.material.dispose();
  }
  sys.stars = [];
}

let dotTextureCache: THREE.Texture | null = null;

/** Punto suave y brillante para las partículas (chispas / fuego). */
function getSoftDotTexture(): THREE.Texture {
  if (dotTextureCache) return dotTextureCache;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  dotTextureCache = tex;
  return tex;
}

let starTextureCache: THREE.Texture | null = null;

/** Estrella de brillo de 4 puntas (núcleo + destello en cruz). */
function getStarTexture(): THREE.Texture {
  if (starTextureCache) return starTextureCache;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;

  // Núcleo brillante
  const core = g.createRadialGradient(64, 64, 0, 64, 64, 18);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);

  // Rayos en cruz
  g.globalCompositeOperation = 'lighter';
  for (const rot of [0, Math.PI / 2]) {
    g.save();
    g.translate(64, 64);
    g.rotate(rot);
    const ray = g.createLinearGradient(-60, 0, 60, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(-60, 0);
    g.lineTo(0, -3.2);
    g.lineTo(60, 0);
    g.lineTo(0, 3.2);
    g.closePath();
    g.fill();
    g.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  starTextureCache = tex;
  return tex;
}

let glowMaterialCache: THREE.ShaderMaterial | null = null;

/**
 * Material del halo de neón (fresnel): la copia ampliada por detrás solo
 * emite luz en el BORDE de la silueta (las caras que miran de lado a la
 * cámara); el interior es transparente. Así el texto queda rodeado de un
 * borde brillante tipo letrero de neón, sin el aspecto de "gelatina" de
 * una capa sólida que lo envuelve.
 */
function getGlowMaterial(): THREE.ShaderMaterial {
  if (glowMaterialCache) return glowMaterialCache;
  glowMaterialCache = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x5fd4ff) },
      uPower: { value: 2.6 },
      uIntensity: { value: 1.4 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        // Con BackSide el normal apunta lejos de la cámara: abs() lo
        // corrige. En el borde de la silueta el normal es perpendicular
        // a la vista (dot ~ 0) → máximo brillo; en el centro, nada.
        float rim = 1.0 - abs(dot(vNormal, viewDir));
        float glow = pow(rim, uPower) * uIntensity;
        gl_FragColor = vec4(uColor * glow, glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  return glowMaterialCache;
}

function createParticleSystem(count: number, size: number): ParticleSystem {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: getSoftDotTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false, // siempre por delante del texto
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 999;
  return {
    points,
    positions,
    colors,
    velocities: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
  };
}

/** Chispas: saltan hacia fuera desde el texto y caen desvaneciéndose. */
function updateSparks(
  sys: ParticleSystem,
  dt: number,
  randomPoint: () => THREE.Vector3 | null
): void {
  const count = sys.life.length;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (sys.life[i] <= 0) {
      const p = randomPoint();
      if (!p) continue;
      sys.positions[o] = p.x;
      sys.positions[o + 1] = p.y;
      sys.positions[o + 2] = p.z;
      const len = p.length() || 1;
      const speed = 0.35 + Math.random() * 0.85;
      sys.velocities[o] = (p.x / len) * speed + (Math.random() - 0.5) * 0.7;
      sys.velocities[o + 1] =
        (p.y / len) * speed + (Math.random() - 0.5) * 0.7 + 0.25;
      sys.velocities[o + 2] = (p.z / len) * speed + (Math.random() - 0.5) * 0.7;
      sys.maxLife[i] = 0.3 + Math.random() * 0.55;
      sys.life[i] = sys.maxLife[i];
    } else {
      sys.life[i] -= dt;
      sys.positions[o] += sys.velocities[o] * dt;
      sys.positions[o + 1] += sys.velocities[o + 1] * dt;
      sys.positions[o + 2] += sys.velocities[o + 2] * dt;
      sys.velocities[o + 1] -= 2.0 * dt;
    }
    const t = Math.max(sys.life[i], 0) / (sys.maxLife[i] || 1);
    sys.colors[o] = t;
    sys.colors[o + 1] = t * 0.72;
    sys.colors[o + 2] = t * 0.3;
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (sys.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

/** Fuego: llamas que nacen en el texto y suben temblando. */
function updateFire(
  sys: ParticleSystem,
  dt: number,
  randomPoint: () => THREE.Vector3 | null
): void {
  const count = sys.life.length;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (sys.life[i] <= 0) {
      const p = randomPoint();
      if (!p) continue;
      sys.positions[o] = p.x;
      sys.positions[o + 1] = p.y - 0.04;
      sys.positions[o + 2] = p.z;
      sys.velocities[o] = (Math.random() - 0.5) * 0.12;
      sys.velocities[o + 1] = 0.5 + Math.random() * 0.6;
      sys.velocities[o + 2] = (Math.random() - 0.5) * 0.12;
      sys.maxLife[i] = 0.7 + Math.random() * 1.1;
      sys.life[i] = sys.maxLife[i];
    } else {
      sys.life[i] -= dt;
      sys.positions[o] += sys.velocities[o] * dt;
      sys.positions[o + 1] += sys.velocities[o + 1] * dt;
      sys.positions[o + 2] += sys.velocities[o + 2] * dt;
      sys.velocities[o] += (Math.random() - 0.5) * 0.5 * dt;
    }
    const t = Math.max(sys.life[i], 0) / (sys.maxLife[i] || 1);
    // Amarillo al nacer → naranja → rojo apagado
    sys.colors[o] = t;
    sys.colors[o + 1] = t * t * 0.55;
    sys.colors[o + 2] = t * t * t * 0.06;
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (sys.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

function createStarSystem(): StarSystem {
  const group = new THREE.Group();
  const stars: StarGlint[] = [];
  for (let i = 0; i < 8; i++) {
    const material = new THREE.SpriteMaterial({
      map: getStarTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false, // siempre por delante del texto
      blending: THREE.AdditiveBlending,
      rotation: Math.random() * Math.PI,
    });
    // Mayoría blancas; algunas con matiz frío o cálido
    const hue = Math.random();
    if (hue < 0.7) material.color.setHex(0xffffff);
    else if (hue < 0.85) material.color.setHex(0x9fe8ff);
    else material.color.setHex(0xffe3b0);
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    sprite.scale.setScalar(0);
    group.add(sprite);
    stars.push({
      sprite,
      state: 'wait',
      timer: Math.random() * 1.5,
      duration: 1,
      baseScale: 0.25,
    });
  }
  return { group, stars };
}

/** Estrellas: aparecen en puntos aleatorios del texto, crecen y se apagan. */
function updateStars(
  sys: StarSystem,
  dt: number,
  randomPoint: () => THREE.Vector3 | null,
  starSize: number
): void {
  for (const star of sys.stars) {
    star.timer -= dt;
    if (star.state === 'wait') {
      if (star.timer <= 0) {
        const p = randomPoint();
        if (!p) {
          star.timer = 0.5;
          continue;
        }
        star.sprite.position.copy(p);
        star.duration = 0.45 + Math.random() * 0.85;
        star.timer = star.duration;
        star.baseScale = (0.16 + Math.random() * 0.3) * starSize;
        star.sprite.material.rotation = Math.random() * Math.PI;
        star.state = 'live';
      }
    } else {
      const t = 1 - star.timer / star.duration;
      const s = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
      star.sprite.scale.setScalar(star.baseScale * s);
      if (star.timer <= 0) {
        star.sprite.scale.setScalar(0);
        star.state = 'wait';
        star.timer = 0.25 + Math.random() * 1.6;
      }
    }
  }
}
