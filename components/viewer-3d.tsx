'use client';

/**
 * Compone la matriz THREE de una transformada de objeto (misma regla que
 * en el resto del visor: euler XYZ en radianes, escala por eje).
 */
function componerMatrizTransforma(t: {
  px?: number; py?: number; pz?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
}): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.px ?? 0, t.py ?? 0, t.pz ?? 0),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)
    ),
    new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
  );
}

let mp4ExportActive = false;

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Mesh,
  Vertex3D,
  LatheTextureProjection,
  type TextureMaterialParams,
  construirAnillos,
  carasAnilloDe,
  extremosBordeAnillo,
} from '@/lib/geometry';
import { aplicarMaterialCreado, limpiarExtrasCreados } from '@/lib/texture-generator';
import {
   evaluateCameraKeyframes,
   evaluateTransformTrack,
   evaluatePluginParamTrack,
   evaluateEffectTrack,
} from '@/lib/animation';
import type {
   AnimationTrack,
   Keyframe,
   KeyframeProperty,
   CameraData,
   CameraKeyframe,
   Vec3,
     TransformTrack,
     PluginParamTrack,
     EffectTrack,
     EffectType,
     EffectProperty,
} from '@/lib/animation';
import { obtenerPlugin, type PluginParams } from '@/lib/plugins';
import { smoothVoxelMesh } from '@/lib/mesh-smooth';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FxConfigEditor } from '@/components/fx-config-editor';
import { isElectron, writeFile, deleteFile, transcodeVideo, getLocalPaths, getTempDir, readFileBuffer } from '@/lib/electron-fs';
import {
  RotateCcw,
  Maximize2,
  Box,
  Grid3x3,
  Crosshair,
  Spline,
  Camera,
  Sparkles,
  Sparkle,
  Zap,
  Flame,
  Cloud,
  CloudRain,
   Star,
    Pin,
     Settings,
     MousePointerClick,
     Menu,
  } from 'lucide-react';

/** Configuración FX global (legacy v3): vive en lib/efectos-objeto.ts. */
export type { FxConfig } from '@/lib/efectos-objeto';
export { DEFAULT_FX_CONFIG } from '@/lib/efectos-objeto';
import {
  DEFAULT_FX_CONFIG,
  VALORES_DEFECTO_EFECTO,
  aplicarAEfectos,
  crearEfectoObjeto,
  validarEfectos,
  valoresEfecto,
  type EfectoObjeto,
  type EfectoValores,
  type FxConfig,
  type EstrellaColocada,
} from '@/lib/efectos-objeto';

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

/** Contador de programas de shader con exclusión de luces (clave única
 *  por material parcheado: así compila SUS uniformes y no comparte
 *  programa con otro material). */
let contadorExclusiones = 0;

/** lights_fragment_begin (three r186) con el filtro de exclusión
 *  inyectado: la irradiance ambiente va según excluirAmbiente y cada
 *  foco excluido se anula comparando su posición — la del uniforme
 *  spotLights está en espacio de VISTA, así que la lista (mundo) se
 *  proyecta a vista con viewMatrix. Va REEMPLAZANDO al tag
 *  `#include <lights_fragment_begin>` porque onBeforeCompile corre
 *  ANTES de que three expanda los includes: los .replace contra código
 *  interno del chunk (spotLight/irradiance) serían no-ops con el
 *  fragmento sin resolver. */
const LUCES_FRAG_INICIO = ((trozo: string) =>
  trozo
    .replace(
      'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
      'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * ( 1.0 - excluirAmbiente );'
    )
    .replace(
      '\t\tspotLight = spotLights[ i ];',
      `\t\tspotLight = spotLights[ i ];
		for ( int s = 0; s < excluirFocos; s ++ ) {
			if ( distance( spotLight.position, ( viewMatrix * vec4( excluirFocoPos[ s ], 1.0 ) ).xyz ) < 0.001 ) {
				spotLight.color = vec3( 0.0 );
			}
		}`
    ))(
      (THREE as unknown as { ShaderChunk?: Record<string, string> })
        .ShaderChunk?.['lights_fragment_begin'] ??
        // Si el chunk no estuviera a mano, dejar el tag intacto:
        // el replace entero se vuelve no-op y nada revienta.
        '#include <lights_fragment_begin>'
    );

export interface SpotlightConfig {
  id: string;
  enabled: boolean;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  /**
   * Si está definido, el foco apunta SIEMPRE a este objeto de la escena y lo
   * sigue aunque se mueva. Tiene prioridad sobre `target`, que queda como
   * respaldo cuando el objeto no existe o no hay vínculo.
   */
  targetObjectId?: string;
  color: number;
  intensity: number;
  angle: number;
  penumbra: number;
  castShadow: boolean;
  shadowIntensity: number;
  shadowColor: number;
  /** Si los ayudantes visuales del foco (cono, aros, esfera de posición)
   *  se muestran en la escena. El foco sigue iluminando aunque esté a false. */
  helperVisible?: boolean;
  /**
   * Objetos de la escena que ESTE foco NO ilumina: se quita la
   * contribución de la luz de los materiales de esos objetos (por
   * objeto, sin tocar a los demás).
   */
  excluyeObjetos?: string[];
}

export interface LightConfig {
  ambient: {
    enabled: boolean;
    color: number;
    intensity: number;
    /**
     * Objetos de la escena que la luz ambiente NO ilumina (se resta su
     * contribución ambiental de los materiales de esos objetos).
     */
    excluyeObjetos?: string[];
  };
  spotlights: SpotlightConfig[];
  /** Opcional: si está activo, el fondo (cielo) también sigue a las luces.
   *  Se oscurece al bajar la intensidad total (0 = cielo negro) y vuelve a
   *  su brillo original al subirla. Si falta o es false, el cielo no cambia. */
  affectSky?: boolean;
}

const IDENTITY_CAMERA3D: Camera3D = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotationX: 0,
  rotationY: 0,
};

/** Medio-alto del frustum ortográfico de las ventanas 2D con zoom 1:
 *  iguala el encuadre de la perspectiva a distancia 5.5 con FOV 45°
 *  (5.5 · tan(22.5°) ≈ 2.278). El zoom del estado Camera3D escala este
 *  frustum (a mayor zoom, frustum menor = más cerca). */
const ALTURA_BASE_PLANO = 2.2779;

/**
 * Posición a la que apunta un foco. Si está vinculado a un objeto
 * (`targetObjectId`), devuelve la del objeto según su transform actual de la
 * escena —así lo sigue aunque se mueva—; si no, la de las coordenadas
 * manuales `target`. Fuente única usada por la luz real y por los ayudantes.
 */
export function resolveSpotTarget(
  sp: SpotlightConfig,
  objs?: Array<{ id: string; transform: ObjectTransform }> | null
): { x: number; y: number; z: number } {
  if (sp.targetObjectId && objs) {
    const obj = objs.find((o) => o.id === sp.targetObjectId);
    if (obj) {
      return { x: obj.transform.px, y: obj.transform.py, z: obj.transform.pz };
    }
  }
  return {
    x: sp.target?.x ?? 0,
    y: sp.target?.y ?? 0,
    z: sp.target?.z ?? 0,
  };
}

/** Resultado de la extrusión al ESCALAR con Ctrl (ver `onCtrlEscalarSubSel`):
 *  la malla ya con la copia + paredes casi en el sitio de la selección y los
 *  mapas para que el arrastre opere sobre los duplicados, no sobre los
 *  vértices compartidos con el resto del objeto. */
export type ExtrusionCtrlSubSel = {
  mesh: Mesh;
  /** Vértice original usado por la selección → su duplicado. */
  vmap: Map<number, number>;
  /** Índices de las caras-copia (la nueva selección, como en Blender). */
  carasNuevas: number[];
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
   /** Número de veces que se repite la textura (1 = sin repetición) */
    textureRepeat?: number;
   /** Veces que se repite la textura en VERTICAL (ausente = igual que X) */
    textureRepeatY?: number;
    /** Si el objeto está oculto (no se dibuja) */
    hidden?: boolean;
    /** Si el objeto está congelado (gris, no interactivo) */
    frozen?: boolean;
    /** Clase de objeto: figura normal (por defecto) o cámara */
    kind?: 'figure' | 'camera';
    /** Datos de la cámara-objeto (FOV + fotogramas del recorrido) */
    camera?: CameraData;
    /** Efectos visuales del objeto (con parámetros y focos persistidos). */
    efectos?: EfectoObjeto[];
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
   /** Acabado de la textura del dueño (para el visor 3D en tiempo real) */
   configFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
   /** Relieve de la textura del dueño */
   configRelief?: number;
   selectedObjectId?: string;
   onObjectSelect?: (id: string) => void;
   /** IDs de objetos seleccionados en modo multi-selección */
   selectedObjectIds?: string[];
   /** Giro individual: cada objeto seleccionado gira sobre su propio centro
    *  (desactivado = la selección entera gira como una sola pieza) */
   giroIndividual?: boolean;
   /** Notifica al padre del cambio en la selección múltiple */
   onSelectionChange?: (ids: string[]) => void;
    /** Activar modo de selección por rectángulo (rubber-band) */
    selectionMode?: boolean;
    /** Notifica al padre del cambio en el modo de selección */
    onSelectionModeChange?: (active: boolean) => void;
    /** Activar modo de selección de caras de la figura activa */
    faceSelectMode?: boolean;
    /** Herramienta de selección: rectángulo, círculo, línea, polígono
     * (clics sucesivos) o DIRECTO — el clic elige el elemento bajo el
     * cursor, sin marco (los botones Polígono/Aristas/Puntos la fijan). */
    faceSelectionTool?: 'rectangle' | 'circle' | 'line' | 'poligono' | 'directo';
    /** Qué se selecciona: caras, vértices o segmentos (aristas) */
    faceSelectionTarget?: 'cara' | 'vertice' | 'segmento';
    /** Modo ANILLOS de caras: en el objetivo caras, el hover/clic agrupa el
     *  anillo completo de caras que pasa por el borde apuntado (los botones
     *  junto a Mover/Extrudir lo conmutan). */
    anillosCaras?: boolean;
    /** Solo capturar lo visible (caras frontales, no lo que está detrás) */
    faceSelectVisibleOnly?: boolean;
    /** Al incrementarse, apaga la vista de alambre (fin del ciclo de textura por caras) */
    wireframeOffSignal?: number;
    /** Índices de caras seleccionadas en el modo de selección de caras */
    selectedFaceIds?: number[];
    /** Notifica al padre del cambio en la selección de caras */
    onFaceSelectionChange?: (faceIds: number[]) => void;
    /** Índices de vértices seleccionados (objetivo «vértice») */
    selectedVertexIds?: number[];
    /** Notifica al padre del cambio en la selección de vértices */
    onVertexSelectionChange?: (vertexIds: number[]) => void;
    /** Aristas seleccionadas (objetivo «segmento»), clave «a-b» con a < b */
    selectedEdgeIds?: string[];
    /** Notifica al padre del cambio en la selección de segmentos */
    onEdgeSelectionChange?: (edgeIds: string[]) => void;
    /** Notifica al padre del cambio en el modo de selección de caras */
    onFaceSelectionModeChange?: (active: boolean) => void;
    /** Notifica al padre del cambio en la herramienta de selección */
    onFaceSelectionToolChange?: (tool: 'rectangle' | 'circle' | 'line' | 'poligono') => void;
    /** Notifica al padre del cambio en el objetivo de selección */
    onFaceSelectionTargetChange?: (target: 'cara' | 'vertice' | 'segmento') => void;
  onVerticesChange?: (vertices: Vertex3D[]) => void;
  /**
   * Ctrl mientras se ESCALA la sub-selección (flecha amarilla o cubo
   * central): extrudir en vez de estirar — el editor duplica la selección
   * con sus paredes (delta casi nulo, estilo Blender) y el arrastre escala
   * la COPIA, así los anillos de arriba/abajo/lados no se deforman.
   * El visor lo pide al empezar el gesto; si el editor no puede (malla
   * vista ≠ malla del objeto, sin selección…) devuelve null y la escala
   * funciona como siempre.
   */
  onCtrlEscalarSubSel?: () => ExtrusionCtrlSubSel | null;
  /** Registra la función que desplaza la selección actual (vértices/
   *  segmentos/caras): los campos numéricos de la barra del editor la
   *  guardan y la llaman con el desplazamiento X·Y·Z. */
  onRegisterSelectionMove?: (fn: (dx: number, dy: number, dz: number) => void) => void;
  showVerticesDefault?: boolean;
  camera3D?: Camera3D;
  /** Modo 2D (estilo dibujo técnico): cámara ORTOGRÁFICA fijada a la
   *  dirección de la vista (Frente/Superior/Costado...), sin rotación
   *  posible y materiales planos sin sombreado. La '3d' libre no lo usa. */
  flat2D?: boolean;
  /** Al incrementarse, encuadra (ajusta el zoom/centro) la figura y los
   *  objetos de la escena para que entren completos en esta ventana. */
  frameToken?: number;
  /** Notifica al padre cuando el usuario mueve la cámara con el ratón/scroll,
   *  para que pueda mantener su estado (panelCameras) sincronizado con la
   *  posición real de la cámara. Sin esto, los botones de pan saltan al origen. */
  onCameraChange?: (cam: Camera3D) => void;
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
   textureRepeat?: number;
   /** Veces que se repite la textura en VERTICAL (ausente = igual que X). */
   textureRepeatY?: number;
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
   /** Which gizmo handle groups are active (move/rotate/scale).
      When omitted, all modes are available. */
   gizmoModes?: GizmoMode[];
  /** Whether the gizmo can be interacted with (dragged). When false the
      handles remain visible but don't receive raycast hits, allowing
      configuration without moving the object. */
  gizmoInteractive?: boolean;
  /** Override color for the gizmo handles (used during configuration mode).
      When omitted, handles use their default per-axis colors. */
  gizmoColorOverride?: number;
  /** Offset del gizmo respecto al objeto (solo el manipulador). En modo
      configuración permite desplazar/rotar el gizmo sin tocar la figura. */
  gizmoOffset?: ObjectTransform;
  /** Notifica al padre del nuevo offset del gizmo (modo configuración). */
  onGizmoOffsetChange?: (t: ObjectTransform) => void;
  /** Gizmo de la SUB-SELECCIÓN (caras/aristas/vértices): ¿se puede
      interactuar? false = modo configuración: arrastrar las asas mueve el
      gizmo en sí (su offset), no la selección. */
  selGizmoInteractive?: boolean;
  /** Color de sustitución de las asas del gizmo de la sub-selección (gris
      en modo configuración, como el gizmo de objetos). */
  selGizmoColorOverride?: number;
  /** Offset de sitio (mundo) que el usuario le puso al gizmo de la
      sub-selección en modo configuración. Se resetea al cambiar la
      selección (lo re-encola el editor). */
  selGizmoOffset?: { x: number; y: number; z: number };
  /** Notifica al padre el offset de sitio del gizmo de la sub-selección. */
  onSelGizmoOffsetChange?: (o: { x: number; y: number; z: number }) => void;
  /** Posición, rotación y escala actuales del objeto (las fija el manipulador) */
  objectTransform?: ObjectTransform;
  onObjectTransform?: (t: ObjectTransform) => void;
  /** Called when the gizmo drag ends with multi-selected objects: sends the
      transform delta applied to all selected objects so the parent can update their stored transforms. */
   onMultiObjectTransform?: (transforms: { id: string; transform: ObjectTransform }[]) => void;
   /** Nombre amigable del objeto activo, para mostrarlo/editablecerlo */
  objectName?: string;
  onObjectNameChange?: (name: string) => void;
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
    /** Number of times the ground texture repeats (tiling) */
    groundTextureRepeat?: number;
    /** Veces que se repite la textura del suelo en VERTICAL (ausente = igual que X). */
    groundTextureRepeatY?: number;
    /** Intensidad del relieve de la textura del suelo (0 = suelo liso). */
    groundTextureRelief?: number;
      /** Finish for ground texture: glossy, semi-matte, matte, mirror, or metallic */
      groundTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
      /**
       * Parámetros de una textura CREADA aplicada al suelo: se aplican al
       * material del suelo para que coincida con la vista previa
       * (transmisión, metalidad…). Ausente = acabado normal.
       */
      groundTextureParams?: TextureMaterialParams | null;
      /** Finish for object textures: glossy, semi-matte, matte, mirror, or metallic */
      objectTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
     /** Background image URL for the skybox */
      skyboxImage?: string | null;
    /** Estado de los efectos visuales con parámetros ajustables */
    fxConfig?: FxConfig;
    /** Notifica al padre cuando un efecto visual cambió */
    onFxChange?: (fx: Partial<FxConfig>) => void;
    /** Efectos por objeto cambiados desde el visor (aplicar/retirar en lote,
     *  parámetros, focos colocados con clic). Solo llegan los que cambian. */
    onEfectosObjetos?: (cambios: Record<string, EfectoObjeto[] | undefined>) => void;
    /** Abrir el modal de configuración de efectos visuales */
    onOpenFxConfig?: () => void;
    /** Mostrar u ocultar la rejilla del suelo */
    showGrid?: boolean;
    onShowGridChange?: (visible: boolean) => void;
   /** Tracks de animación para este visor. */
   animationTracks?: AnimationTrack[];
   /** Tiempo actual de reproducción en segundos. */
   animationTime?: number;
    /** Called when a non-looping animation track completes. */
    onAnimationComplete?: (trackId: string) => void;
    /** Pistas de transformada del editor de movimiento (segundos). */
    transformTracks?: TransformTrack[];
    /** Pistas de parámetros de plugin del editor de movimiento. */
    pluginTracks?: PluginParamTrack[];
    /** Pistas de efectos visuales del editor de movimiento. */
    effectTracks?: EffectTrack[];
    /** Malla base congelada por objectId para las pistas de plugin. */
    pluginBaseMeshes?: Record<string, unknown>;
    /** Reproducción o scrub del editor de movimiento: aplica override visual. */
    motionPlaying?: boolean;
    /** Muestra el recorrido editable del objeto seleccionado (pistas de transformada). */
    showMotionPath?: boolean;
    /** Mueve la posición (px/py/pz) del fotograma `index` del recorrido. */
    onMotionKeyframeMove?: (index: number, pos: Vec3) => void;
    /** Cámara-objeto activa de ESTA ventana: la que maneja el visor cuando
     *  tiene ≥1 fotograma (pose estática con 1, recorrido con ≥2). */
    activeCamera?: { id: string; keyframes: CameraKeyframe[]; fov: number } | null;
    /** Cámara de EXPORTACIÓN MP4 (primera con ≥2 fotogramas): durante la
     *  exportación maneja el visor aunque la ventana no tenga cámara. */
    exportCamera?: { id: string; keyframes: CameraKeyframe[]; fov: number } | null;
    /**
     * Cámara-objeto en edición: la cámara seleccionada de la Escena y el
     * índice de fotograma activo. El foco (target) del fotograma seleccionado
     * —o camera.target si no hay ninguno— se usa para orientar el cuerpo.
     */
    cameraEditor?: {
      objectId: string;
      keyframeIndex: number | null;
      focus: Vec3 | null;
      /** Recorrido completo (fotogramas) de la cámara en edición */
      keyframes: CameraKeyframe[];
      /** Ángulo de visión actual (FOV en grados) */
      fov: number;
    };
    /** Mueve la posición de un fotograma del recorrido (asa cian) */
    onCameraKeyframeMove?: (index: number, pos: Vec3) => void;
    /** Mueve el foco del fotograma seleccionado (asa naranja) */
    onCameraTargetMove?: (pos: Vec3) => void;
    /** Orbita el foco alrededor del cuerpo al ROTAR la cámara con el gizmo */
    onCameraTargetOrbit?: (target: Vec3) => void;
    /** Modo grabación en ESTA ventana: OrbitControls sigue activo (el bucle
     *  no evalúa keyframes) y cada arrastre soltado captura un fotograma. */
    grabacionActiva?: boolean;
    /** Suelta de un arrastre de la vista grabando: captura la pose actual */
    onGrabacionCaptura?: (pose: {
      position: Vec3;
      target: Vec3;
      fov: number;
    }) => void;
    /** Id de la cámara-objeto en grabación (global a todas las ventanas):
     *  soltar el gizmo sobre ella en cualquier ventana captura un kf. */
    grabacionCamaraId?: string | null;
    /** Trigger to export the current animation as MP4 (increment to start export) */
    exportMp4Trigger?: number;
    /** Called during MP4 export with progress (0-100) */
    onExportProgress?: (percent: number) => void;
    /** Called when MP4 export completes */
    onExportComplete?: (result: { success: boolean; outputPath?: string; error?: string }) => void;
    }

/** Posición, rotación, escala y opacidad del objeto en el visor */
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
  /** Opacidad (0..1). Opcional: si falta, no se anima. */
  o?: number;
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
  o: 1,
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
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitControls,
  cam: Camera3D
) {
  // Cámara ortográfica (ventanas 2D): la distancia NO cambia el tamaño
  // en pantalla (solo el frustum lo hace, vía ALTURA_BASE_PLANO/cam.zoom),
  // pero se conserva baseDistance/cam.zoom como distancia de posición
  // para que el eco de handleControlsChange reconstruya el MISMO zoom a
  // partir de baseDistance/dist.
  const esOrto = camera instanceof THREE.OrthographicCamera;
  const baseDistance = 5.5;
  const distance = baseDistance / cam.zoom;
  // Frustum orto: medio-alto = ALTURA_BASE_PLANO/zoom; el ancho sale del
  // aspecto real del lienzo (de su propio canvas, vía el domElement de los
  // controles) para no deformar al redimensionar.
  if (esOrto) {
    const dom = controls.domElement as HTMLElement | null;
    const aspecto =
      dom && dom.clientHeight > 0 ? dom.clientWidth / dom.clientHeight : 1;
    const alto = ALTURA_BASE_PLANO / Math.max(0.1, Math.min(5, cam.zoom));
    camera.left = -alto * aspecto;
    camera.right = alto * aspecto;
    camera.top = alto;
    camera.bottom = -alto;
    camera.zoom = 1;
    camera.near = 0.1;
    camera.far = Math.max(100, distance * 2 + 10);
    camera.updateProjectionMatrix();
  }
  const rotY = cam.rotationY;
  const rotX = cam.rotationX;

  const isFrontView = Math.abs(rotY) < 0.01 && Math.abs(rotX) < 0.01;
  const isTopView =
    Math.abs(rotY) < 0.01 && Math.abs(rotX - Math.PI / 2) < 0.01;
  const isSideView =
    Math.abs(rotY - Math.PI / 2) < 0.01 && Math.abs(rotX) < 0.01;
  const isSideLeftView =
    Math.abs(rotY + Math.PI / 2) < 0.01 && Math.abs(rotX) < 0.01;
  const isBackView =
    Math.abs(Math.abs(rotY) - Math.PI) < 0.01 && Math.abs(rotX) < 0.01;
  const isBottomView =
    Math.abs(rotY) < 0.01 && Math.abs(rotX + Math.PI / 2) < 0.01;

  if (isFrontView) {
    camera.position.set(cam.offsetX, cam.offsetY, distance);
    controls.target.set(cam.offsetX, cam.offsetY, 0);
  } else if (isTopView) {
    camera.position.set(cam.offsetX, distance, cam.offsetY);
    controls.target.set(cam.offsetX, 0, cam.offsetY);
  } else if (isSideView) {
    camera.position.set(distance, cam.offsetY, cam.offsetX);
    controls.target.set(0, cam.offsetY, cam.offsetX);
  } else if (isSideLeftView) {
    camera.position.set(-distance, cam.offsetY, cam.offsetX);
    controls.target.set(0, cam.offsetY, cam.offsetX);
  } else if (isBackView) {
    camera.position.set(cam.offsetX, cam.offsetY, -distance);
    controls.target.set(cam.offsetX, cam.offsetY, 0);
  } else if (isBottomView) {
    camera.position.set(cam.offsetX, -distance, cam.offsetY);
    controls.target.set(cam.offsetX, 0, cam.offsetY);
  } else {
    if (esOrto) {
      // En modo 2D la rotación está bloqueada en un preset: esta rama
      // genérica no debería alcanzarse; se cubre con la vista frontal.
      camera.position.set(cam.offsetX, cam.offsetY, distance);
      controls.target.set(cam.offsetX, cam.offsetY, 0);
    } else {
      const x = distance * Math.cos(rotX) * Math.sin(rotY);
      const y = distance * Math.sin(rotX);
      const z = distance * Math.cos(rotX) * Math.cos(rotY);
      camera.position.set(x + cam.offsetX, y + cam.offsetY, z);
      controls.target.set(cam.offsetX, cam.offsetY, 0);
    }
  }

  // Reset internal delta state so controls.update() in the animation loop
  // doesn't override the programmatic camera position with accumulated
  // user-interaction deltas (spherical rotation + pan offset).
  (controls as any)._sphericalDelta.set(0, 0, 0);
  (controls as any)._panOffset.set(0, 0, 0);
  (controls as any)._scale = 1;
  controls.update();
}

/** Materiales originales guardados antes del modo plano (clave por objeto). */
const MATERIALES_ORIGINALES = new WeakMap<
  THREE.Mesh,
  THREE.Material | THREE.Material[]
>();

/** Convierte los materiales de la escena en MeshBasicMaterial (sin luces:
 *  color plano tipo lámina, sin sombreado ni sombras) para el estilo
 *  dibujo técnico de las ventanas 2D. Idempotente: los meshes con la
 *  marca `__plano` en userData se dejan tal cual, así el paso es barato
 *  por frame y cubre las mallas reconstruidas un frame después.
 *  El revert no existe: el remontaje del visor (al volver la ventana a
 *  '3d') reconstruye la escena con sus materiales físicos de fábrica. */
function aplicarModoPlano(raiz: THREE.Object3D): void {
  raiz.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if ((o.userData as Record<string, unknown>).__plano) return;
    const or = o.material;
    MATERIALES_ORIGINALES.set(o, or);
    const base = Array.isArray(or) ? or : [or];
    const planos = base.map((m) =>
      m instanceof THREE.MeshStandardMaterial ||
      m instanceof THREE.MeshPhysicalMaterial ||
      m instanceof THREE.MeshPhongMaterial ||
      m instanceof THREE.MeshLambertMaterial
        ? new THREE.MeshBasicMaterial({
            color: m.color.clone(),
            map: m.map ?? null,
            vertexColors: m.vertexColors,
            transparent: m.transparent,
            opacity: m.opacity,
            alphaTest: m.alphaTest,
            side: m.side,
            depthWrite: m.depthWrite,
            fog: m.fog,
          })
        : m
    );
    // Se conserva la FORMA original (single ↔ array): hay accesos tipo
    // `(mesh.material as MeshBasicMaterial).color` en códigos externos
    // (skybox) y `dispose()` en handles que revientan si pasa a array.
    o.material = Array.isArray(or) ? planos : planos[0];
    (o.userData as Record<string, unknown>).__plano = true;
  });
}

/** Convierte una pose (posición cámara + foco target) en el estado
 *  Camera3D de una vista de panel, con las ramas cenital/lateral cuyas
 *  firmas reconoce applyCamera (isTopView/isSideView/...). La emisión
 *  simple con rotX clampada a ±(π/2−0.01) dejaba OUT de tolerancia las
 *  vistas superior/inferior/costados y se perdía el reconocimiento. */
function poseACamera3D(
  pos: THREE.Vector3,
  tgt: THREE.Vector3,
  baseDistance = 5.5
): Camera3D {
  const dist = pos.distanceTo(tgt);
  const zoom = Math.max(0.1, Math.min(5, dist > 0 ? baseDistance / dist : 1));
  const dir = pos.clone().sub(tgt).normalize();
  const rotX = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const rotY = Math.atan2(dir.x, dir.z);
  if (Math.abs(dir.y) > Math.cos(0.01)) {
    return {
      zoom,
      offsetX: tgt.x,
      offsetY: tgt.z,
      rotationX: dir.y > 0 ? Math.PI / 2 : -Math.PI / 2,
      rotationY: 0,
    };
  }
  if (Math.abs(dir.x) > Math.cos(0.01)) {
    return {
      zoom,
      offsetX: tgt.z,
      offsetY: tgt.y,
      rotationX: rotX,
      rotationY: dir.x > 0 ? Math.PI / 2 : -Math.PI / 2,
    };
  }
  return {
    zoom,
    offsetX: tgt.x,
    offsetY: tgt.y,
    rotationX: Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, rotX)
    ),
    rotationY: rotY,
  };
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const liberar = (mat: THREE.Material) => {
    // El material de profundidad acompaña a su pintura (userData.
    // matSombra): muere con ella, sin tocar cada punto de dispose.
    const sombra = mat.userData?.matSombra as THREE.Material | undefined;
    if (sombra) sombra.dispose();
    mat.dispose();
  };
  if (Array.isArray(material)) {
    material.forEach(liberar);
    return;
  }
  liberar(material);
}

/**
 * Construye el visual de un objeto a partir de su instantánea de malla
 * (la copia que se guarda al pegarlo en otra pestaña). Reproduce los
 * mismos materiales que la malla principal: textura con su acabado y su
 * relieve, colores por cara y normales planas o suaves según viniera.
 */
/**
 * Cuerpo visual de una cámara-objeto: caja + visor + lente morada y un
 * cono de visión translúcido cuya abertura depende del FOV. La lente
 * mira hacia -Z local (la convención de una cámara three.js); el
 * orientado hacia el foco lo hace orientCameraBodyVisual.
 */
export function buildCameraObjectVisual(camera?: CameraData): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'cameraBody';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    roughness: 0.45,
    metalness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x4c1d95,
    roughness: 0.3,
    metalness: 0.5,
  });

  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.5), bodyMat);
  box.castShadow = true;
  body.add(box);

  // Visor superior
  const viewfinder = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.08, 0.14),
    darkMat
  );
  viewfinder.position.set(0, 0.17, 0.06);
  body.add(viewfinder);

  // Lente: cilindro apuntando a -Z (delante de la caja)
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.13, 0.18, 24),
    darkMat
  );
  lens.rotation.x = -Math.PI / 2;
  lens.position.set(0, 0, -0.32);
  body.add(lens);

  group.add(body);

  // Cono de visión: pirámide translúcida desde la lente hacia -Z
  const fovDeg = camera?.fov ?? 45;
  const fov = (fovDeg * Math.PI) / 180;
  const largo = 1.6;
  const radio = largo * Math.tan(fov / 2);
  const coneGeo = new THREE.ConeGeometry(radio, largo, 4, 1, true);
  // Punta (+Y) hacia la cámara en el origen, base abierta hacia -Z
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, -largo / 2);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xa855f7,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  const coneEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(coneGeo),
    new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.5 })
  );
  const cono = new THREE.Group();
  cono.name = 'cameraViewCone';
  cono.add(cone, coneEdges);
  group.add(cono);

  return group;
}

/**
 * Orienta el cuerpo de una cámara-objeto para que su lente (-Z local)
 * mire al foco, en coordenadas de MUNDO (compensa la rotación del
 * padre: duplicados viven en el espacio del objeto activo).
 */
export function orientCameraBodyVisual(root: THREE.Object3D, focus?: Vec3 | null): void {
  const body = root.getObjectByName('cameraBody');
  if (!body || !focus) return;
  root.updateWorldMatrix(true, false);
  const worldPos = new THREE.Vector3();
  root.matrixWorld.decompose(worldPos, new THREE.Quaternion(), new THREE.Vector3());
  const dir = new THREE.Vector3(focus.x, focus.y, focus.z).sub(worldPos);
  if (dir.lengthSq() < 1e-10) return;
  dir.normalize();
  // Convención de cámara three.js: -Z mira al objetivo.
  const worldQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir, new THREE.Vector3(0, 1, 0))
  );
  const parentQuat = new THREE.Quaternion();
  root.matrixWorld.decompose(new THREE.Vector3(), parentQuat, new THREE.Vector3());
  parentQuat.invert().multiply(worldQuat);
  // El cuerpo Y el cono de visión son hermanos directos bajo la raíz con
  // transformada identidad: el mismo cuaternión orienta a ambos.
  const cono = root.getObjectByName('cameraViewCone');
  body.quaternion.copy(parentQuat);
  if (cono) cono.quaternion.copy(parentQuat);
}

export function buildSnapshotObjectVisual(
  mesh: Mesh,
  smooth: boolean,
  projection: LatheTextureProjection,
  textureFinishOverride?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic',
  textureRepeat?: number,
  textureRepeatY?: number,
  envMap?: THREE.Texture | null
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
  // También entra una malla sin textura general pero con texturas por cara,
  // o con la textura de relieve dedicada (sin textura normal).
  const tieneTexturasPorCara = (mesh.faceTextures ?? []).some((tx) => !!tx);
  if (mesh.texture || mesh.bumpTexture || tieneTexturasPorCara) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of mesh.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
    // Caja + ejes: los MISMOS que la pieza amarilla y que la malla
    // principal (cara plana más probable / eje más redondo).
    const cajaProy = { minX, maxX, minY, maxY, minZ, maxZ };
    const projectionUv = (v: Vertex3D): [number, number] => {
      const angle = Math.atan2(v.z, v.x);
      const u = (angle / (Math.PI * 2) + 1) % 1;
      if (projection === 'planar') {
        return uvCaraPlana(v, cajaProy, ejeCaraPlana(cajaProy));
      }
      if (projection === 'spherical') {
        const length = Math.max(1e-6, Math.hypot(v.x, v.y, v.z));
        return [u, 1 - Math.acos(v.y / length) / Math.PI];
      }
      return uvCilindrica(v, cajaProy, ejeCilindro(cajaProy));
    };
    const faceEntries: Array<{ triCount: number; tex: string | null }> = [];
    const faceTexturesList = mesh.faceTextures ?? null;
    let faceCount = 0;
    for (const face of mesh.faces) {
      const faceIdx = faceCount++;
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
      faceEntries.push({
        triCount: face.length - 2,
        tex: faceTexturesList?.[faceIdx] ?? null,
      });
    }
    if (positions.length === 0) return group;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const finish = mesh.textureFinish ?? textureFinishOverride;
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
        metalness: finish === 'metallic' ? 0.3 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.05 : finish === 'mirror' ? 1 : 0.3,
        roughness: finish === 'metallic' ? 0.1 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.9 : finish === 'mirror' ? 0.05 : 0.45,
        clearcoat: finish === 'metallic' ? 1 : finish === 'glossy' ? 0 : finish === 'mirror' ? 1 : 0,
        clearcoatRoughness: finish === 'metallic' ? 0.015 : finish === 'glossy' ? 0.015 : finish === 'mirror' ? 0 : 0,
        side: THREE.DoubleSide,
        map: null,
        bumpMap: null,
        bumpScale: (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP,
        transparent: true,
        opacity: finalOpacity,
        alphaTest: 0,
        envMapIntensity: finish === 'mirror' ? 1.5 : 0,
    });
    // Textura CREADA: mismo material físico que la vista previa.
    if (mesh.textureMaterialParams) {
      aplicarMaterialCreado(material, mesh.textureMaterialParams);
      // Igual que en la malla principal: el env brillante propio. Sin él
      // el refrato (cristal/agua) de un objeto NO seleccionado sale negro —
      // el scene.environment del visor es el cubo-RT oscuro del editor.
      if (envMap) material.envMap = envMap;
    }
    // Texturas por cara: material extra por textura distinta + grupos de
    // índices por tramo contiguo (mismo esquema que la malla principal).
    let meshMaterials: THREE.Material | THREE.Material[] = material;
    if (faceEntries.some((e) => e.tex)) {
      const texMatIndex = new Map<string, number>();
      const extraMaterials: THREE.MeshPhysicalMaterial[] = [];
      const faceLoader = new THREE.TextureLoader();
      const loadFaceTexture = (mat: THREE.MeshPhysicalMaterial, url: string) => {
        faceLoader.load(
          url,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            mat.map = texture;
            mat.color.set(0xffffff);
            mat.needsUpdate = true;
          },
          undefined,
          () => {
            // Sin imagen disponible: teñir la cara de rojo para que el
            // fallo se note en vez de quedar invisible.
            mat.color.set(0xff3333);
            mat.needsUpdate = true;
          }
        );
      };
      for (const entry of faceEntries) {
        if (!entry.tex || texMatIndex.has(entry.tex)) continue;
        const faceMat = new THREE.MeshPhysicalMaterial({
          color: 0xcccccc,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: finalOpacity,
          map: null,
          metalness: material.metalness,
          roughness: material.roughness,
        });
        loadFaceTexture(faceMat, entry.tex);
        texMatIndex.set(entry.tex, 1 + extraMaterials.length);
        extraMaterials.push(faceMat);
      }
      let runStart = 0;
      let runMat = -1;
      let idxCursor = 0;
      for (const entry of faceEntries) {
        const matIndex = entry.tex ? (texMatIndex.get(entry.tex) ?? 0) : 0;
        if (matIndex !== runMat) {
          if (runMat >= 0 && idxCursor > runStart) {
            geometry.addGroup(runStart, idxCursor - runStart, runMat);
          }
          runStart = idxCursor;
          runMat = matIndex;
        }
        idxCursor += entry.triCount * 3;
      }
      if (runMat >= 0 && idxCursor > runStart) {
        geometry.addGroup(runStart, idxCursor - runStart, runMat);
      }
      meshMaterials = [material, ...extraMaterials];
    }
    const meshObj = new THREE.Mesh(geometry, meshMaterials);
    meshObj.castShadow = true;
    meshObj.receiveShadow = true;
    group.add(meshObj);

    if (mesh.texture && mesh.textureMaterialParams && !mesh.bumpTexture) {
      // Textura CREADA (Crea texturas): material PURO, igual que la vista
      // previa — sin mapa (la imagen traería vetas/grano que la
      // previsualización no muestra) y teñido con su color.
      material.color.set(mesh.textureMaterialParams.color);
      material.needsUpdate = true;
    } else if (mesh.texture) {
      new THREE.TextureLoader().load(
        mesh.texture,
         (texture) => {
           texture.colorSpace = THREE.SRGBColorSpace;
           texture.anisotropy = 4;
           texture.needsUpdate = true;
            const repeat = mesh.textureRepeat ?? textureRepeat ?? 1;
            // Vertical: el propio de la malla; si no, el del panel; si no,
            // copia el horizontal.
            const repeatY = mesh.textureRepeatY ?? textureRepeatY ?? repeat;
            texture.repeat.set(repeat, repeatY);
           texture.wrapS = THREE.RepeatWrapping;
           texture.wrapT = THREE.RepeatWrapping;
           material.map = texture;
           // Textura de relieve dedicada: SOLO ella genera el relieve; la
           // normal queda solo con el color. Sin ella el relieve sale de la
           // textura normal (ahora mucho más marcado).
           material.bumpMap = mesh.bumpTexture ? null : texture;
           material.bumpScale = (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP;
           material.color.set(mesh.textureColor ?? 0xffffff);
           material.needsUpdate = true;
           aplicarTexturaRelieve(material, mesh, repeat, repeatY);
        },
        undefined,
        () => {
          material.color.set(0xcccccc);
        }
      );
    } else if (mesh.bumpTexture) {
      // Sin textura normal: solo color blanco + relieve dedicado.
      material.color.set(0xffffff);
      aplicarTexturaRelieve(
        material, mesh,
        mesh.textureRepeat ?? textureRepeat ?? 1,
        mesh.textureRepeatY ?? textureRepeatY
      );
    }
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
      metalness: mesh.textureFinish === 'metallic' ? 0.3 : mesh.textureFinish === 'glossy' ? 0.1 : mesh.textureFinish === 'matte' ? 0.05 : 0.1,
      roughness: mesh.textureFinish === 'metallic' ? 0.1 : mesh.textureFinish === 'glossy' ? 0.025 : mesh.textureFinish === 'matte' ? 0.9 : 0.45,
      clearcoat: mesh.textureFinish === 'metallic' ? 1 : mesh.textureFinish === 'glossy' ? 1 : 0,
      clearcoatRoughness: mesh.textureFinish === 'metallic' ? 0.015 : mesh.textureFinish === 'glossy' ? 0.015 : 0,
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
      meshObj.name = 'mesh';
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

export type GizmoMode = 'move' | 'rotate' | 'scale';

type GizmoDrag = {
  /** Qué transform arrastra: el del objeto, el de la textura o el offset del gizmo */
  target: 'object' | 'texture' | 'gizmo';
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
  /** Ángulo de arrastre acumulado continuamente (desenrolla el salto ±π del
   *  atan2) y ángulo del frame anterior: inician en 0 y startAngle. */
  sweptAngle?: number;
  prevAngle?: number;
  /**
   * Pieza de textura: su transform vive en las coordenadas LOCALES de la
   * malla (las mismas con las que se calculan las UV), así que el rayo
   * del puntero se pasa a ese espacio con esta matriz antes de medir.
   */
   rayToLocal?: THREE.Matrix4;
   /** Para target 'gizmo': posición y rotación del objeto al empezar el
       arrastre, para convertir el transform efectivo (mundo) de vuelta al
       offset del gizmo. */
    objectQuat?: THREE.Quaternion;
    objectPos?: THREE.Vector3;
    /** Pivot de giro (posición de mundo del gizmo) cuando el offset está
     * activo: el objeto rota alrededor de él en vez de sobre su centro. */
    rotatePivot?: THREE.Vector3;
    /** Posición MUNDIAL del objeto al empezar el arrastre: base fija para
     *  la órbita, evita acumular la posición por frame (dq es ángulo total). */
    startObjectPos?: THREE.Vector3;
    /** Multi-selección: centro del CONJUNTO seleccionado al empezar el
     *  arrastre; el gizmo se queda anclado a él durante el gesto. */
    multiCenter?: THREE.Vector3;
    /** Vista previa del giro multi-selección: rotación total desde el inicio
     *  (dq) y de la órbita del conjunto (dqOrbit), actualizada por frame. */
    lastDq?: THREE.Quaternion;
    lastDqOrbit?: THREE.Quaternion;
  };

/** Arrastre del gizmo de sub-selección (caras/aristas/vértices): mueve o
 * escala los vértices de la selección en el espacio LOCAL de la malla.
 * `vertOriginales`/`vertIdx` son la selección al empezar (índices de
 * vértice deduplicados) y `centroLocal` el pivote de la escala.
 * mover: delta del rayo sobre la línea del eje (startT). escala: plano
 * frontal a la cámara por el centroide (factor = 1 + delta·basisU). */
type SelectionGizmoDrag = {
  axis: GizmoAxis;
  mode: 'move' | 'scale' | 'uniform-scale';
  /** eje (mundo, sin girar con el objeto) por el que se mueve el gesto */
  axisWorld: THREE.Vector3;
  startT: number;
  centroMundoStart: THREE.Vector3;
  /** Plano de captura (escala: ⟂ a la vista por el centroide) */
  plane: THREE.Plane;
  /** Base para medir el desplazamiento en pantalla del gesto de escala */
  basisU: THREE.Vector3;
  /** Vértices al empezar (copia en local) e índices únicos a mover */
  vertOriginales: Vertex3D[];
  vertIdx: number[];
  centroLocal: THREE.Vector3;
  latestVerts?: Vertex3D[];
  lastEmit?: number;
};

/** Vértices ÚNICOS de la sub-selección (dedupe) + su centroide en LOCAL:
 * pivote del gizmo de la selección. Caras → todos los vértices de las
 * caras; vértices → tal cual; segmentos → extremos de las aristas. */
function collectSelectionVerts(
  m: Mesh,
  target: 'cara' | 'vertice' | 'segmento',
  faceIds: number[],
  vertexIds: number[],
  edgeIds: string[]
): { vertIdx: number[]; centroLocal: THREE.Vector3 } {
  const set = new Set<number>();
  if (target === 'cara') {
    for (const f of faceIds) {
      const face = m.faces[f];
      if (face) {
        for (const vi of face) {
          getVertexGroup(m, vi).forEach(v => set.add(v));
        }
      }
    }
  } else if (target === 'vertice') {
    for (const vi of vertexIds) {
      getVertexGroup(m, vi).forEach(v => set.add(v));
    }
  } else {
    const incluidas = new Set(edgeIds);
    for (const edge of deriveMeshEdges(m)) {
      if (!incluidas.has(edge.key)) continue;
      getVertexGroup(m, edge.a).forEach(v => set.add(v));
      getVertexGroup(m, edge.b).forEach(v => set.add(v));
    }
  }
  if (set.size === 0) return { vertIdx: [], centroLocal: new THREE.Vector3() };
  const centro = new THREE.Vector3();
  for (const idx of set) {
    const v = m.vertices[idx];
    if (!v) continue;
    centro.x += v.x;
    centro.y += v.y;
    centro.z += v.z;
  }
  centro.divideScalar(set.size);
  return { vertIdx: [...set], centroLocal: centro };
}

/** Normal (en espacio LOCAL) promedio de las caras que el elemento o
 *  elementos seleccionados tocan. La usa el gizmo de la sub-selección para
 *  flotar JUSTO por delante de la superficie: el centroide de la selección
 *  toca la malla y sin esto las flechas quedan medio hundidas dentro del
 *  objeto (el usuario lo vio con polígonos y con aristas). */
function normalSubSeleccion(
  m: Mesh,
  target: 'cara' | 'vertice' | 'segmento',
  faceIds: number[],
  vertexIds: number[],
  edgeIds: string[]
): THREE.Vector3 | null {
  const caras = new Set<number>();
  if (target === 'cara') {
    for (const f of faceIds) caras.add(f);
  } else if (target === 'vertice') {
    // Caras que tocan CUALQUIERA de los vértices seleccionados.
    for (let i = 0; i < m.faces.length; i++) {
      const face = m.faces[i];
      if (!face) continue;
      for (const vi of vertexIds) {
        if (face.includes(vi)) { caras.add(i); break; }
      }
    }
  } else {
    // Caras que contienen los dos extremos de cada arista seleccionada.
    const incluidas = new Set(edgeIds);
    for (const edge of deriveMeshEdges(m)) {
      if (!incluidas.has(edge.key)) continue;
      for (let i = 0; i < m.faces.length; i++) {
        const face = m.faces[i];
        if (!face) continue;
        if (face.includes(edge.a) && face.includes(edge.b)) caras.add(i);
      }
    }
  }
  const normal = new THREE.Vector3();
  let contadas = 0;
  caras.forEach((f) => {
    const nf = computeFaceNormal(m, f);
    if (nf) { normal.add(nf); contadas++; }
  });
  return contadas > 0 ? normal.normalize() : null;
}

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
/**
 * Firma barata de TODO lo que el duplicado del objeto dibuja (figura +
 * material): la usa el bucle de escena para decidir si el duplicado sigue
 * al día. Cambia con cualquier ajuste visual del objeto — textura, acabado,
 * opacidad, relieve, tinte, texturas/colores por cara — hecho SIN
 * seleccionarlo. Antes el duplicado se montaba una sola vez y esos ajustes
 * no se veían hasta que el objeto pasaba a ser la malla principal.
 */
function firmaVisualObjeto(
  object: NonNullable<Viewer3DProps['objects']>[number]
): string {
  const m = object.mesh;
  if (!m) return object.id;
  return JSON.stringify([
    object.smooth ?? null,
    object.textureProjection ?? null,
    m.vertices.length,
    m.faces.length,
    m.uvs?.length ?? 0,
    m.texture ?? null,
    m.textureFinish ?? null,
    m.textureColor ?? null,
    m.textureRelief ?? null,
    m.textureRepeat ?? null,
    m.textureRepeatY ?? null,
    m.bumpTexture ?? null,
    m.bumpTextureRepeat ?? null,
    m.bumpTextureRepeatY ?? null,
    m.opacity ?? null,
    m.textureMaterialParams ?? null,
    m.faceColors ?? null,
    m.faceTextures ?? null,
    m.faceOpacities ?? null,
  ]);
}

function buildGizmoHandles(group: THREE.Group): THREE.Mesh[] {
  const handles: THREE.Mesh[] = [];
  // Cubo central: escala uniforme en X, Y y Z a la vez.
  const center = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  );
   center.userData = { axis: 'x' as GizmoAxis, mode: 'uniform-scale', originalColor: 0xffffff };
  center.renderOrder = 999;
  group.add(center);
  handles.push(center);
  // Cuadradito pequeño ENCIMA del cubo central (sobre el eje vertical):
  // acerca el lado y el ancho a la vez (X y Z) sin variar la altura (Y).
  const flat = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x40e0ff, depthTest: false })
  );
   flat.userData = { axis: 'y' as GizmoAxis, mode: 'planar-scale', originalColor: 0x40e0ff };
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
       y: number,
       originalColor?: number
     ) => {
       const m = new THREE.Mesh(geo, mat);
       m.userData = { axis, mode, originalColor };
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
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffd93d, depthTest: false });
    // Flecha (entera: palo + punta) = mover
    handle(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 12), axisMat, 'move', 0.5, color);
    hitHandle(new THREE.CylinderGeometry(0.045, 0.045, 1.08, 12), 'move', 0.5);
    handle(new THREE.ConeGeometry(0.035, 0.12, 16), axisMat, 'move', 1.08, color);
    hitHandle(new THREE.ConeGeometry(0.09, 0.22, 16), 'move', 1.08);
    // Bolita del color del eje = mover
    handle(new THREE.SphereGeometry(0.04, 16, 12), axisMat, 'move', 0.86, color);
    hitHandle(new THREE.SphereGeometry(0.1, 16, 12), 'move', 0.86);
    // Bolita amarilla = estirar a lo largo del eje. Más cerca del centro
    // (0.55) que de los aros (que cruzan cada eje a 0.7): si coincidiera
    // ahí sería muy difícil cogerla con el ratón sin tocar el aro.
    handle(
      new THREE.SphereGeometry(0.038, 16, 12),
      yellowMat,
      'scale',
      0.55,
      0xffd93d
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
    ring.userData = { axis, mode: 'rotate', originalColor: color };
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
 * Manipulador de la SUB-SELECCIÓN (caras/aristas/vértices): tres flechas
 * para MOVER, tres bolas para ESCALAR por eje y un cubo central para
 * escala uniforme. Sin aros de rotación ni cuadrado plano (así se pidió:
 * solo mover + escalar). Mismo patrón de proxies «hit» invisibles que el
 * gizmo de objetos; asas con depthTest off para verse siempre delante.
 */
function buildSelectionGizmoHandles(group: THREE.Group): THREE.Mesh[] {
  const handles: THREE.Mesh[] = [];
  const asa = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    axis: GizmoAxis,
    mode: 'move' | 'scale' | 'uniform-scale',
    pos: [number, number, number]
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.userData = { axis, mode, originalColor: (mat as THREE.MeshBasicMaterial).color.getHex() };
    m.position.set(pos[0], pos[1], pos[2]);
    m.renderOrder = 999;
    group.add(m);
    handles.push(m);
    return m;
  };
  const hitAsa = (
    geo: THREE.BufferGeometry,
    axis: GizmoAxis,
    mode: 'move' | 'scale' | 'uniform-scale',
    pos: [number, number, number]
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
    hit.position.set(pos[0], pos[1], pos[2]);
    hit.renderOrder = 1000;
    group.add(hit);
    handles.push(hit);
    return hit;
  };
  // Cubo central: escala uniforme de TODOS los vértices seleccionados
  // (pivote = centroide de la selección) con un solo gesto.
  asa(new THREE.BoxGeometry(0.14, 0.14, 0.14),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    'x', 'uniform-scale', [0, 0, 0]);
  hitAsa(new THREE.BoxGeometry(0.2, 0.2, 0.2), 'x', 'uniform-scale', [0, 0, 0]);
  for (const axis of ['x', 'y', 'z'] as GizmoAxis[]) {
    const color = GIZMO_AXIS_COLORS[axis];
    const dir = GIZMO_AXIS_DIR[axis];
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const amarillo = new THREE.MeshBasicMaterial({ color: 0xffd93d, depthTest: false });
    // Las asas se modelan a lo largo de +Y (cilindro/cone); cada eje gira
    // SU geometría al eje que le toca — como el gizmo de objetos hace con
    // su axisGroup. Sin esto las flechas X y Z quedan verticales y las
    // puntas apuntan todas hacia arriba.
    const geoDelEje = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      if (axis === 'x') g.rotateZ(-Math.PI / 2);
      else if (axis === 'z') g.rotateX(Math.PI / 2);
      return g;
    };
    // Flecha = mover según el eje (palo corto + punta, como el gizmo de
    // objetos pero más corto: la selección es pequeña).
    asa(geoDelEje(new THREE.CylinderGeometry(0.007, 0.007, 0.8, 12)), mat, axis, 'move',
      [dir.x * 0.4, dir.y * 0.4, dir.z * 0.4]);
    asa(geoDelEje(new THREE.ConeGeometry(0.032, 0.11, 16)), mat, axis, 'move',
      [dir.x * 0.86, dir.y * 0.86, dir.z * 0.86]);
    hitAsa(geoDelEje(new THREE.CylinderGeometry(0.045, 0.045, 0.92, 12)), axis, 'move',
      [dir.x * 0.42, dir.y * 0.42, dir.z * 0.42]);
    hitAsa(geoDelEje(new THREE.ConeGeometry(0.085, 0.2, 16)), axis, 'move',
      [dir.x * 0.88, dir.y * 0.88, dir.z * 0.88]);
    // Bola amarilla = estirar/escalar la selección según el eje
    // (pivote en el centroide: escala por distancia al pivote).
    asa(new THREE.SphereGeometry(0.036, 16, 12), amarillo, axis, 'scale',
      [dir.x * 0.55, dir.y * 0.55, dir.z * 0.55]);
    hitAsa(new THREE.SphereGeometry(0.095, 16, 12), axis, 'scale',
      [dir.x * 0.55, dir.y * 0.55, dir.z * 0.55]);
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

/** Caja alineada de una lista de vértices (mínimos y máximos por eje). */
type CajaV = {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
};

function cajaDeVertices(vertices: Vertex3D[]): CajaV | null {
  if (vertices.length === 0) return null;
  const c: CajaV = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (const v of vertices) {
    if (v.x < c.minX) c.minX = v.x;
    if (v.x > c.maxX) c.maxX = v.x;
    if (v.y < c.minY) c.minY = v.y;
    if (v.y > c.maxY) c.maxY = v.y;
    if (v.z < c.minZ) c.minZ = v.z;
    if (v.z > c.maxZ) c.maxZ = v.z;
  }
  return c;
}

/** Eje normal de una cara alineada: 'x' (cara YZ), 'y' (cara XZ), 'z' (cara XY). */
type EjeProy = 'x' | 'y' | 'z';

/**
 * Cara PLANA más probable de la figura: la perpendicular al eje de MENOR
 * extensión — la caja es más delgada por ahí, o sea que esa es la cara
 * grande (una placa de pie abraza su cara YZ, tumbada abraza la XZ de
 * arriba). En empate gana Z: la proyección frontal de siempre.
 */
function ejeCaraPlana(c: CajaV): EjeProy {
  const ex = c.maxX - c.minX;
  const ey = c.maxY - c.minY;
  const ez = c.maxZ - c.minZ;
  if (ez <= ex && ez <= ey) return 'z';
  if (ex <= ey) return 'x';
  return 'y';
}

/**
 * Eje de la envolvente CILÍNDRICA: la figura gira alrededor del eje cuyos
 * DOS ejes perpendiculares se parecen más (la sección es redonda). Una
 * taza de torno: X≈Z → eje Y (siempre, como hasta ahora); un tubo tumbado
 * a lo largo de X: Y≈Z → eje X.
 */
function ejeCilindro(c: CajaV): EjeProy {
  const ex = c.maxX - c.minX;
  const ey = c.maxY - c.minY;
  const ez = c.maxZ - c.minZ;
  const dY = Math.abs(ex - ez); // perpendiculares del eje Y: X y Z
  const dX = Math.abs(ey - ez); // perpendiculares del eje X: Y y Z
  const dZ = Math.abs(ex - ey); // perpendiculares del eje Z: X y Y
  if (dY <= dX && dY <= dZ) return 'y';
  if (dX <= dZ) return 'x';
  return 'z';
}

/**
 * UV de la proyección PLANA sobre la cara más probable. V crece hacia
 * ARRIBA de la cara (la convención de lib/geometry.ts). El eje `eje` es
 * el normal de la cara (ejeCaraPlana) y la pieza amarilla se coloca en
 * ese mismo lado, así que pieza y textura siempre coinciden.
 */
function uvCaraPlana(
  p: { x: number; y: number; z: number },
  c: CajaV,
  eje: EjeProy
): [number, number] {
  const rx = c.maxX - c.minX || 1;
  const ry = c.maxY - c.minY || 1;
  const rz = c.maxZ - c.minZ || 1;
  if (eje === 'z') return [(p.x - c.minX) / rx, (p.y - c.minY) / ry];
  // Cara superior (visto desde arriba): arriba de la textura = -Z.
  if (eje === 'y') return [(p.x - c.minX) / rx, (c.maxZ - p.z) / rz];
  // Cara de costado (vista desde +X): arriba de la textura = +Y.
  return [(c.maxZ - p.z) / rz, (p.y - c.minY) / ry];
}

/**
 * UV de la envolvente CILÍNDRICA alrededor del eje `eje`.
 */
function uvCilindrica(
  p: { x: number; y: number; z: number },
  c: CajaV,
  eje: EjeProy
): [number, number] {
  const rx = c.maxX - c.minX || 1;
  const ry = c.maxY - c.minY || 1;
  const rz = c.maxZ - c.minZ || 1;
  if (eje === 'y') {
    const u = ((Math.atan2(p.z, p.x) / (Math.PI * 2)) + 1) % 1;
    return [u, (p.y - c.minY) / ry];
  }
  if (eje === 'x') {
    const u = ((Math.atan2(p.y, p.z) / (Math.PI * 2)) + 1) % 1;
    return [u, (p.x - c.minX) / rx];
  }
  const u = ((Math.atan2(p.y, p.x) / (Math.PI * 2)) + 1) % 1;
  return [u, (p.z - c.minZ) / rz];
}

/**
 * Los tres lados del objeto DENTRO DE LA ESCENA: el lado de cada eje
 * local multiplicado por la escala de ese eje. Los VÉRTICES no cambian
 * al estirar el objeto con el gizmo (un cubo estirado sigue siendo un
 * cubo por dentro, con sus tres lados iguales) — el muro se crea con la
 * ESCALA. Mirar solo la caja de vértices daba empate y la pieza caía en
 * el canto; con la escala, un cubo estirado en pared delgada×alto×largo
 * elige la cara grande de pared. El GIRO no entra: la cara y la normal
 * giran con el objeto, sus anchuras relativas no cambian.
 */
function ladosDeEscena(
  c: CajaV,
  sx: number, sy: number, sz: number
): [number, number, number] {
  return [
    (c.maxX - c.minX) * Math.abs(sx || 1),
    (c.maxY - c.minY) * Math.abs(sy || 1),
    (c.maxZ - c.minZ) * Math.abs(sz || 1),
  ];
}

/** CARA MÁS PROBABLE mirando el objeto tal y como se ve (con su escala). */
function ejeCaraPlanaDeEscena(
  c: CajaV, sx: number, sy: number, sz: number
): EjeProy {
  const [ex, ey, ez] = ladosDeEscena(c, sx, sy, sz);
  // Misma regla y desempates que ejeCaraPlana, pero con la escala.
  if (ez <= ex && ez <= ey) return 'z';
  if (ex <= ey) return 'x';
  return 'y';
}

/** EJE CILÍNDRICO mirando el objeto tal y como se ve (con su escala). */
function ejeCilindroDeEscena(
  c: CajaV, sx: number, sy: number, sz: number
): EjeProy {
  const [ex, ey, ez] = ladosDeEscena(c, sx, sy, sz);
  const dY = Math.abs(ex - ez); // perpendiculares del eje Y: X y Z
  const dX = Math.abs(ey - ez); // perpendiculares del eje X: Y y Z
  const dZ = Math.abs(ex - ey); // perpendiculares del eje Z: X y Y
  // Misma regla y desempates que ejeCilindro, pero con la escala.
  if (dY <= dX && dY <= dZ) return 'y';
  if (dX <= dZ) return 'x';
  return 'z';
}

/**
 * Pieza amarilla de la ayuda de proyección: el marco que enseña dónde
 * está sentada la textura y que se mueve/gira/estira con su propio
 * manipulador. Se dibuja en las coordenadas LOCALES del objeto (las
 * mismas con las que se calculan las UV), así que en reposo la pieza
 * abraza la figura y la textura queda igual que sin ayuda.
 *
 * - Plana: rectángulo delante de la CARA MÁS PROBABLE (la perpendicular
 *   al eje más delgado de la caja — la cara grande, no el canto) con una
 *   rayita marcando el «arriba» de la textura. Alejarlo de la cara no
 *   cambia el mapeo, solo dónde se ve el marco.
 * - Envolvente cilíndrica: tubo de segmentos alrededor del eje de la
 *   figura (el que tiene la sección más redonda).
 * - Esférica: esfera envolviendo la figura.
 */
function buildTextureHelperVisual(
  projection: LatheTextureProjection,
  vertices: Vertex3D[],
  /** Escala ACTUAL del objeto: la cara se elige en la escena (estirada). */
  escala?: { sx?: number; sy?: number; sz?: number }
): THREE.Group {
  const sx = escala?.sx ?? 1;
  const sy = escala?.sy ?? 1;
  const sz = escala?.sz ?? 1;
  const group = new THREE.Group();
  if (vertices.length === 0) return group;
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd93d,
    transparent: true,
    opacity: 0.5,
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
  let maxRYZ = 0; // radio máximo en el plano YZ (tubo a lo largo de X)
  let maxRXY = 0; // radio máximo en el plano XY (tubo a lo largo de Z)
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
    maxR = Math.max(maxR, Math.hypot(v.x, v.z));
    maxR3 = Math.max(maxR3, Math.hypot(v.x, v.y, v.z));
    maxRYZ = Math.max(maxRYZ, Math.hypot(v.y, v.z));
    maxRXY = Math.max(maxRXY, Math.hypot(v.x, v.y));
  }

  if (projection === 'planar') {
    // La pieza abraza la cara MÁS PROBABLE (la perpendicular al eje de
    // menor extensión de la caja: la cara grande), no el canto. La
    // rayita marca el «arriba» de la textura (v=1), igual que las UV.
    const eje = ejeCaraPlanaDeEscena({ minX, maxX, minY, maxY, minZ, maxZ }, sx, sy, sz);
    const tickZ = Math.max(0.06, (maxZ - minZ) * 0.12);
    const tickY = Math.max(0.06, (maxY - minY) * 0.12);
    if (eje === 'z') {
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
      seg(cx, maxY, z, cx, maxY + tickY, z);
    } else if (eje === 'y') {
      // Cara horizontal (placa tumbada): rectángulo encima.
      const y = maxY + Math.max(0.15, (maxY - minY) * 0.4);
      const corners: Array<[number, number]> = [
        [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ],
      ];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        seg(ax, y, az, bx, y, bz);
      }
      // v=1 en z=minZ (arriba de la textura = -Z): rayita ahí, saliendo.
      const cx = (minX + maxX) / 2;
      seg(cx, y, minZ, cx, y + tickY, minZ);
    } else {
      // Cara de costado: rectángulo al lado de la figura (plano YZ).
      const x = maxX + Math.max(0.15, (maxX - minX) * 0.4);
      const corners: Array<[number, number]> = [
        [minY, minZ], [maxY, minZ], [maxY, maxZ], [minY, maxZ],
      ];
      for (let i = 0; i < 4; i++) {
        const [ay, az] = corners[i];
        const [by, bz] = corners[(i + 1) % 4];
        seg(x, ay, az, x, by, bz);
      }
      // v=1 arriba (y=maxY): rayita ahí, saliendo en +X.
      const cz = (minZ + maxZ) / 2;
      seg(x, maxY, cz, x + tickZ, maxY, cz);
    }
  } else if (projection === 'cylindrical') {
    // Tubo por segmentos: aros + verticales alrededor del eje de la
    // FIGURA — el eje cuya sección (los dos ejes perpendiculares) se
    // parece más. Para las figuras de torno eso es el eje Y de siempre.
    const eje = ejeCilindroDeEscena({ minX, maxX, minY, maxY, minZ, maxZ }, sx, sy, sz);
    const RINGS = 5;
    const RSEG = 48;
    const VSEG = 12;
    if (eje === 'y') {
      const r = Math.max(0.25, maxR * 1.1);
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
    } else if (eje === 'x') {
      // Tubo tumbado a lo largo de X: aros en el plano YZ.
      const r = Math.max(0.25, maxRYZ * 1.1);
      for (let i = 0; i < RINGS; i++) {
        const x = minX + ((maxX - minX) * i) / (RINGS - 1);
        for (let k = 0; k < RSEG; k++) {
          const a0 = (k / RSEG) * Math.PI * 2;
          const a1 = ((k + 1) / RSEG) * Math.PI * 2;
          seg(
            x, r * Math.cos(a0), r * Math.sin(a0),
            x, r * Math.cos(a1), r * Math.sin(a1)
          );
        }
      }
      for (let k = 0; k < VSEG; k++) {
        const a = (k / VSEG) * Math.PI * 2;
        seg(
          minX, r * Math.cos(a), r * Math.sin(a),
          maxX, r * Math.cos(a), r * Math.sin(a)
        );
      }
    } else {
      // Tubo a lo largo de Z: aros en el plano XY.
      const r = Math.max(0.25, maxRXY * 1.1);
      for (let i = 0; i < RINGS; i++) {
        const z = minZ + ((maxZ - minZ) * i) / (RINGS - 1);
        for (let k = 0; k < RSEG; k++) {
          const a0 = (k / RSEG) * Math.PI * 2;
          const a1 = ((k + 1) / RSEG) * Math.PI * 2;
          seg(
            r * Math.cos(a0), r * Math.sin(a0), z,
            r * Math.cos(a1), r * Math.sin(a1), z
          );
        }
      }
      for (let k = 0; k < VSEG; k++) {
        const a = (k / VSEG) * Math.PI * 2;
        seg(
          r * Math.cos(a), r * Math.sin(a), minZ,
          r * Math.cos(a), r * Math.sin(a), maxZ
        );
      }
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

/**
 * Computes the centroid (promedio de vértices) de cada cara de la malla,
 * devolviendo las posiciones en ESPACIO MUNDI (tras aplicar la matriz del
 * objeto) para poder proyectarlas a pantalla.
 */
export function computeFaceCentroids(
  mesh: Mesh,
  worldMatrix: THREE.Matrix4
): THREE.Vector3[] {
  const centroids: THREE.Vector3[] = [];
  for (const face of mesh.faces) {
    if (face.length < 3) continue;
    let sx = 0, sy = 0, sz = 0;
    for (const vi of face) {
      const v = mesh.vertices[vi];
      if (!v) continue;
      sx += v.x; sy += v.y; sz += v.z;
    }
    const n = face.length;
    const local = new THREE.Vector3(sx / n, sy / n, sz / n);
    const world = local.applyMatrix4(worldMatrix);
    centroids.push(world);
  }
  return centroids;
}

/** Proyecta una posición 3D al espacio de pantalla (píxeles canvas). */
export function projectToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  canvasRect: DOMRect
): { x: number; y: number } | null {
  const proj = worldPos.clone().project(camera);
  if (proj.z > 1 || proj.z < -1) return null;
  return {
    x: ((proj.x + 1) * 0.5) * canvasRect.width + canvasRect.left,
    y: ((1 - proj.y) * 0.5) * canvasRect.height + canvasRect.top,
  };
}

/** Punto dentro de un rectángulo (en pantalla). */
function isPointInRect(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): boolean {
  return px >= Math.min(x1, x2) && px <= Math.max(x1, x2) &&
         py >= Math.min(y1, y2) && py <= Math.max(y1, y2);
}

/** Punto dentro de un círculo (en pantalla). */
function isPointInCircle(
  px: number, py: number,
  cx: number, cy: number, radius: number
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Punto dentro de un polígono (ray-casting, en pantalla). */
function isPointInPolygon(px: number, py: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi + 1e-10) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Malla principal editable del grupo: la construye el efecto de
 * geometría, que no siempre la nombra 'mesh' (solo las instantáneas del
 * constructor la nombran). Busca por nombre y, si no aparece, toma el
 * primer Mesh propio del grupo (sin ser copia pegada ni cuerpo de
 * cámara-objeto).
 */
function findMainMesh(meshGroup: THREE.Group | null): THREE.Mesh | undefined {
  if (!meshGroup) return undefined;
  // Una malla es de la figura ACTIVA si ni ella ni ninguno de sus padres
  // lleva la marca de duplicado de otro objeto ni el cuerpo de una
  // cámara-objeto.
  const esElegible = (o: THREE.Mesh): boolean => {
    if (o.userData?.sceneObjectDuplicate || o.userData?.cameraBodyActive) {
      return false;
    }
    let p: THREE.Object3D | null = o.parent;
    while (p && p !== meshGroup) {
      if (p.userData?.sceneObjectDuplicate || p.userData?.cameraBodyActive) {
        return false;
      }
      p = p.parent;
    }
    return true;
  };
  const named = meshGroup.getObjectByName('mesh');
  if (named instanceof THREE.Mesh && esElegible(named)) {
    return named;
  }
  for (const child of meshGroup.children) {
    if (child instanceof THREE.Mesh && esElegible(child)) {
      return child;
    }
  }
  // Visuales compuestos (texto con malla por letra, instantáneas por
  // pestañas): la malla principal puede estar ANIDADA. Gana la de
  // más triángulos — las flechas del gizmo y las guías quedan fuera por
  // tamaño y porque no hay malla rival con volumen real.
  let mejor: THREE.Mesh | undefined;
  let mejorTri = 0;
  meshGroup.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !esElegible(o)) return;
    const geo = o.geometry;
    if (!geo) return;
    const tri = geo.index
      ? geo.index.count / 3
      : (geo.getAttribute('position')?.count ?? 0);
    if (tri > mejorTri) {
      mejorTri = tri;
      mejor = o;
    }
  });
  return mejor;
}

/**
 * Construye un mesh de overlay (malla de resaltado) para las caras
 * seleccionadas: geometría de triángulos de esas caras con material
 * semitransparente de color cyan brillante. También lo usa el resaltado
 * al pasar el ratón (hover) con su propio color/opacidad.
 */
function buildFaceSelectionOverlay(
  mesh: Mesh,
  faceIds: Set<number>,
  estilo?: { fill?: number; fillOpacity?: number }
): THREE.Mesh | null {
  if (faceIds.size === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  let baseIdx = 0;
  let faceCount = 0;
  for (const face of mesh.faces) {
    if (!faceIds.has(faceCount)) {
      faceCount++;
      continue;
    }
    faceCount++;
    if (face.length < 3) continue;
    const v0 = mesh.vertices[face[0]];
    if (!v0) continue;
    positions.push(v0.x, v0.y, v0.z);
    for (let j = 1; j + 1 < face.length; j++) {
      const v1 = mesh.vertices[face[j]];
      const v2 = mesh.vertices[face[j + 1]];
      if (!v1 || !v2) continue;
      positions.push(v1.x, v1.y, v1.z);
      positions.push(v2.x, v2.y, v2.z);
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      baseIdx += 3;
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  // Tinte sólido y contrastado: AMARILLO es el color de hover Y de selección
  // (petición del usuario — el objeto está gris en el modo y el amarillo se
  // lee claro sobre cualquier fondo). Solo RELLENO (sin contorno de
  // líneas: nada de look de malla). depthTest:true:
  // la superficie del objeto (retardada con polygonOffset en modo
  // selección) oculta los resaltes de atrÁS — el delantero gana el test
  // de profundidad coplanar sin z-fight.
  const material = new THREE.MeshBasicMaterial({
    color: estilo?.fill ?? 0xffff00,
    toneMapped: false, // color puro, sin lavado del tonemapping
    transparent: true,
    opacity: estilo?.fillOpacity ?? 0.9,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const overlay = new THREE.Mesh(geometry, material);
  overlay.renderOrder = 997;
  return overlay;
}

function computeFaceNormal(mesh: Mesh, faceIdx: number): THREE.Vector3 | null {
  const face = mesh.faces[faceIdx];
  if (!face || face.length < 3) return null;
  const a = mesh.vertices[face[0]];
  const b = mesh.vertices[face[1]];
  const c = mesh.vertices[face[2]];
  if (!a || !b || !c) return null;
  const va = new THREE.Vector3(a.x, a.y, a.z);
  const vb = new THREE.Vector3(b.x, b.y, b.z);
  const vc = new THREE.Vector3(c.x, c.y, c.z);
  return new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
}

export function getFaceGroup(mesh: Mesh, startFaceIdx: number): number[] {
  const group = new Set<number>();
  group.add(startFaceIdx);
  const startNormal = computeFaceNormal(mesh, startFaceIdx);
  if (!startNormal) return [startFaceIdx];

  const edgeToFaces = new Map<string, number[]>();
  for (let i = 0; i < mesh.faces.length; i++) {
    const face = mesh.faces[i];
    for (let j = 0; j < face.length; j++) {
      const va = face[j];
      const vb = face[(j + 1) % face.length];
      if (va === vb) continue;
      const key = `${Math.min(va, vb)}-${Math.max(va, vb)}`;
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key)!.push(i);
    }
  }

  const queue = [startFaceIdx];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const face = mesh.faces[current];
    for (let j = 0; j < face.length; j++) {
      const va = face[j];
      const vb = face[(j + 1) % face.length];
      if (va === vb) continue;
      const key = `${Math.min(va, vb)}-${Math.max(va, vb)}`;
      const neighbors = edgeToFaces.get(key) || [];
      for (const n of neighbors) {
        if (!group.has(n)) {
          const nNormal = computeFaceNormal(mesh, n);
          if (nNormal && startNormal.dot(nNormal) > 0.99) {
            group.add(n);
            queue.push(n);
          }
        }
      }
    }
  }
  return Array.from(group);
}

export function getVertexGroup(mesh: Mesh, startVertexIdx: number): number[] {
  const group: number[] = [];
  const startV = mesh.vertices[startVertexIdx];
  if (!startV) return [startVertexIdx];
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    if (v && Math.abs(v.x - startV.x) < 1e-5 && Math.abs(v.y - startV.y) < 1e-5 && Math.abs(v.z - startV.z) < 1e-5) {
      group.push(i);
    }
  }
  return group;
}

export function getEdgeGroup(mesh: Mesh, startEdgeKey: string): string[] {
  const edges = deriveMeshEdges(mesh);
  const edgeMap = new Map<string, { a: number; b: number; key: string }>();
  const adj = new Map<number, string[]>();

  for (const e of edges) {
    edgeMap.set(e.key, e);
    if (!adj.has(e.a)) adj.set(e.a, []);
    adj.get(e.a)!.push(e.key);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.b)!.push(e.key);
  }

  const startEdge = edgeMap.get(startEdgeKey);
  if (!startEdge) return [startEdgeKey];

  const group = new Set<string>();
  group.add(startEdgeKey);

  const getDir = (e: { a: number; b: number }) => {
    const p1 = mesh.vertices[e.a];
    const p2 = mesh.vertices[e.b];
    if (!p1 || !p2) return new THREE.Vector3();
    return new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();
  };

  const startDir = getDir(startEdge);
  if (startDir.lengthSq() < 0.1) return [startEdgeKey];

  const queue = [startEdgeKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const e = edgeMap.get(key);
    if (!e) continue;

    for (const vIdx of [e.a, e.b]) {
      for (const nKey of adj.get(vIdx) || []) {
        if (!group.has(nKey)) {
          const nEdge = edgeMap.get(nKey)!;
          const nDir = getDir(nEdge);
          if (Math.abs(startDir.dot(nDir)) > 0.99) {
            group.add(nKey);
            queue.push(nKey);
          }
        }
      }
    }
  }

  return Array.from(group);
}

/** Aristas lógicas de la malla, excluyendo interiores entre caras coplanares */
export function deriveMeshEdges(mesh: Mesh): Array<{ a: number; b: number; key: string }> {
  const edgeToFaces = new Map<string, { a: number; b: number; faces: number[] }>();
  for (let i = 0; i < mesh.faces.length; i++) {
    const face = mesh.faces[i];
    for (let j = 0; j < face.length; j++) {
      const va = face[j];
      const vb = face[(j + 1) % face.length];
      if (va === vb) continue;
      const min = Math.min(va, vb);
      const max = Math.max(va, vb);
      const key = `${min}-${max}`;
      if (!edgeToFaces.has(key)) {
        edgeToFaces.set(key, { a: min, b: max, faces: [] });
      }
      edgeToFaces.get(key)!.faces.push(i);
    }
  }

  const logicalEdges: Array<{ a: number; b: number; key: string }> = [];
  for (const [key, data] of edgeToFaces.entries()) {
    if (data.faces.length === 1) {
      logicalEdges.push({ a: data.a, b: data.b, key });
    } else {
      let isBoundary = false;
      const n0 = computeFaceNormal(mesh, data.faces[0]);
      for (let k = 1; k < data.faces.length; k++) {
        const nk = computeFaceNormal(mesh, data.faces[k]);
        if (!n0 || !nk || n0.dot(nk) <= 0.99) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) {
        logicalEdges.push({ a: data.a, b: data.b, key });
      }
    }
  }
  return logicalEdges;
}

/** Distancia de un punto a un segmento de pantalla (en píxeles). */
function distanceToSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Umbral en píxeles para la herramienta Línea (y para agarrar la selección). */
const FACE_LINE_TOLERANCE = 12;

/** Píxeles alrededor del primer vértice para CERRAR el polígono con clic. */
const POLIGONO_CIERRE_PX = 10;

/**
 * Elemento sub-seleccionable bajo el cursor: cara (raycast contra la
 * superficie + centroide más próximo), vértice (a <16 px) o arista (a
 * <12 px de su LÍNEA completa). Lo comparten el hover (mousemove) y el
 * clic DIRECTO — el hover ilumina EXACTAMENTE lo que el clic elegiría.
 */
function pickSubElemento(
  m: Mesh,
  meshObj: THREE.Mesh,
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  target: 'cara' | 'vertice' | 'segmento',
  visibleOnly: boolean,
  modoAnillos = false
): { t: 'cara' | 'vertice' | 'segmento'; id: number | string; anillos?: number[] } | null {
  const raycasterPick = new THREE.Raycaster();
  const ndc = new THREE.Vector2(
    ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
    -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1
  );
  raycasterPick.setFromCamera(ndc, camera);
  meshObj.updateWorldMatrix(true, false);
  const worldMatrix = meshObj.matrixWorld;
  // Visibilidad: solo caras FRONTALES (los elementos de lo que está
  // detrás no se pueden ni ver ni elegir — casilla «Solo lo visible»).
  let frente: Uint8Array | null = null;
  if (visibleOnly) {
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    frente = new Uint8Array(m.faces.length);
    for (let i = 0; i < m.faces.length; i++) {
      const face = m.faces[i];
      if (face.length < 3) continue;
      const a = m.vertices[face[0]];
      const b = m.vertices[face[1]];
      const c = m.vertices[face[2]];
      if (!a || !b || !c) continue;
      const wa = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(worldMatrix);
      const wb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(worldMatrix);
      const wc = new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(worldMatrix);
      const n = new THREE.Vector3()
        .subVectors(wb, wa)
        .cross(new THREE.Vector3().subVectors(wc, wa));
      if (n.dot(new THREE.Vector3().subVectors(camPos, wa)) > 0) {
        frente[i] = 1;
      }
    }
  }

  if (target === 'cara') {
    // Cara: raycast + cara más próxima al punto golpeado por su CENTROIDE
    // — el hover ilumina SIEMPRE la cara completa que elegiría el clic
    // (nunca un triángulo suelto del abanico).
    const hits = raycasterPick.intersectObject(meshObj, false);
    if (hits.length === 0) return null;
    const punto = hits[0].point;
    const centroids = computeFaceCentroids(m, worldMatrix);
    let mejor = -1;
    let mejorD = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const d = centroids[i].distanceTo(punto);
      if (d < mejorD) { mejorD = d; mejor = i; }
    }
    if (mejor < 0) return null;
    // Modo anillos: la cara se agrupa en ANILLO COMPLETO (banda de caras
    // — paralelo o meridiano de los objetos curvos). El anillo que se
    // señala es el que pasa por el BORDE DEL CUADRILÁTERO más cercano al
    // cursor: apuntar a un borde horizontal da el anillo horizontal, a
    // uno vertical el vertical.
    if (modoAnillos) {
      const datosAnillos = construirAnillos(m);
      const celdaIdx = datosAnillos ? datosAnillos.faceACelda[mejor] : -1;
      if (datosAnillos && celdaIdx >= 0) {
        const celda = datosAnillos.celdas[celdaIdx];
        let claseElegida: 0 | 1 = 0;
        let mejorAnilloD = Infinity;
        let hayBorde = false;
        for (const clase of [0, 1] as const) {
          for (const borde of celda.clases[clase]) {
            const extremos = extremosBordeAnillo(datosAnillos, borde);
            if (!extremos) continue;
            const pA = projectToScreen(
              new THREE.Vector3(extremos[0].x, extremos[0].y, extremos[0].z).applyMatrix4(worldMatrix),
              camera,
              canvasRect
            );
            const pB = projectToScreen(
              new THREE.Vector3(extremos[1].x, extremos[1].y, extremos[1].z).applyMatrix4(worldMatrix),
              camera,
              canvasRect
            );
            if (!pA || !pB) continue;
            hayBorde = true;
            const d = distanceToSegment(clientX, clientY, pA.x, pA.y, pB.x, pB.y);
            if (d < mejorAnilloD) { mejorAnilloD = d; claseElegida = clase; }
          }
        }
        if (hayBorde) {
          const carasRing = carasAnilloDe(datosAnillos, mejor, claseElegida);
          if (carasRing && carasRing.length > 1) {
            return { t: 'cara', id: mejor, anillos: carasRing };
          }
        }
      }
    }
    return { t: 'cara', id: mejor };
  }

  if (target === 'vertice') {
    // Vértice: el cursor debe estar SOBRE la superficie (raycast con hit)
    // y la esquina elegida es la más cercana al punto golpeado en 3D,
    // dentro de una tolerancia relativa al tamaño de la malla. Así solo
    // se detecta la esquina realmente apuntada: nunca todas a la vez ni
    // vértices lejanos por mera proximidad en pantalla.
    const hitsV = raycasterPick.intersectObject(meshObj, false);
    if (hitsV.length === 0) return null;
    const puntoV = hitsV[0].point;
    let verticeVisible: Uint8Array | null = null;
    if (frente) {
      verticeVisible = new Uint8Array(m.vertices.length);
      for (let i = 0; i < m.faces.length; i++) {
        if (!frente[i]) continue;
        for (const vi of m.faces[i]) {
          if (vi < verticeVisible.length) verticeVisible[vi] = 1;
        }
      }
    }
    // Proyección en mundo de cada vértice + caja envolvente para la
    // tolerancia relativa (independiente del zoom y de la escala).
    const worldPts: Array<THREE.Vector3 | null> = [];
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.vertices.length; i++) {
      const v = m.vertices[i];
      if (!v) { worldPts.push(null); continue; }
      const wp = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix);
      worldPts.push(wp);
      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
      minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);
    }
    const maxDimMundo =
      Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    const tolerancia = maxDimMundo * 0.25;
    let mejorVi = -1;
    let mejorVd = Infinity;
    for (let i = 0; i < worldPts.length; i++) {
      if (verticeVisible && !verticeVisible[i]) continue;
      const wp = worldPts[i];
      if (!wp) continue;
      const dist = wp.distanceTo(puntoV);
      if (dist < mejorVd) { mejorVd = dist; mejorVi = i; }
    }
    if (mejorVi >= 0 && mejorVd <= tolerancia) {
      return { t: 'vertice', id: mejorVi };
    }
    return null;
  }

  // Arista: la MÁS CERCANA EN PANTALLA a la LÍNEA COMPLETA (<12 px), no a
  // su punto medio — distancia del puntero al segmento a-b entero.
  let edgeVisible: Set<string> | null = null;
  if (frente) {
    edgeVisible = new Set<string>();
    for (let i = 0; i < m.faces.length; i++) {
      if (!frente[i]) continue;
      const face = m.faces[i];
      for (let j = 0; j < face.length; j++) {
        const va = face[j];
        const vb = face[(j + 1) % face.length];
        if (va === vb) continue;
        edgeVisible.add(`${Math.min(va, vb)}-${Math.max(va, vb)}`);
      }
    }
  }
  let mejorKey: string | null = null;
  let mejorEd = FACE_LINE_TOLERANCE;
  for (const edge of deriveMeshEdges(m)) {
    if (edgeVisible && !edgeVisible.has(edge.key)) continue;
    const va = m.vertices[edge.a];
    const vb = m.vertices[edge.b];
    if (!va || !vb) continue;
    const pA = projectToScreen(
      new THREE.Vector3(va.x, va.y, va.z).applyMatrix4(worldMatrix),
      camera,
      canvasRect
    );
    const pB = projectToScreen(
      new THREE.Vector3(vb.x, vb.y, vb.z).applyMatrix4(worldMatrix),
      camera,
      canvasRect
    );
    if (!pA || !pB) continue;
    const dist = distanceToSegment(
      clientX, clientY, pA.x, pA.y, pB.x, pB.y
    );
    if (dist < mejorEd) { mejorEd = dist; mejorKey = edge.key; }
  }
  return mejorKey ? { t: 'segmento', id: mejorKey } : null;
}

/**
 * Overlay de vértices seleccionados: una esfera pequeña por vértice, en el
 * espacio LOCAL de la malla (el grupo ya sigue la transform del objeto).
 */
function buildVertexSelectionOverlay(
  mesh: Mesh,
  vertexIds: Set<number>,
  color?: number,
  opts?: { hover?: boolean }
): THREE.Group | null {
  if (vertexIds.size === 0) return null;
  // Radio en función del tamaño de la malla: 1/4 del tamaño anterior
  // (el usuario lo pidió: las esferas amarillas de vértice seleccionado
  // se ven muy grandes).
  let maxDim = 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  if (mesh.vertices.length > 0) {
    maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  }
  // Hover: esfera GRANDE (3x la de seleccion) para que el punto apuntado
  // se vea claramente; la de seleccion sigue discreta para no tapar la malla.
  const radio = opts?.hover
    ? Math.max(0.014, Math.min(0.06, maxDim * 0.012))
    : Math.max(0.005, Math.min(0.0375, maxDim * 0.0025));
  const geometry = new THREE.SphereGeometry(radio, 10, 8);
  const material = new THREE.MeshBasicMaterial({
    // Amarillo: el MISMO color de «seleccionado» que las caras; la guía
    // (todos los vértices) sigue en verde-azulado para que se distinga.
    // depthTest:true — la superficie empujada con polygonOffset deja
    // ganar la esfera coplanar, y el objeto OCULTA los vértices de atrás.
    color: color ?? 0xffff00,
    toneMapped: false, // amarillo puro, sin lavado del tonemapping
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 0.95,
  });
  const group = new THREE.Group();
  let created = 0;
  for (const id of vertexIds) {
    const v = mesh.vertices[id];
    if (!v) continue;
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(v.x, v.y, v.z);
    sphere.renderOrder = 997;
    group.add(sphere);
    created++;
  }
  if (created === 0) {
    geometry.dispose();
    material.dispose();
    return null;
  }
  return group;
}

/**
 * Overlay de segmentos seleccionados: LineSegments brillantes con las
 * aristas seleccionadas, en el espacio LOCAL de la malla.
 */
function buildEdgeSelectionOverlay(
  mesh: Mesh,
  edgeKeys: Set<string>,
  color?: number
): THREE.LineSegments | null {
  if (edgeKeys.size === 0) return null;
  const edges = deriveMeshEdges(mesh);
  let maxDim = 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  if (mesh.vertices.length > 0) {
    maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  }
  // La línea de 1 px coplanar pierde el test de profundidad (y con el
  // antialiasing ni un píxel puro sale): se usa una CAJA fina alargada
  // por cada arista seleccionada — un Mesh sí gana y se ve gruesa.
  const grosor = Math.max(0.03, maxDim * 0.006);
  const material = new THREE.MeshBasicMaterial({
    // Amarillo: mismo color de «seleccionado» que caras y vértices.
    // depthTest:true — oculto tras la superficie (polygonOffset del mesh).
    color: color ?? 0xffff00,
    toneMapped: false, // amarillo puro, sin lavado del tonemapping
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 1,
    // Empuje NEGATIVO propio para ganar el coplanar contra la superficie.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const ejeZ = new THREE.Vector3(0, 0, 1);
  const grupo = new THREE.Group();
  for (const edge of edges) {
    if (!edgeKeys.has(edge.key)) continue;
    const va = mesh.vertices[edge.a];
    const vb = mesh.vertices[edge.b];
    if (!va || !vb) continue;
    const a = new THREE.Vector3(va.x, va.y, va.z);
    const b = new THREE.Vector3(vb.x, vb.y, vb.z);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-6) continue;
    const box = new THREE.Mesh(boxGeo, material);
    box.position.copy(a.add(b).multiplyScalar(0.5));
    box.quaternion.setFromUnitVectors(ejeZ, dir.normalize());
    box.scale.set(grosor, grosor, len);
    box.renderOrder = 997;
    grupo.add(box);
  }
  if (grupo.children.length === 0) return null;
  grupo.renderOrder = 997;
  return grupo as unknown as THREE.LineSegments;
}

/**
 * Guías del modo selección: muestran TODOS los elementos del objetivo
 * activo (no solo los seleccionados) para que el objeto muestre algo en
 * cuanto se elige vértices/segmentos/caras. Viven en el espacio LOCAL de
 * la malla, como los overlays de selección.
 */
function buildVertexGuideOverlay(mesh: Mesh): THREE.Points | null {
  if (mesh.vertices.length === 0) return null;
  // Solo representantes UNICOS por posicion (misma tolerancia 1e-5 que
  // getVertexGroup): un cubo muestra EXACTAMENTE sus 8 esquinas, aunque la
  // malla traiga vertices duplicados (uno por cara, etc.).
  const claves = new Set<string>();
  const unicos: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    if (!v) continue;
    const clave =
      Math.round(v.x * 1e5) + '|' + Math.round(v.y * 1e5) + '|' + Math.round(v.z * 1e5);
    if (claves.has(clave)) continue;
    claves.add(clave);
    unicos.push(v);
  }
  const positions = new Float32Array(unicos.length * 3);
  unicos.forEach((v, i) => {
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    // AZUL puro (el usuario lo pidió: el turquesa se lavaba a blanco sobre
    // las texturas claras y destrozaba la vista). toneMapped:false — sin
    // lavado del tonemapping, se ve el mismo azul sobre cualquier fondo.
    // AZUL OSCURO (el usuario lo pidió: el turquesa viejo quedaba «de un
    // azul muy flojo» sobre las texturas claras). toneMapped:false — se ve
    // el mismo azul sobre cualquier fondo, sin lavado.
    color: 0x1d4ed8,
    toneMapped: false,
    size: 6,
    sizeAttenuation: false,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 0.8,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 996;
  return points;
}

function buildEdgeGuideOverlay(mesh: Mesh): THREE.LineSegments | null {
  const edges = deriveMeshEdges(mesh);
  if (edges.length === 0) return null;
  const positions = new Float32Array(edges.length * 6);
  for (let i = 0; i < edges.length; i++) {
    const va = mesh.vertices[edges[i].a];
    const vb = mesh.vertices[edges[i].b];
    if (!va || !vb) continue;
    positions[i * 6] = va.x;
    positions[i * 6 + 1] = va.y;
    positions[i * 6 + 2] = va.z;
    positions[i * 6 + 3] = vb.x;
    positions[i * 6 + 4] = vb.y;
    positions[i * 6 + 5] = vb.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x1d4ed8, // mismo AZUL OSCURO de la guía de vértices
    toneMapped: false,
    // depthTest:true — el objeto oculta la guía de atrÁS (el mesh se
    // empuja con polygonOffset durante el modo selección).
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 0.5,
  });
  const wire = new THREE.LineSegments(geometry, material);
  wire.renderOrder = 996;
  return wire;
}

function buildFaceGuideOverlay(mesh: Mesh): THREE.Points | null {
  if (mesh.faces.length === 0) return null;
  // Un punto por centroide de cara (espacio local: matriz identidad).
  const centroids = computeFaceCentroids(mesh, new THREE.Matrix4());
  if (centroids.length === 0) return null;
  const positions = new Float32Array(centroids.length * 3);
  centroids.forEach((c, i) => {
    positions[i * 3] = c.x;
    positions[i * 3 + 1] = c.y;
    positions[i * 3 + 2] = c.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    // Celeste CLARO: el usuario lo dejó tal cual («deja los blancos») —
    // es el celeste que sobre las texturas se ve blanco y a él le vale.
    color: 0x8be9e0,
    size: 4,
    sizeAttenuation: false,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    opacity: 0.8,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 996;
  return points;
}

/** Construye la escena aislada del gizmo de ejes (tres flechas X/Y/Z con
 *  sus letras). Devuelve además el grupo que hay que reorientar y la
 *  cámara ortográfica fija que lo mira desde +Z. */
function buildAxisGizmo(): {
  scene: THREE.Scene;
  group: THREE.Group;
  camera: THREE.OrthographicCamera;
} {
  const scene = new THREE.Scene();
  const group = new THREE.Group();

  const UP = new THREE.Vector3(0, 1, 0);
  const SHAFT_LEN = 0.7;
  const HEAD_LEN = 0.22;
  const SHAFT_R = 0.028;
  const HEAD_R = 0.085;

  const axes: Array<{ dir: THREE.Vector3; color: number; label: string }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xf05252, label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x3ddc84, label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x4a9eff, label: 'Z' },
  ];

  for (const { dir, color, label } of axes) {
    const material = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
    });

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, SHAFT_LEN, 16),
      material
    );
    shaft.quaternion.setFromUnitVectors(UP, dir);
    shaft.position.copy(dir).multiplyScalar(SHAFT_LEN / 2);
    group.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(HEAD_R, HEAD_LEN, 20),
      material
    );
    head.quaternion.setFromUnitVectors(UP, dir);
    head.position.copy(dir).multiplyScalar(SHAFT_LEN + HEAD_LEN / 2);
    group.add(head);

    const sprite = buildAxisLabelSprite(label, color);
    sprite.position
      .copy(dir)
      .multiplyScalar(SHAFT_LEN + HEAD_LEN + 0.18);
    group.add(sprite);
  }

  scene.add(group);

  const camera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  return { scene, group, camera };
}

/** Etiqueta de letra de eje como sprite (siempre de cara a la cámara). */
function buildAxisLabelSprite(text: string, color: number): THREE.Sprite {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size / 2, size / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthTest: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.42, 0.42, 0.42);
  return sprite;
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
    configFinish,
    configRelief,
  onObjectSelect,
  selectedObjectIds,
  giroIndividual,
  onSelectionChange,
    selectionMode,
    onSelectionModeChange,
    faceSelectMode,
    faceSelectionTool,
    faceSelectionTarget,
    anillosCaras,
    faceSelectVisibleOnly,
    wireframeOffSignal,
    selectedFaceIds,
    onFaceSelectionChange,
    selectedVertexIds,
    onVertexSelectionChange,
    selectedEdgeIds,
    onEdgeSelectionChange,
    onFaceSelectionModeChange,
    onFaceSelectionToolChange,
    onFaceSelectionTargetChange,
    onVerticesChange,
    onCtrlEscalarSubSel,
    onRegisterSelectionMove,
   showVerticesDefault = true,
  smoothShading = false,
  showLatheAxis = false,
   textureProjection = 'cylindrical',
   textureRepeat = 1,
   textureRepeatY,
  textureHelper = false,
  textureHelperTransform,
  onTextureHelperTransform,
   gizmo = false,
   gizmoModes,
   gizmoInteractive = true,
   gizmoColorOverride,
    gizmoOffset,
    onGizmoOffsetChange,
    selGizmoInteractive = true,
    selGizmoColorOverride,
    selGizmoOffset,
    onSelGizmoOffsetChange,
   objectTransform,
   camera3D,
   flat2D,
   frameToken,
    onCameraChange,
     onObjectTransform,
     onMultiObjectTransform,
   objectName,
   onObjectNameChange,
   lightConfig,
   onLightConfigChange,
   showLightHelpers = true,
     showGround = false,
      groundTexture = null,
      groundTextureRepeat = 4,
      groundTextureRepeatY,
      groundTextureRelief = 0,
      groundTextureFinish = 'semi-matte',
      groundTextureParams = null,
     objectTextureFinish = 'semi-matte',
     skyboxImage = null,
    onEfectosObjetos,
    onOpenFxConfig,
    showGrid: showGridProp,
     onShowGridChange,
      animationTracks,
      animationTime = 0,
      onAnimationComplete,
       transformTracks,
       pluginTracks,
       effectTracks,
       pluginBaseMeshes,
       motionPlaying,
      showMotionPath,
      onMotionKeyframeMove,
      activeCamera,
      exportCamera,
      cameraEditor,
      onCameraKeyframeMove,
      onCameraTargetMove,
      onCameraTargetOrbit,
      grabacionActiva,
      onGrabacionCaptura,
      grabacionCamaraId = null,
      exportMp4Trigger = 0,
       onExportProgress,
       onExportComplete,
    }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Modo 2D (dibujo técnico): espejo para los cierres del efecto de setup.
  const flat2DRef = useRef(flat2D);
  flat2DRef.current = !!flat2D;
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // Gizmo de ejes (esquina inferior izquierda): escena, grupo de flechas
  // y cámara ortográfica propias, sincronizadas cada frame con la
  // cámara principal.
  const axisGizmoSceneRef = useRef<THREE.Scene | null>(null);
  const axisGizmoGroupRef = useRef<THREE.Group | null>(null);
  const axisGizmoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const cubeCameraRef = useRef<THREE.CubeCamera | null>(null);
  const cubeRenderTargetRef = useRef<THREE.WebGLCubeRenderTarget | null>(null);
  // Entorno brillante (el de la vista previa de texturas creadas): el visor
  // normal refrata el ESCENARIO, que suele ser oscuro — un cristal aplicado
  // saldría negro. Los materiales de texturas creadas llevan este envMap
  // propio, como en la previsualización.
  const envCreadaRef = useRef<THREE.Texture | null>(null);
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
   const animationTracksRef = useRef<AnimationTrack[] | undefined>(animationTracks);
   animationTracksRef.current = animationTracks;
    const animationTimeRef = useRef(animationTime);
    animationTimeRef.current = animationTime;
    // Detect scrubbing: time changed even without playing (tracked in animate loop)
    // Editor de movimiento: espejos para el bucle animate.
    const transformTracksRef = useRef<TransformTrack[] | undefined>(transformTracks);
    transformTracksRef.current = transformTracks;
     const pluginTracksRef = useRef<PluginParamTrack[] | undefined>(pluginTracks);
     pluginTracksRef.current = pluginTracks;
     const effectTracksRef = useRef<EffectTrack[] | undefined>(effectTracks);
     effectTracksRef.current = effectTracks;
    const pluginBaseMeshesRef = useRef<Record<string, unknown> | undefined>(pluginBaseMeshes);
    pluginBaseMeshesRef.current = pluginBaseMeshes;
    // Recorrido editable del objeto seleccionado.
    const showMotionPathRef = useRef(showMotionPath);
    showMotionPathRef.current = showMotionPath;
    const onMotionKeyframeMoveRef = useRef(onMotionKeyframeMove);
    onMotionKeyframeMoveRef.current = onMotionKeyframeMove;
    // Cámara-objeto activa de ESTA ventana: espejo para el bucle animate.
    const activeCameraRef = useRef(activeCamera);
    activeCameraRef.current = activeCamera;
    // Cámara de exportación MP4: espejo para el bucle animate.
    const exportCameraRef = useRef(exportCamera);
    exportCameraRef.current = exportCamera;
    // Bandera: el visor lo está manejando la cámara-objeto (vista de
    // cámara o exportación). OrbitControls queda deshabilitado y sus
    // eventos NO se emiten a los paneles.
    const camaraObjetoManejandoRef = useRef(false);
    // Última vista del panel emitida por el usuario: se restaura al salir
    // del manejo de la cámara-objeto.
    const vistaPanelRef = useRef<Camera3D | null>(null);
    // Visuales del cuerpo de la cámara que maneja esta ventana: quedan
    // ocultos mientras maneja (su lente taparía la imagen) y vuelven al
    // salir.
    const cuerposOcultosRef = useRef<THREE.Object3D[]>([]);
    // Modo grabación: espejos para el bucle animate y los handlers de
    // puntero (que corren fuera del ciclo de render) y estado del arrastre
    // que captura. `grabacionCamaraIdRef` es global: cualquier ventana que
    // suelte el gizmo sobre esa cámara captura un fotograma.
    const grabacionActivaRef = useRef(grabacionActiva);
    grabacionActivaRef.current = grabacionActiva;
    const onGrabacionCapturaRef = useRef(onGrabacionCaptura);
    onGrabacionCapturaRef.current = onGrabacionCaptura;
    const grabacionCamaraIdRef = useRef(grabacionCamaraId);
    grabacionCamaraIdRef.current = grabacionCamaraId;
    const recDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(
      null
    );
    // ZOOM en grabación: la rueda y los botones «Acercar/Alejar» también son
    // gestos de la vista grabadora. `recZoomRef` guarda el último instante
    // de zoom: pausa la evaluación del recorrido (si no, el frame siguiente
    // desharía el acercamiento) y al quedar la vista quieta se captura el
    // fotograma, igual que al soltar un arrastre.
    const recZoomRef = useRef(0);
    const recZoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Estado de la exportación en el frame anterior: al pasar a falso se
    // restauran las ayudas visuales ocultas durante el vídeo.
    const exportPrevioRef = useRef(false);
    // Cámara-objeto en edición: espejo para los manejadores de arrastre que
    // corren fuera del ciclo de render (gizmo, raycast).
    const cameraEditorRef = useRef(cameraEditor);
    cameraEditorRef.current = cameraEditor;
    // Zoom anterior recibido por la prop camera3D: para convertir el cambio
    // de zoom del panel en un dolly proporcional durante la grabación.
    const zoomAnteriorRef = useRef<number | null>(null);
    cameraEditorRef.current = cameraEditor;
    const onCameraTargetOrbitRef = useRef(onCameraTargetOrbit);
    onCameraTargetOrbitRef.current = onCameraTargetOrbit;
    const onCameraKeyframeMoveRef = useRef(onCameraKeyframeMove);
    onCameraKeyframeMoveRef.current = onCameraKeyframeMove;
    // Gestos de ZOOM durante la grabación (rueda del ratón, botones del
    // panel): pausan la evaluación del recorrido — si no, el frame
    // siguiente devolvería la cámara a la pose evaluada y el acercamiento
    // no se vería — y al quedar la vista quieta (~600 ms) capturan un
    // fotograma encadenado al final, como al soltar un arrastre.
    const gestoZoomGrabacion = useCallback(() => {
      if (!grabacionActivaRef.current || !activeCameraRef.current) return;
      recZoomRef.current = performance.now();
      if (recZoomTimerRef.current) clearTimeout(recZoomTimerRef.current);
      recZoomTimerRef.current = setTimeout(() => {
        recZoomTimerRef.current = null;
        if (!grabacionActivaRef.current || !activeCameraRef.current) return;
        recZoomRef.current = 0;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls || !onGrabacionCapturaRef.current) return;
        onGrabacionCapturaRef.current({
          position: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          },
          target: {
            x: controls.target.x,
            y: controls.target.y,
            z: controls.target.z,
          },
          fov: camera.fov,
        });
      }, 620);
    }, []);
    const onCameraTargetMoveRef = useRef(onCameraTargetMove);
    onCameraTargetMoveRef.current = onCameraTargetMove;
   const onAnimationCompleteRef = useRef(onAnimationComplete);
   onAnimationCompleteRef.current = onAnimationComplete;
    const completedTracksRef = useRef<Set<string>>(new Set());
    const exportTriggerRef = useRef(exportMp4Trigger);
    const exportStateRef = useRef<{
      mediaRecorder: MediaRecorder;
      startTime: number;
      duration: number;
    } | null>(null);
    const onExportProgressRef = useRef(onExportProgress);
    onExportProgressRef.current = onExportProgress;
    const onExportCompleteRef = useRef(onExportComplete);
    onExportCompleteRef.current = onExportComplete;
   const vertexHelpersRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const dragRef = useRef<{
    object: THREE.Mesh;
    offset: THREE.Vector3;
    index: number;
  } | null>(null);
   const planeRef = useRef<THREE.Plane | null>(null);
   const selectionModeRef = useRef(selectionMode);
   selectionModeRef.current = selectionMode ?? false;
   const onSelectionChangeRef = useRef(onSelectionChange);
   onSelectionChangeRef.current = onSelectionChange;
   const selectedObjectIdsRef = useRef(selectedObjectIds);
   selectedObjectIdsRef.current = selectedObjectIds ?? [];
   const onSelectionModeChangeRef = useRef(onSelectionModeChange);
   onSelectionModeChangeRef.current = onSelectionModeChange;
    const selectionStartRef = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);
    const selectionRectRef = useRef<HTMLDivElement | null>(null);
    const multiTransformStartRef = useRef<Record<string, ObjectTransform>>({});
    const giroIndividualRef = useRef(giroIndividual);
    giroIndividualRef.current = giroIndividual ?? false;
    const lightConfigRef = useRef(lightConfig);
    lightConfigRef.current = lightConfig;

    // Face selection
    const faceSelectModeRef = useRef(faceSelectMode);
    faceSelectModeRef.current = faceSelectMode ?? false;
    const faceSelectionToolRef = useRef(faceSelectionTool ?? 'rectangle');
    faceSelectionToolRef.current = faceSelectionTool ?? 'rectangle';
    const faceSelectionTargetRef = useRef(faceSelectionTarget ?? 'cara');
    faceSelectionTargetRef.current = faceSelectionTarget ?? 'cara';
    // Modo ANILLOS de caras (botón junto a Mover/Extrudir).
    const faceAnillosRef = useRef(anillosCaras ?? false);
    faceAnillosRef.current = anillosCaras ?? false;
    // Solo capturar elementos VISIBLES (caras frontales; vértices y
    // segmentos de caras frontales): sin esto un rectángulo atraviesa el
    // objeto y selecciona también lo que está detrás.
    const faceSelectVisibleOnlyRef = useRef(faceSelectVisibleOnly ?? true);
    faceSelectVisibleOnlyRef.current = faceSelectVisibleOnly ?? true;
    const selectedFaceIdsRef = useRef(selectedFaceIds ?? []);
    selectedFaceIdsRef.current = selectedFaceIds ?? [];
    const onFaceSelectionChangeRef = useRef(onFaceSelectionChange);
    onFaceSelectionChangeRef.current = onFaceSelectionChange;
    const selectedVertexIdsRef = useRef<number[]>(selectedVertexIds ?? []);
    selectedVertexIdsRef.current = selectedVertexIds ?? [];
    const onVertexSelectionChangeRef = useRef(onVertexSelectionChange);
    onVertexSelectionChangeRef.current = onVertexSelectionChange;
    const selectedEdgeIdsRef = useRef<string[]>(selectedEdgeIds ?? []);
    selectedEdgeIdsRef.current = selectedEdgeIds ?? [];
    const onEdgeSelectionChangeRef = useRef(onEdgeSelectionChange);
    onEdgeSelectionChangeRef.current = onEdgeSelectionChange;
    const onFaceSelectionModeChangeRef = useRef(onFaceSelectionModeChange);
    onFaceSelectionModeChangeRef.current = onFaceSelectionModeChange;
    const onFaceSelectionToolChangeRef = useRef(onFaceSelectionToolChange);
    onFaceSelectionToolChangeRef.current = onFaceSelectionToolChange;
    const onFaceSelectionTargetChangeRef = useRef(onFaceSelectionTargetChange);
    onFaceSelectionTargetChangeRef.current = onFaceSelectionTargetChange;
    const faceSelectionOverlayRef = useRef<THREE.Group | null>(null);
    const faceSelectionStartRef = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);
    const faceSelectionPointsRef = useRef<Array<{ x: number; y: number }>>([]);
    // Polígono cerrado esperando a que el pointerup aplique la selección:
    // se rellena en el clic de cierre y se vacía al usarse.
    const poligonoCerradaRef = useRef<Array<{ x: number; y: number }> | null>(null);
    const faceSelectionPolyDivRef = useRef<SVGPolygonElement | null>(null);
    const faceSelectionRectDivRef = useRef<HTMLDivElement | null>(null);
    const faceSelectionCircleDivRef = useRef<HTMLDivElement | null>(null);
    const faceSelectionLineRef = useRef<SVGLineElement | null>(null);
    // Arrastre de MOVER la selección (vértices/segmentos/caras): el plano
    // de arrastre (mundo), el punto inicial en mundo y en espacio local de
    // la malla, los vértices originales y los índices afectados; en cada
    // movimiento se emiten los vértices ya desplazados por onVerticesChange.
    const faceMoveDragRef = useRef<{
      plane: THREE.Plane;
      worldStart: THREE.Vector3;
      localStart: THREE.Vector3;
      originalVerts: Vertex3D[];
      vertIdx: number[];
      latestVerts?: Vertex3D[];
      lastEmit?: number;
    } | null>(null);
    // Grupo persistente con la GUÍA del objetivo activo (todos los
    // vértices/segmentos/centroides, no solo los seleccionados).
    const faceGuideRef = useRef<THREE.Group | null>(null);
    const faceGuideCacheRef = useRef<{ mesh: Mesh | null; target: string }>({
      mesh: null,
      target: '',
    });
    // Espejo de showLightHelpers para el bucle animate (ocultar/restaurar
    // los ayudantes de luz durante la exportación de vídeo).
    const showLightHelpersRef = useRef(showLightHelpers);
    showLightHelpersRef.current = showLightHelpers;


    const [showVertices, setShowVertices] = useState(showVerticesDefault);
    const [smoothCapture, setSmoothCapture] = useState(true);
    // Espejo del estado en ref: los handlers de puntero del efecto grande
    // del montado (3110-7771) leen el valor ACTUAL por esta vía para que
    // la lista de dependencias NO incluya showVertices. Cada vez que lo
    // incluía, activar/desactivar «Vértices» (y con ello el modo selección
    // de caras, que lo enciende solo) desmontaba TODO el visor y la escena
    // quedaba vacía: los duplicados de objeto no se repueblan solos.
    const showVerticesRef = useRef(showVertices);
    showVerticesRef.current = showVertices;

    const [showFxConfigModal, setShowFxConfigModal] = useState(false);

    // --- Efectos por objeto -------------------------------------------------
    // Los efectos viven en cada objeto (obj.efectos); los toggles del menú
    // FX se aplican a la selección múltiple (o al objeto activo con uno solo).
    const onEfectosObjetosRef = useRef(onEfectosObjetos);
    onEfectosObjetosRef.current = onEfectosObjetos;
    const objectsRefFx = useRef(objects);
    objectsRefFx.current = objects;

    /** Ids a los que se aplica un efecto: la selección múltiple, o el
     *  objeto activo si no hay selección (comportamiento de siempre). */
    const idsFx = useCallback((): string[] => {
      const sel = selectedObjectIdsRef.current ?? [];
      if (sel.length > 0) return sel;
      const activo = selectedObjectIdRef.current;
      return activo ? [activo] : [];
    }, []);

    /** Efectos actuales de los ids dados (mapa id -> lista). */
    const efectosDe = useCallback(
      (ids: string[]): Record<string, EfectoObjeto[] | undefined> => {
        const out: Record<string, EfectoObjeto[] | undefined> = {};
        for (const id of ids) {
          out[id] = objectsRefFx.current?.find((o) => o.id === id)?.efectos;
        }
        return out;
      },
      []
    );

    /** Estado de un tipo de efecto sobre la selección: true (todos),
     *  false (ninguno) o 'indeterminate' (algunos). */
    const estadoEfectoSel = useCallback(
      (tipo: EffectType): boolean | 'indeterminate' => {
        const ids = idsFx();
        if (ids.length === 0) return false;
        let activos = 0;
        for (const id of ids) {
          const e = objectsRefFx.current
            ?.find((o) => o.id === id)
            ?.efectos?.find((e) => e.tipo === tipo && e.activo);
          if (e) activos++;
        }
        if (activos === 0) return false;
        return activos === ids.length ? true : 'indeterminate';
      },
      [idsFx, objects]
    );

    /** Aplica o retira un tipo de efecto a la selección (lote). */
    const toggleEfectoObjetos = useCallback(
      (tipo: EffectType) => {
        const ids = idsFx();
        if (ids.length === 0 || !onEfectosObjetosRef.current) return;
        const estado = estadoEfectoSel(tipo);
        const activar = estado !== true;
        const cambios = aplicarAEfectos(efectosDe(ids), ids, tipo, activar);
        if (Object.keys(cambios).length > 0) onEfectosObjetosRef.current(cambios);
      },
      [idsFx, estadoEfectoSel, efectosDe]
    );

    /** Edita los valores de un tipo de efecto en TODOS los objetos de la
     *  selección que lo tengan (el modal de configuración). */
    const editarValoresEfectoSel = useCallback(
      (tipo: EffectType, valores: EfectoValores) => {
        const ids = idsFx();
        if (ids.length === 0 || !onEfectosObjetosRef.current) return;
        const cambios: Record<string, EfectoObjeto[]> = {};
        for (const id of ids) {
          const lista = objectsRefFx.current?.find((o) => o.id === id)?.efectos;
          const efecto = lista?.find((e) => e.tipo === tipo && e.activo);
          if (!efecto || !lista) continue;
          cambios[id] = lista.map((e) =>
            e.id === efecto.id ? { ...e, params: { ...valoresEfecto(e), ...valores } } : e
          );
        }
        if (Object.keys(cambios).length > 0) onEfectosObjetosRef.current(cambios);
      },
      [idsFx]
    );

    /** Persiste los focos runtime de un tipo en el objeto (auto-creando el
     *  efecto, inactivo, si el objeto no lo tenía: los focos viven aunque
     *  el efecto esté apagado). Devuelve la lista escrita. */
    const guardarFocosObjeto = (
      rt: RuntimeFxObjeto,
      tipo: 'fire' | 'smoke' | 'sparks'
    ): EfectoObjeto[] | null => {
      const obj = objectsRefFx.current?.find((o) => o.id === rt.objectId);
      if (!obj || !onEfectosObjetosRef.current) return null;
      let lista = [...(obj.efectos ?? [])];
      const efecto = lista.find((e) => e.tipo === tipo);
      const focos = rt.focos[tipo].map((v) => ({ x: v.x, y: v.y, z: v.z }));
      if (!efecto) {
        lista.push({
          ...crearEfectoObjeto(tipo, false),
          params: { ...VALORES_DEFECTO_EFECTO[tipo] },
          focos,
        });
      } else {
        lista = lista.map((e) =>
          e.id === efecto.id
            ? { ...e, focos: focos.length > 0 ? focos : undefined }
            : e
        );
      }
      onEfectosObjetosRef.current({ [rt.objectId]: lista });
      return lista;
    };

    /** Igual que guardarFocosObjeto pero para las estrellas colocadas. */
    const guardarEstrellasObjeto = (rt: RuntimeFxObjeto): EfectoObjeto[] | null => {
      const obj = objectsRefFx.current?.find((o) => o.id === rt.objectId);
      if (!obj || !onEfectosObjetosRef.current) return null;
      let lista = [...(obj.efectos ?? [])];
      const efecto = lista.find((e) => e.tipo === 'stars');
      const estrellas = rt.estrellas.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        ...(p.tamaño !== undefined ? { tamaño: p.tamaño } : {}),
      }));
      if (!efecto) {
        lista.push({
          ...crearEfectoObjeto('stars', false),
          params: { ...VALORES_DEFECTO_EFECTO.stars },
          estrellas,
        });
      } else {
        lista = lista.map((e) =>
          e.id === efecto.id
            ? { ...e, estrellas: estrellas.length > 0 ? estrellas : undefined }
            : e
        );
      }
      onEfectosObjetosRef.current({ [rt.objectId]: lista });
      return lista;
    };

    /** Quita TODOS los focos y estrellas colocados de los objetos dados
     *  (botón «Borrar todos los puntos»). */
    const limpiarPuntosObjetos = useCallback((ids: string[]) => {
      const cambios: Record<string, EfectoObjeto[]> = {};
      for (const id of ids) {
        const lista = objectsRefFx.current?.find((o) => o.id === id)?.efectos;
        if (!lista || lista.length === 0) continue;
        cambios[id] = lista.map((e) => ({ ...e, focos: [], estrellas: [] }));
      }
      if (Object.keys(cambios).length > 0) onEfectosObjetosRef.current?.(cambios);
    }, []);

    /** Limpia los focos/estrellas del objeto con el efecto dado (sin
     *  tocar el resto: quitar el campo vacío del todo). */
    const limpiarPuntosDeTipo = (
      id: string,
      tipo: EffectType
    ): EfectoObjeto[] | null => {
      const obj = objectsRefFx.current?.find((o) => o.id === id);
      const lista = obj?.efectos;
      if (!lista || lista.length === 0) return null;
      const efecto = lista.find((e) => e.tipo === tipo);
      if (!efecto) return null;
      const nueva = lista.map((e) =>
        e.id === efecto.id ? { ...e, focos: [], estrellas: [] } : e
      );
      onEfectosObjetosRef.current?.({ [id]: nueva });
      return nueva;
    };

    const [placeTarget, setPlaceTarget] = useState<'fire' | 'smoke' | 'sparks' | 'stars' | null>(null);
    /** Tamaño de estrella mostrado en el slider (se escribe en el efecto). */
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
  // (Ya NO se fuerza alambre ni vértices al entrar en el modo de
  // sub-selección: petición del usuario — el objeto se ve NORMAL y en gris
  // por el lavado del modo, sin vista de alambre ni puntos.)
  // Señal externa para apagar el alambre (p. ej., tras asignar una textura
  // por caras): sin ella, la textura asignada no se ve hasta pulsar a mano
  // el botón «Vista de alambre».
  useEffect(() => {
    if (wireframeOffSignal) setWireframe(false);
  }, [wireframeOffSignal]);
  const [autoRotate, setAutoRotate] = useState(false);
  /** Firma del último estado de cámara que este visor EMITIÓ al padre.
   *  Sirve para no re-aplicar nuestro propio eco: applyCamera llama
   *  controls.update(), que con auto-rotar (o al reproducir una
   *  trayectoria) dispara otro 'change' → otro estado del padre → el
   *  efecto volvería a aplicar → bucle anidado infinito
   *  ("Maximum update depth exceeded"). */
  const ultimaCamEmitidaRef = useRef<string | null>(null);
  const [lightPreset] = useState(0);
  const lightPresetRef = useRef(lightPreset);
  lightPresetRef.current = lightPreset;
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  // La mitad del tamaño original (0.008): el usuario pidió los vértices
  // principales más chicos; el deslizador "Tamaño de vértices" lo ajusta.
  const [vertexSize, setVertexSize] = useState(0.004);
  const vertexSizeRef = useRef(vertexSize);
  vertexSizeRef.current = vertexSize;
  const meshRef = useRef(mesh);
  meshRef.current = mesh;
  // Bounding box del texto (recalculado al cambiar la malla) — usado por
  // efectos de partículas (lluvia, humo) para saber el volumen a cubrir.
  const meshBoxRef = useRef<THREE.Box3 | null>(null);
   const gridGroupRef = useRef<THREE.Group | null>(null);
   // Cuadros de las ventanas 2D: rejilla de lienzo EN EL ESPACIO (mismas
   // líneas y colores que la rejilla del suelo) sobre el plano de la
   // vista; escala con el zoom porque son geometría, no CSS.
  const flatGridRef = useRef<THREE.GridHelper | null>(null);
  // Línea de base de las ventanas 2D (frente, espalda y costados): una
  // franja horizontal al nivel del suelo que marca dónde apoya la base.
  const flatBaseRef = useRef<THREE.Mesh | null>(null);
   const groundRef = useRef<THREE.Mesh | null>(null);
   const skyboxRef = useRef<THREE.Mesh | null>(null);
  // Color base del fondo (cielo) sin luces: permite atenuarlo/realzarlo.
  const skyBaseColorRef = useRef<THREE.Color>(new THREE.Color('hsl(224, 50%, 7%)'));
  // Recorrido de la cámara-objeto (curva + asas arrastrables por fotograma)
  const cameraObjectPathRef = useRef<{
    group: THREE.Group;
    tube: THREE.Mesh;
    handles: THREE.Group;
  } | null>(null);
  // Arrastre activo de un asa del recorrido de la cámara-objeto
  const cameraPathDragRef = useRef<{
    kind: 'keyframe' | 'target';
    index: number;
    plane: THREE.Plane;
    startPos: THREE.Vector3;
    original: THREE.Vector3;
  } | null>(null);
  const rebuildCameraObjectPathRef = useRef<(cam: {
    keyframes: CameraKeyframe[];
    selected: number | null;
    focus: Vec3 | null;
    visible: boolean;
  }) => void>(() => {});
  // Recorrido editable del objeto seleccionado (pistas de transformada del
  // editor de movimiento): curva violeta + asas arrastrables por fotograma.
  const objectMotionPathRef = useRef<{
    group: THREE.Group;
    tube: THREE.Mesh;
    handles: THREE.Group;
  } | null>(null);
  const motionPathDragRef = useRef<{
    index: number;
    plane: THREE.Plane;
    startPos: THREE.Vector3;
    original: THREE.Vector3;
  } | null>(null);
  const rebuildObjectMotionPathRef = useRef<(path: {
    keyframes: { time: number; position: Vec3 }[];
    visible: boolean;
  } | null) => void>(() => {});
  const startMp4ExportRef = useRef<() => void>();
  const latheAxisRef = useRef<THREE.Group | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const spotlightRefs = useRef<THREE.SpotLight[]>([]);

  const onVerticesChangeRef = useRef(onVerticesChange);
  onVerticesChangeRef.current = onVerticesChange;
  const onCtrlEscalarSubSelRef = useRef(onCtrlEscalarSubSel);
  onCtrlEscalarSubSelRef.current = onCtrlEscalarSubSel;
  const onRegisterSelectionMoveRef = useRef(onRegisterSelectionMove);
  onRegisterSelectionMoveRef.current = onRegisterSelectionMove;

  // Mover la selección con los campos numéricos de la barra del editor:
  // desplaza los vértices afectados (según el objetivo actual: caras →
  // sus vértices, vértices → ellos mismos, segmentos → sus extremos) en
  // el espacio LOCAL de la malla y emite la malla completa por
  // onVerticesChange, igual que el arrastre de mover.
  const moverSeleccion = useCallback((dx: number, dy: number, dz: number) => {
    const m = meshRef.current;
    const meshObj = findMainMesh(meshGroupRef.current);
    if (!m || !meshObj || !faceSelectModeRef.current) return;
    const vertIdxSet = new Set<number>();
    const target = faceSelectionTargetRef.current;
    if (target === 'cara') {
      for (const f of selectedFaceIdsRef.current) {
        const face = m.faces[f];
        if (face) {
          for (const vi of face) {
            getVertexGroup(m, vi).forEach(v => vertIdxSet.add(v));
          }
        }
      }
    } else if (target === 'vertice') {
      for (const vi of selectedVertexIdsRef.current) {
        getVertexGroup(m, vi).forEach(v => vertIdxSet.add(v));
      }
    } else {
      for (const edge of deriveMeshEdges(m)) {
        if (!selectedEdgeIdsRef.current.includes(edge.key)) continue;
        getVertexGroup(m, edge.a).forEach(v => vertIdxSet.add(v));
        getVertexGroup(m, edge.b).forEach(v => vertIdxSet.add(v));
      }
    }
    if (vertIdxSet.size === 0) return;
    const verts = m.vertices.map((v) => ({ ...v }));
    for (const idx of vertIdxSet) {
      const v = verts[idx];
      if (!v) continue;
      v.x += dx;
      v.y += dy;
      v.z += dz;
    }
    onVerticesChangeRef.current?.(verts);
  }, []);

  useEffect(() => {
    onRegisterSelectionMoveRef.current?.(moverSeleccion);
  }, [moverSeleccion]);

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

  // --- Efectos por objeto (chispas, fuego, lluvia, humo, estrellas, brillo) ---
  // Runtime de FX por objeto: sistemas de partículas + focos + shells de
  // brillo. El grupo vive DENTRO del grupo visual del objeto (duplicado o
  // malla principal), así viaja con su transform sin matemática extra.
  const fxObjetosRef = useRef<Map<string, RuntimeFxObjeto>>(new Map());
  /** API de efectos para los cierres del bucle de animación (que viven en
   *  el efecto de setup y no ven las funciones del cuerpo del componente). */
  const fxApiRef = useRef<{
    runtimeDe: (id: string, crear?: boolean) => RuntimeFxObjeto | null;
    sincronizar: () => void;
  }>({
    runtimeDe: () => null,
    sincronizar: () => {},
  });
  const placeTargetRef = useRef<'fire' | 'smoke' | 'sparks' | 'stars' | null>(placeTarget);
  placeTargetRef.current = placeTarget;
  const placeDownRef = useRef<{ x: number; y: number } | null>(null);
  const starSizeRef = useRef(starSize);
  starSizeRef.current = starSize;

  // --- Manipulador (flechas X/Y/Z: mover, estirar y rotar) ---
  const gizmoGroupRef = useRef<THREE.Group | null>(null);
  const gizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const gizmoDragRef = useRef<GizmoDrag | null>(null);
  // --- Sub-selección (caras/aristas/vértices): gizmo propio + hover ---
  // El gizmo vive en la escena (coordenadas de mundo) y se re-ancla al
  // centroide de la selección en cada frame, como el de objetos.
  const selectionGizmoGroupRef = useRef<THREE.Group | null>(null);
  const selectionGizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const selectionGizmoDragRef = useRef<SelectionGizmoDrag | null>(null);
  const selectionGizmoCentroRef = useRef<THREE.Vector3 | null>(null);
  const selectionGizmoNormalRef = useRef<THREE.Vector3 | null>(null);
  const selectionKeyRef = useRef(''); // re-deducir el centroide al cambiar
  // Offset de sitio del gizmo (mundo): el usuario lo movió en modo
  // configuración, como el gizmo de objetos. Sincronizado con el prop.
  const selGizmoOffsetRef = useRef(new THREE.Vector3(0, 0, 0));
  const selGizmoOffsetPropRef = useRef(selGizmoOffset);
  const selGizmoInteractiveRef = useRef(selGizmoInteractive);
  selGizmoInteractiveRef.current = selGizmoInteractive;
  const onSelGizmoOffsetChangeRef = useRef(onSelGizmoOffsetChange);
  onSelGizmoOffsetChangeRef.current = onSelGizmoOffsetChange;
  /** Arrastre del gizmo en modo configuración: mueve SU offset de sitio,
   *  no la selección. eje null = cubo central (movimiento libre). */
  const selGizmoOffsetDragRef = useRef<{
    axis: GizmoAxis | null;
    axisDir: THREE.Vector3;
    startPos: THREE.Vector3;
    plane: THREE.Plane;
    startT: number;
    startOffset: THREE.Vector3;
  } | null>(null);
  // El offset llega como prop (vive en el editor, se sincroniza entre
  // ventanas): al cambiar desde fuera se recalca en el ref — menos
  // durante un arrastre activo, que ya actualiza el ref y el visual.
  if (selGizmoOffset !== selGizmoOffsetPropRef.current) {
    selGizmoOffsetPropRef.current = selGizmoOffset;
    if (selGizmoOffset && !selGizmoOffsetDragRef.current) {
      selGizmoOffsetRef.current.set(selGizmoOffset.x, selGizmoOffset.y, selGizmoOffset.z);
    }
  }
  // Resaltado al pasar el ratón: un elemento «candidato» (la cara entera,
  // la arista completa o el punto) se pinta naranja bajo el cursor.
  const faceHoverOverlayRef = useRef<THREE.Group | null>(null);
  const hoverElementRef = useRef<{
    t: 'cara' | 'vertice' | 'segmento';
    id: number | string;
    anillos?: number[];
  } | null>(null);
  const hoverKeyRef = useRef(''); // reconstruir el overlay solo al cambiar
  const lastHoverCheckRef = useRef(0); // throttle ~40 ms
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
  // Los aros de rotación se pueden apagar aparte (checkbox «Círculos»):
  // así solo quedan flechas de mover y puntos de escala.
  const [showRotate, setShowRotate] = useState(true);
  useEffect(() => setShowGizmo(gizmo), [gizmo]);
   const gizmoOnRef = useRef(showGizmo);
   gizmoOnRef.current = showGizmo;
   const gizmoInteractiveRef = useRef(gizmoInteractive);
   gizmoInteractiveRef.current = gizmoInteractive;
    const gizmoOffsetRef = useRef<ObjectTransform>(gizmoOffset ?? IDENTITY_TRANSFORM);
    // Escala base del gizmo, fijada por el efecto de tamano segun el
    // objeto. El offset de configuracion la multiplica por eje para
    // poder escalar el propio manipulador sin tocar la figura.
    const gizmoBaseScaleRef = useRef(1);
    const onGizmoOffsetChangeRef = useRef(onGizmoOffsetChange);
    onGizmoOffsetChangeRef.current = onGizmoOffsetChange;
  // Posición/rotación/escala del objeto: el manipulador las fija
  // arrastrando y se aplican a la malla y a todo lo que la acompaña
  // (halo, partículas, estrellas, helpers de vértices).
  const [transform, setTransform] = useState<ObjectTransform>(
    objectTransform ?? IDENTITY_TRANSFORM
  );
  const transformRef = useRef(transform);
   const onObjectTransformRef = useRef(onObjectTransform);
   onObjectTransformRef.current = onObjectTransform;
   const onMultiObjectTransformRef = useRef(onMultiObjectTransform);
   onMultiObjectTransformRef.current = onMultiObjectTransform;

  // Centro del CONJUNTO multi-seleccionado: centro de la caja que envuelve
  // a todos los objetos seleccionados (el activo va en la figura principal,
  // el resto como duplicados). Sirve de pivote del gizmo y del giro de
  // conjunto. Devuelve null si no hay selección múltiple o geometría.
  const computeSelectionCenter = useCallback((): THREE.Vector3 | null => {
    const meshGroup = meshGroupRef.current;
    const selIds = selectedObjectIdsRef.current ?? [];
    if (!meshGroup || selIds.length < 2) return null;
    meshGroup.updateMatrixWorld();
    const box = new THREE.Box3();
    const activoId = meshGroup.userData.sceneObjectId as string | undefined;
    const principal = meshGroup.children.find(
      (c) => !c.userData.sceneObjectDuplicate
    );
    if (principal && activoId && selIds.includes(activoId)) {
      box.expandByObject(principal);
    }
    for (const child of meshGroup.children) {
      if (!child.userData.sceneObjectDuplicate) continue;
      if (!selIds.includes(child.userData.sceneObjectId)) continue;
      box.expandByObject(child);
    }
    if (box.isEmpty()) return null;
    return box.getCenter(new THREE.Vector3());
  }, []);

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
      // Vista previa EN VIVO del giro multi-selección: durante un arrastre
      // de rotación, los demás objetos seleccionados giran al tiempo con el
      // activo (los duplicados no seleccionados permanecen quietos).
      const dragGiro = gizmoDragRef.current;
      if (
        dragGiro &&
        dragGiro.target === 'object' &&
        dragGiro.mode === 'rotate' &&
        dragGiro.lastDq &&
        dragGiro.lastDqOrbit
      ) {
        const selIds = selectedObjectIdsRef.current ?? [];
        if (selIds.length > 1 && selIds.includes(selectedId)) {
          const startTransforms = multiTransformStartRef.current;
          for (const child of meshGroup.children) {
            if (!child.userData.sceneObjectDuplicate) continue;
            const objId = child.userData.sceneObjectId as string | undefined;
            if (!objId || objId === selectedId || !selIds.includes(objId)) continue;
            const startObj = startTransforms[objId];
            if (!startObj) continue;
            const startQuatHijo = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(startObj.rx, startObj.ry, startObj.rz)
            );
            let posHijo: THREE.Vector3;
            let quatHijo: THREE.Quaternion;
            if (giroIndividualRef.current) {
              // Giro individual: cada objeto gira sobre su propio centro,
              // con la misma rotación de mundo que el activo; posición fija.
              posHijo = new THREE.Vector3(startObj.px, startObj.py, startObj.pz);
              quatHijo = startQuatHijo.clone().premultiply(dragGiro.lastDq);
            } else {
              // Giro de conjunto: todos órbitan alrededor del centro del
              // conjunto con la misma rotación: giran como una sola pieza.
              posHijo = new THREE.Vector3(startObj.px, startObj.py, startObj.pz)
                .sub(dragGiro.startPos)
                .applyQuaternion(dragGiro.lastDqOrbit)
                .add(dragGiro.startPos);
              quatHijo = startQuatHijo.clone().premultiply(dragGiro.lastDqOrbit);
            }
            child.matrix
              .copy(inverseSelected)
              .multiply(
                new THREE.Matrix4().compose(
                  posHijo,
                  quatHijo,
                  new THREE.Vector3(startObj.sx, startObj.sy, startObj.sz)
                )
              );
            child.matrixAutoUpdate = false;
          }
        }
      }
    }
    full(vertexHelpersRef.current, true);
     full(gizmoGroupRef.current, false);
     // Ventanas 2D: el gizmo NO hereda la rotación del objeto. Cuando
     // un objeto ya está girado, el aro de la cámara se pintaba
     // inclinado y el arrastre rotaba sobre ese eje inclinado (la
     // figura tumbeaba en 3D y se perdía el dibujo técnico). Con el
     // gizmo alineado a los ejes del mundo, el override de arrastre
     // (que sale del cuaternión del gizmo) apunta SIEMPRE a un eje del
     // mundo: la rotación en 2D es de pantalla y mover/escalar sigue
     // ejes del mundo. El offset (modo configuración) se aplica después
     // sobre esta pose.
     if (flat2DRef.current) {
       const gizFlat = gizmoGroupRef.current;
       if (gizFlat) gizFlat.rotation.set(0, 0, 0);
     }
     // Si hay un offset del gizmo, aplicarlo SOBRE la pose del objeto:
     // el gizmo se desplaza/gira respecto al centro del objeto sin
     // tocar la figura (modo configuración).
     const giz = gizmoGroupRef.current;
     if (giz) {
       const off = gizmoOffsetRef.current;
       const objQuat = new THREE.Quaternion().setFromEuler(
         new THREE.Euler(t.rx, t.ry, t.rz)
       );
       const offPos = new THREE.Vector3(off.px, off.py, off.pz).applyQuaternion(objQuat);
       giz.position.add(offPos);
       const offQuat = new THREE.Quaternion().setFromEuler(
         new THREE.Euler(off.rx, off.ry, off.rz)
       );
       giz.quaternion.multiply(offQuat);
      // La escala del offset tambien se aplica al gizmo (por eje), de
      // modo que en modo configuracion se puede escalar el manipulador.
      const baseScale = gizmoBaseScaleRef.current || 1;
      giz.scale.set(baseScale * off.sx, baseScale * off.sy, baseScale * off.sz);
      }
     // Multi-selección: el manipulador se centra en el CONJUNTO de los
     // objetos seleccionados (caja que los envuelve), no en el objeto
     // activo. Durante un arrastre se queda anclado al pivote del gesto.
     const gizMulti = gizmoGroupRef.current;
     if (gizMulti) {
       const selIdsMulti = selectedObjectIdsRef.current ?? [];
       if (!selectionModeRef.current && selIdsMulti.length > 1) {
         const dragMulti = gizmoDragRef.current;
         if (dragMulti && dragMulti.target === 'object' && dragMulti.multiCenter) {
           if (dragMulti.mode === 'rotate') {
             gizMulti.position.copy(dragMulti.multiCenter);
           } else {
             const startActive = multiTransformStartRef.current[
               selectedObjectIdRef.current ?? ''
             ];
             if (startActive) {
               gizMulti.position.set(
                 dragMulti.multiCenter.x + (t.px - startActive.px),
                 dragMulti.multiCenter.y + (t.py - startActive.py),
                 dragMulti.multiCenter.z + (t.pz - startActive.pz)
               );
             }
           }
         } else if (!dragMulti) {
           const centro = computeSelectionCenter();
           if (centro) gizMulti.position.copy(centro);
         }
       }
     }
    if (lightGizmoGroupRef.current) {
      lightGizmoGroupRef.current.visible = false;
    }
    // El cuerpo de la cámara-objeto activa SIEMPRE mira a su foco: el
    // gizmo cambia su posición/escala, no la dirección de la mirada.
    const cuerpoCam = meshGroupRef.current?.getObjectByName('cameraBodyRoot');
    if (cuerpoCam) {
      orientCameraBodyVisual(cuerpoCam, cameraEditorRef.current?.focus ?? null);
    }
  }, []);
   // Espejo para el bucle animate (override del editor de movimiento).
   const applyObjectTransformRef = useRef(applyObjectTransform);
   applyObjectTransformRef.current = applyObjectTransform;

     // Sincronizar el ref del offset cuando cambia la prop: el offset viaja
     // con el proyecto y debe sobrevivir a remounts de ventana. La sync
     // durante el render evita desincronizaciones con el arrastre.
      if (gizmoOffset !== undefined) {
        gizmoOffsetRef.current = gizmoOffset;
      }
     // Re-aplicar el transform cuando el offset cambia desde fuera (undo,
     // remount, carga de .zeus) — pero NO durante un arrastre activo, que
     // ya actualiza el ref y el visual por sí mismo.
     useEffect(() => {
       if (gizmoOffset && !gizmoDragRef.current) {
         applyObjectTransformRef.current(transformRef.current);
       }
     }, [gizmoOffset]);

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
    // No re-aplicar el estado que ESTE visor emitió (el eco del
    // OrbitControls): applyCamera → controls.update() → 'change' →
    // el padre emite de nuevo → bucle anidado con auto-rotar o al
    // reproducir una trayectoria de cámara.
    if (
      ultimaCamEmitidaRef.current !== null &&
      JSON.stringify(camera3D) === ultimaCamEmitidaRef.current
    ) {
      return;
    }
    const prevZoom = zoomAnteriorRef.current;
    zoomAnteriorRef.current = camera3D.zoom;
    ultimaCamEmitidaRef.current = JSON.stringify(camera3D);
    // En grabación los botones «Acercar/Alejar» del panel acercan la vista
    // EN MANO (dolly hacia el foco actual) en vez de saltar a la vista
    // guardada del panel: el recorrido la pisaría al frame siguiente y el
    // gesto no se vería. Luego se captura el fotograma del zoom.
    if (grabacionActivaRef.current && activeCameraRef.current) {
      if (prevZoom && camera3D.zoom && prevZoom !== camera3D.zoom) {
        // zoom mayor = más cerca → la distancia al foco se reduce por
        // prevZoom / zoom.
        const factor = prevZoom / camera3D.zoom;
        const dir = camera.position
          .clone()
          .sub(controls.target)
          .multiplyScalar(factor);
        camera.position.copy(controls.target).add(dir);
        controls.update();
      }
      gestoZoomGrabacion();
      return;
    }
    // Vista del panel siempre espejo del estado aplicado (el pan por
    // botones del padre no pasa por handleControlsChange).
    vistaPanelRef.current = camera3D;
    applyCamera(camera, controls, camera3D);
  }, [camera3D, gestoZoomGrabacion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    // Fondo del lienzo: el mismo azul oscuro de la interfaz
    // (paneles bg-[hsl(224_50%_7%)]). En modo 2D el canvas queda
    // TRANSPARENTE: la cuadrícula tipo lienzo la pinta el CSS del div
    // contenedor (mismo estilo que el lienzo 2D del editor).
    if (!flat2DRef.current) {
      scene.background = new THREE.Color('hsl(224, 50%, 7%)');
    }
    sceneRef.current = scene;

    // Cámara de la ventana: ORTOGRÁFICA en modo 2D (dibujo técnico, la
    // vista se fija con applyCamera a su dirección y a distancia fija) y
    // perspectiva en la '3d' libre. El cast mantiene el tipo declarado
    // (fov/aspect solo se tocan en el modo '3d', que no usa orto).
    const camera = (
      flat2D
        ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
        : new THREE.PerspectiveCamera(
            45,
            mount.clientWidth / mount.clientHeight,
            0.1,
            100
          )
    ) as THREE.PerspectiveCamera;
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
    // Modo 2D: la orientación es FIJA (vista de la ventana). Sin rotación
    // (el clic queda para la selección) y sin zoom de OrbitControls (el
    // zoom va por el estado Camera3D vía applyCamera, escalando el
    // frustum). El pan (botón central/derecho) sigue activo.
    if (flat2DRef.current) {
      controls.enableRotate = false;
      controls.enableZoom = false;
    }
    controlsRef.current = controls;

    // Sincronizar el estado de la cámara con el padre cuando el usuario
    // mueve la cámara con el ratón/scroll. Sin esto, los botones de pan
    // usan el offset inicial (0,0) en vez de la posición actual.
    const handleControlsChange = () => {
      // Durante el manejo de la cámara-objeto, los eventos residuales de
      // OrbitControls NO escriben la vista del panel (evita el eco que
      // pisa la pose de la cámara animada).
      if (camaraObjetoManejandoRef.current) return;
      const onCamChange = onCameraChangeRef.current;
      if (!onCamChange) return;
      const pos = camera.position;
      const tgt = controls.target;
      const baseDistance = 5.5;
      const dist = pos.distanceTo(tgt);
      const zoom = Math.max(0.1, Math.min(5, dist > 0 ? baseDistance / dist : 1));
      // Calcular rotaciones desde la dirección cámara→target
      const dir = pos.clone().sub(tgt).normalize();
      // Vistas cenitales (superior/inferior mirando justo al polo): el
      // recorte a ±(π/2−0.01) dejaba rotX justo fuera de la tolerancia
      // isTopView/isBottomView del visor (la vista dejaba de reconocerse) y
      // el offset vertical real va por Z del objetivo (tgt.y es siempre 0).
      // Sin esto, cada eco de OrbitControls corrompía el estado y los
      // botones ▲▼◀▶ de la ventana superior se movían por ejes equivocados.
      // El umbral es cos(0.01) para que el camino normal nunca pierda
      // precisión al recortar.
      const cenital = Math.abs(dir.y) > Math.cos(0.01);
      const rotX = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      const rotY = Math.atan2(dir.x, dir.z);
      const camState = cenital
        ? {
            zoom,
            offsetX: tgt.x,
            offsetY: tgt.z,
            rotationX: dir.y > 0 ? Math.PI / 2 : -Math.PI / 2,
            rotationY: 0,
          }
        : // Vistas laterales (costado izq./der.): el eje horizontal real va
          // por Z del objetivo (tgt.x es siempre 0); sin esto cada eco
          // perdía el desplazamiento de ◀▶ en las ventanas laterales.
          Math.abs(dir.x) > Math.cos(0.01)
        ? {
            zoom,
            offsetX: tgt.z,
            offsetY: tgt.y,
            rotationX: rotX,
            rotationY: dir.x > 0 ? Math.PI / 2 : -Math.PI / 2,
          }
        : {
            zoom,
            offsetX: tgt.x,
            offsetY: tgt.y,
            rotationX: Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotX)),
            rotationY: rotY,
          };
      // Solo emitir al padre si el estado CAMBIÓ de verdad: con
      // auto-rotar 'change' vuela por cada frame, y re-emitir el mismo
      // estado solo provocaría renders y ecos inútiles.
      const firma = JSON.stringify(camState);
      if (firma === ultimaCamEmitidaRef.current) return;
      ultimaCamEmitidaRef.current = firma;
      vistaPanelRef.current = camState;
      onCamChange(camState);
    };
    controls.addEventListener('change', handleControlsChange);

    // Rueda en modo 2D: el zoom va por el ESTADO (Camera3D.zoom → frustum
    // de applyCamera), no por dolly de OrbitControls (que está fuera en
    // orto). Se re-aplica la cámara: los ecos derivan el mismo zoom vía
    // baseDistance/dist y la única fuente de verdad sigue siendo el padre.
    const handleWheelPlano = (e: WheelEvent) => {
      if (!flat2DRef.current) return;
      e.preventDefault();
      const vista = vistaPanelRef.current ?? camera3D ?? IDENTITY_CAMERA3D;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const zoomNuevo = Math.max(
        0.1,
        Math.min(5, vista.zoom * factor)
      );
      applyCamera(camera, controls, { ...vista, zoom: zoomNuevo });
    };
    renderer.domElement.addEventListener('wheel', handleWheelPlano, {
      passive: false,
    });

    // --- Gizmo de ejes (esquina inferior izquierda) ---
    // Escena aparte con tres flechas X/Y/Z y sus letras. Se dibuja encima
    // del lienzo principal en un viewport reducido y se orienta cada frame
    // con la cámara para indicar siempre hacia dónde apunta cada eje.
    {
      const axisGizmo = buildAxisGizmo();
      axisGizmoSceneRef.current = axisGizmo.scene;
      axisGizmoGroupRef.current = axisGizmo.group;
      axisGizmoCameraRef.current = axisGizmo.camera;
    }

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

    // Entorno «sala» para las texturas CREADAS: igual que el de la vista
    // previa (RoomEnvironment → PMREM). Su material lo asigna como envMap
    // propio para que cristal/metal reflejen un entorno brillante aunque
    // el escenario del editor sea oscuro.
    try {
      const pmremCreada = new THREE.PMREMGenerator(renderer);
      envCreadaRef.current = pmremCreada.fromScene(new RoomEnvironment(), 0.04).texture;
      pmremCreada.dispose();
    } catch (e) {
      console.error('No se pudo crear el entorno de texturas creadas:', e);
      envCreadaRef.current = null;
    }

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

          // Skip visual helpers when helperVisible is false: the light keeps
          // illuminating but its handles/cone are hidden from the viewport.
          if (sp.helperVisible === false) return;

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
            // Casi invisible: solo insinúa el charco de luz, sin dibujar un
            // círculo grande encima del objeto iluminado (solicitud del
            // usuario). El pool de luz real ya lo pinta la propia iluminación.
            transparent: true,
            opacity: 0.04,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const base = new THREE.Mesh(baseGeo, baseMat);
          base.rotation.x = Math.PI;
          base.position.set(0, 0, -coneHeight);
          base.userData = { spotlightIdx: idx, lightType: 'spotlight', handleType: 'cone-base' };
          lightHelpers.add(base);

          // Position handle: marker at the spotlight position for dragging.
          // Es un punto MUY pequeño y translúcido: al posar el foco sobre un
          // objeto no tapa la figura con un círculo amarillo grande. El agarre
          // sigue siendo cómodo porque debajo queda una esfera invisible más
          // amplia (opacity 0, depthWrite false) que solo existe para el raycast.
          const grabGeo = new THREE.SphereGeometry(0.2, 8, 8);
          const grabMat = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
          });
          const posHandle = new THREE.Mesh(grabGeo, grabMat);
          posHandle.name = `spotlight-pos-${idx}`;
          posHandle.position.set(
            sp.position.x,
            sp.position.y,
            sp.position.z
          );
          const posDot = new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 12, 12),
            new THREE.MeshBasicMaterial({
              color: 0xffff00,
              transparent: true,
              opacity: 0.35,
              depthTest: false,
              depthWrite: false,
            })
          );
          posDot.name = `spotlight-pos-dot-${idx}`;
          // El punto NO se ve por defecto (solicitud del usuario: en la escena
          // no debe marcarse el objeto con un círculo amarillo). Solo aparece
          // al pasar el ratón sobre el foco o mientras se arrastra (ver el
          // bucle, sección de hover de ayudantes de luz).
          posDot.visible = false;
          posDot.renderOrder = 998;
          posHandle.add(posDot);
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

          // Forward direction circle: a small ring around the yellow marker,
          // oriented in the plane perpendicular to the spotlight's forward
          // direction (position → target). Shows where the light projects.
          // Pequeño y translúcido para no tapar la figura donde se posa.
          const fwdGeo = new THREE.TorusGeometry(0.14, 0.015, 6, 32);
          const fwdMat = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.4,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const fwdCircle = new THREE.Mesh(fwdGeo, fwdMat);
          fwdCircle.name = `spotlight-forward-${idx}`;
          fwdCircle.position.copy(posHandle.position);
          const fwdTgt = resolveSpotTarget(sp, objectsRef.current);
          const lightDir = new THREE.Vector3(
            fwdTgt.x - sp.position.x,
            fwdTgt.y - sp.position.y,
            fwdTgt.z - sp.position.z
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

    // Cuadros de las ventanas 2D: MISMA rejilla que la del suelo (celda
    // de 0.25 y mismos colores) pero más grande (8 unidades) y colocada
    // en el plano de la vista, para que los cuadros escalen con el zoom
    // (son geometría, no píxeles). La orientación/posición/visibilidad
    // las pone el effect de visibilidad de la rejilla; el raycast va
    // anulado para no chocar con las selecciones.
    if (flat2DRef.current) {
      const flatGrid = new THREE.GridHelper(8, 32, 0x8fb0cc, 0x44506a);
      (flatGrid.material as THREE.LineBasicMaterial).opacity = 0.3;
      (flatGrid.material as THREE.LineBasicMaterial).transparent = true;
      flatGrid.raycast = () => {};
      // «lado» del cuadrado cubierto: el effect de visibilidad lo crece
      // reconstruyendo cuando el zoom descubre más allá.
      flatGrid.userData = { lado: 8 };
      scene.add(flatGrid);
      flatGridRef.current = flatGrid;

      // Línea de BASE (franja horizontal al nivel de la rejilla del
      // suelo): se orienta/posiciona en el effect junto a los cuadros.
      const flatBase = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.015, 0.015),
        new THREE.MeshBasicMaterial({
          color: 0x8fb0cc,
          transparent: true,
          opacity: 0.55,
        })
      );
      flatBase.raycast = () => {};
      scene.add(flatBase);
      flatBaseRef.current = flatBase;
    }

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

      // Recorrido de la cámara-objeto: tubo Catmull-Rom + asas esfera.
      // Las asas se crean y destruyen por fotograma en el reconstructor.
      const camObjectPathGroup = new THREE.Group();
      camObjectPathGroup.name = 'cameraObjectPath';
      camObjectPathGroup.visible = false;
      scene.add(camObjectPathGroup);
      const camObjectTube = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(
            [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.001, 0)],
            false,
            'chordal'
          ),
          1,
          0.012,
          6,
          false
        ),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85 })
      );
      camObjectPathGroup.add(camObjectTube);
      const camObjectHandles = new THREE.Group();
      camObjectPathGroup.add(camObjectHandles);
      cameraObjectPathRef.current = {
        group: camObjectPathGroup,
        tube: camObjectTube,
        handles: camObjectHandles,
      };

      // Recorrido del objeto seleccionado (editor de movimiento): igual
      // mecánica que el de la cámara pero en violeta, para distinguirlos.
      const objMotionPathGroup = new THREE.Group();
      objMotionPathGroup.name = 'objectMotionPath';
      objMotionPathGroup.visible = false;
      scene.add(objMotionPathGroup);
      const objMotionTube = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(
            [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.001, 0)],
            false,
            'chordal'
          ),
          1,
          0.012,
          6,
          false
        ),
        new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.85 })
      );
      objMotionPathGroup.add(objMotionTube);
      const objMotionHandles = new THREE.Group();
      objMotionPathGroup.add(objMotionHandles);
      objectMotionPathRef.current = {
        group: objMotionPathGroup,
        tube: objMotionTube,
        handles: objMotionHandles,
      };

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

    // Face selection overlay group (children of meshGroup so it follows the mesh transform)
    const faceSelectOverlayGroup = new THREE.Group();
    meshGroup.add(faceSelectOverlayGroup);
    faceSelectionOverlayRef.current = faceSelectOverlayGroup;

    // Guía persistente del modo selección (también hija de meshGroup).
    const faceGuideGroup = new THREE.Group();
    meshGroup.add(faceGuideGroup);
    faceGuideRef.current = faceGuideGroup;

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    planeRef.current = plane;

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

    // Gizmo de la sub-selección (caras/aristas/vértices): se ancla en vivo
    // al centroide de la selección dentro del bucle de animación.
    const selectionGizmoGroup = new THREE.Group();
    selectionGizmoGroup.visible = false;
    scene.add(selectionGizmoGroup);
    selectionGizmoGroupRef.current = selectionGizmoGroup;
    selectionGizmoHandlesRef.current =
      buildSelectionGizmoHandles(selectionGizmoGroup);

    // Resaltado del elemento apuntado (hover): vive junto a los overlays
    // de selección, en el espacio LOCAL de la malla.
    const faceHoverOverlay = new THREE.Group();
    faceHoverOverlay.visible = false;
    faceHoverOverlay.renderOrder = 996;
    faceHoverOverlayRef.current = faceHoverOverlay;

    // Primera intersección del rayo actual con la superficie de CUALQUIER
    // objeto de la escena (recorriendo el grupo entero). Devuelve también
    // el id del objeto golpeado (subiendo por los padres hasta el
    // duplicado/meshGroup que lleva sceneObjectId). Los shells del halo y
    // los helpers de FX quedan fuera del raycast.
    const raycastObjectSurface = (): {
      hit: THREE.Intersection;
      objectId: string | null;
    } | null => {
      const group = meshGroupRef.current;
      if (!group) return null;
      group.updateMatrixWorld(true);
      const targets: THREE.Object3D[] = [];
      group.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        if ((o as THREE.Mesh).userData?.isGlowShell) return;
        targets.push(o);
      });
      if (targets.length === 0) return null;
      const hits = raycasterRef.current.intersectObjects(targets, false);
      if (hits.length === 0) return null;
      // Dueño del punto golpeado: sube hasta el nodo que lleva el id.
      let dueño: string | null = null;
      let node: THREE.Object3D | null = hits[0].object;
      while (node) {
        const oid = node.userData?.sceneObjectId as string | undefined;
        if (oid) {
          dueño = oid;
          break;
        }
        node = node.parent;
      }
      return { hit: hits[0], objectId: dueño };
    };
    // Colocación de focos: helpers de runtime (focos por objeto).

    // Reconstruye el recorrido de la cámara-objeto: curva sobre las
    // posiciones de los fotogramas + UN asa esfera por fotograma (cian;
    // la del fotograma seleccionado, más clara y grande) + asa naranja
    // en el foco del fotograma seleccionado. userData.cameraKeyframe /
    // cameraTarget guían el raycast de arrastre.
    rebuildCameraObjectPathRef.current = (cam) => {
      const entry = cameraObjectPathRef.current;
      if (!entry) return;
      const { group, tube, handles } = entry;
      for (const h of [...handles.children]) {
        handles.remove(h);
        h.traverse((item) => {
          const m = item as THREE.Mesh;
          m.geometry?.dispose();
          if (m.material) disposeMaterial(m.material);
        });
      }
      const ordenados = [...cam.keyframes].sort((a, b) => a.time - b.time);
      if (!cam.visible || ordenados.length === 0) {
        group.visible = false;
        return;
      }
      const puntos = ordenados.map(
        (k) => new THREE.Vector3(k.position.x, k.position.y, k.position.z)
      );
      const curva =
        puntos.length === 1
          ? new THREE.CatmullRomCurve3([puntos[0], puntos[0].clone().add(new THREE.Vector3(0, 0.001, 0))], false, 'chordal')
          : new THREE.CatmullRomCurve3(puntos, false, 'chordal');
      tube.geometry.dispose();
      tube.geometry = new THREE.TubeGeometry(
        curva,
        Math.max(puntos.length * 12, 24),
        0.012,
        6,
        false
      );

      const asaGeo = new THREE.SphereGeometry(0.035, 10, 8);
      const negro = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const amarilloSel = new THREE.MeshBasicMaterial({ color: 0xfde047 });
      for (const k of ordenados) {
        const idxOriginal = cam.keyframes.indexOf(k);
        const seleccionado = idxOriginal === cam.selected;
        const asa = new THREE.Mesh(asaGeo, seleccionado ? amarilloSel : negro);
        asa.position.copy(
          new THREE.Vector3(k.position.x, k.position.y, k.position.z)
        );
        if (seleccionado) asa.scale.setScalar(1.6);
        asa.userData.cameraKeyframe = idxOriginal;
        handles.add(asa);
      }
      // Asa del foco del fotograma seleccionado (naranja)
      if (cam.selected !== null && cam.focus) {
        const focoMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const focoAsa = new THREE.Mesh(asaGeo, focoMat);
        focoAsa.position.set(cam.focus.x, cam.focus.y, cam.focus.z);
        focoAsa.userData.cameraTarget = true;
        handles.add(focoAsa);
      }
      group.visible = !activeCameraRef.current;
    };

    // Recorrido del objeto seleccionado: reconstruye tubo + asas a partir
    // de los fotogramas de la pista de transformada (posiciones absolutas,
    // ya resueltas por el padre sobre el transform estático).
    rebuildObjectMotionPathRef.current = (path) => {
      const entry = objectMotionPathRef.current;
      if (!entry) return;
      const { group, tube, handles } = entry;
      for (const h of [...handles.children]) {
        handles.remove(h);
        h.traverse((item) => {
          const m = item as THREE.Mesh;
          m.geometry?.dispose();
          if (m.material) disposeMaterial(m.material);
        });
      }
      if (!path || !path.visible || path.keyframes.length === 0) {
        group.visible = false;
        return;
      }
      const puntos = path.keyframes.map(
        (k) => new THREE.Vector3(k.position.x, k.position.y, k.position.z)
      );
      const curva =
        puntos.length === 1
          ? new THREE.CatmullRomCurve3([puntos[0], puntos[0].clone().add(new THREE.Vector3(0, 0.001, 0))], false, 'chordal')
          : new THREE.CatmullRomCurve3(puntos, false, 'chordal');
      tube.geometry.dispose();
      tube.geometry = new THREE.TubeGeometry(
        curva,
        Math.max(puntos.length * 12, 24),
        0.012,
        6,
        false
      );
      const asaGeo = new THREE.SphereGeometry(0.035, 10, 8);
      const negro = new THREE.MeshBasicMaterial({ color: 0x111111 });
      for (let i = 0; i < path.keyframes.length; i++) {
        const k = path.keyframes[i];
        const asa = new THREE.Mesh(asaGeo, negro);
        asa.position.set(k.position.x, k.position.y, k.position.z);
        asa.userData.motionKeyframe = i;
        handles.add(asa);
      }
      group.visible = !activeCameraRef.current;
    };

    // --- Editor de movimiento: override visual por fotograma ------------
    // Las pistas de transformada y de parámetros de plugin NO tocan el
    // estado de la escena: el visor aplica los valores evaluados sobre
    // sus grupos THREE cada frame y, al parar, restaura todo.
    const motionParamsCache = new Map<string, Record<string, number>>();
    // Geometría original del seleccionado (transplante de plugin) y la
    // geometría animada en curso (para disponerla al reemplazarla).
     const motionOrigGeometry: { mesh: THREE.Mesh | null; geo: THREE.BufferGeometry | null } = {
      mesh: null,
      geo: null,
    };
    const motionAnimatedGeo: { geo: THREE.BufferGeometry | null } = { geo: null };
    // Opacidad original de los materiales del objeto seleccionado (para
    // restaurar al parar la animación). Se guarda Material → opacity.
    const motionOrigOpacity = new Map<THREE.Material, number>();
    // Hijos originales de los duplicados con visual plugin (por objectId).
    const motionOrigChildren = new Map<string, THREE.Object3D[]>();
    const motionWarnedMissingBase = new Set<string>();
    let motionPrev = false;

     const restoreMotionVisuals = () => {
       // Transformada estática de vuelta (el arrastre del gizmo manda: si
       // hay gesto en curso no se toca, el soltar ya la aplica).
       if (!gizmoDragRef.current) {
         applyObjectTransformRef.current(transformRef.current);
       }
       // Opacidad animada de vuelta a la original.
       const meshGroup = meshGroupRef.current;
       if (meshGroup) {
         meshGroup.traverse((item) => {
           const m = item as THREE.Mesh;
           if (!m.isMesh || !m.material) return;
           const materials = Array.isArray(m.material) ? m.material : [m.material];
           for (const mat of materials) {
             const orig = motionOrigOpacity.get(mat);
             if (orig !== undefined) {
               mat.opacity = orig;
               mat.transparent = orig < 1;
               mat.needsUpdate = true;
             }
           }
         });
       }
       motionOrigOpacity.clear();
       // Geometría transplantada del seleccionado: devolver la original.
      if (motionOrigGeometry.mesh && motionOrigGeometry.geo) {
        if (motionAnimatedGeo.geo) motionAnimatedGeo.geo.dispose();
        motionAnimatedGeo.geo = null;
        motionOrigGeometry.mesh.geometry = motionOrigGeometry.geo;
      }
      motionOrigGeometry.mesh = null;
      motionOrigGeometry.geo = null;
       // Duplicados con visuales plugin: reponer los hijos originales.
       if (meshGroup) {
        for (const [oid, originales] of motionOrigChildren) {
          const dup = meshGroup.children.find(
            (c) => c.userData.sceneObjectDuplicate && c.userData.sceneObjectId === oid
          );
          if (!dup) continue;
          for (const hijo of [...dup.children]) {
            dup.remove(hijo);
            hijo.traverse?.((item) => {
              const m = item as THREE.Mesh;
              m.geometry?.dispose?.();
              if (m.material) disposeMaterial(m.material as THREE.Material);
            });
          }
          for (const hijo of originales) dup.add(hijo);
        }
      }
       motionOrigChildren.clear();
       motionParamsCache.clear();
       motionWarnedMissingBase.clear();
       // Restore effect systems to the objects' static state (effect
       // tracks may have activated effects independently of the objects).
       fxApiRef.current.sincronizar();
     };


    const applyMotionOverride = (time: number) => {
      const meshGroup = meshGroupRef.current;
      if (!meshGroup) return;

      // 1) Transformada del objeto seleccionado (el arrastre del gizmo
      // manda: durante un gesto el override NO toca este objeto).
      const selId = selectedObjectIdRef.current;
      const drag = gizmoDragRef.current;
      const dragObjeto = !!drag && drag.target !== 'texture';
      const selTrack = selId
        ? transformTracksRef.current?.find((tr) => tr.objectId === selId)
        : undefined;
      const evaluadoSel = selTrack && !dragObjeto
        ? evaluateTransformTrack(selTrack, time)
        : null;
      // Miembro secundario de un grupo (sin pista propia): sigue la pista
      // de grupo a la que pertenece. La pista guarda la pose del objeto
      // principal, así que se compone la misma DELTA rígida que aplican
      // los duplicados y se descompone para dar la nueva transformada.
      const selGroupTrack = selId && !selTrack
        ? transformTracksRef.current?.find((tr) => tr.objectIds?.includes(selId))
        : undefined;
      const selEvaluadoGrupo =
        !evaluadoSel && selGroupTrack && !dragObjeto
          ? evaluateTransformTrack(selGroupTrack, time)
          : null;
      let selMerged: ObjectTransform = evaluadoSel
        ? ({ ...transformRef.current, ...evaluadoSel } as ObjectTransform)
        : { ...transformRef.current };
      if (selEvaluadoGrupo) {
        const principal = objectsRef.current?.find(
          (o) => o.id === (selGroupTrack as TransformTrack).objectId
        );
        if (principal) {
          const delta = componerMatrizTransforma({
            ...principal.transform,
            ...selEvaluadoGrupo,
          }).multiply(
            componerMatrizTransforma(principal.transform).invert()
          );
          const matriz = delta.multiply(componerMatrizTransforma(transformRef.current));
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3();
          matriz.decompose(pos, quat, scl);
          const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
          selMerged = {
            ...transformRef.current,
            px: pos.x, py: pos.y, pz: pos.z,
            rx: euler.x, ry: euler.y, rz: euler.z,
            sx: scl.x, sy: scl.y, sz: scl.z,
          };
        }
      }
       if (evaluadoSel || selEvaluadoGrupo) {
         applyObjectTransformRef.current(selMerged);
       }

       // 1b) Opacidad animada del objeto seleccionado: si el fotograma
       // incluye 'o', aplica esa opacidad a los materiales del SELECCIONADO.
       // La malla del objeto activo vive en el meshGroup PROPIO (sin la
       // etiqueta de duplicado; su duplicado se retira al convertirlo en
       // el activo, viewer-3d ~8036), mientras que los demás objetos cuelgan
       // como duplicados de userData.sceneObjectDuplicate. Antes se
       // recorría TODO el meshGroup y la opacidad bajaba a TODA la escena.
       if (evaluadoSel?.o !== undefined && selId) {
         const targetOpacity = Math.max(0, Math.min(1, evaluadoSel.o));
         const aplicar = (nodo: THREE.Object3D) => {
           nodo.traverse((item) => {
             const m = item as THREE.Mesh;
             if (!m.isMesh || !m.material) return;
             const materials = Array.isArray(m.material) ? m.material : [m.material];
             for (const mat of materials) {
               if (!motionOrigOpacity.has(mat)) {
                 motionOrigOpacity.set(mat, mat.opacity);
               }
               mat.opacity = targetOpacity;
               mat.transparent = targetOpacity < 1;
               mat.needsUpdate = true;
             }
           });
         };
         for (const child of meshGroup.children) {
           if (child.userData.sceneObjectDuplicate) continue;
           aplicar(child);
         }
       }

      // 1c) La sombra sigue la opacidad (plana o animada): el pase de
      // profundidad NO lee el `opacity` del material de pintura (three
      // solo le pasa alphaMap/alphaTest), así que el uniforme va al
      // día por fotograma.
      for (const hijo of meshGroup.children) {
        hijo.traverse((item) => {
          const m = item as THREE.Mesh;
          if (!m.isMesh) return;
          const ya = (m.customDepthMaterial?.userData?.sombraLuces ??
            undefined) as { opac: { value: number } } | undefined;
          if (!ya) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          ya.opac.value = Math.max(0, Math.min(1, mats[0]?.opacity ?? 1));
        });
      }

      // 2) Duplicados con pista de transformada: su matriz es relativa al
      // seleccionado (animado), igual que en el efecto de duplicados.
      if (transformTracksRef.current?.length) {
        const inverseSel = new THREE.Matrix4()
          .compose(
            new THREE.Vector3(selMerged.px, selMerged.py, selMerged.pz),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(selMerged.rx, selMerged.ry, selMerged.rz)
            ),
            new THREE.Vector3(selMerged.sx, selMerged.sy, selMerged.sz)
          )
          .invert();
        // Deltas rígidos de las pistas de GRUPO: una pista de grupo guarda
        // la pose absoluta del objeto principal, NO la de cada miembro.
        // Volcar esos valores sobre cada miembro aplanaba el grupo entero
        // a la pose del principal (el grupo «se deformaba» al crear
        // fotogramas). En su lugar se deriva una delta rígida por pista:
        // Delta = pose animada del principal ∘ pose estática del principal⁻¹,
        // y cada miembro la aplica sobre SU propia pose estática, así el
        // grupo entero se mueve como un cuerpo rígido conservando offsets.
        const deltasGrupo = new Map<string, THREE.Matrix4>();
        for (const tr of transformTracksRef.current) {
          if (!tr.objectIds || tr.objectIds.length === 0) continue;
          const evaluado = evaluateTransformTrack(tr, time);
          const principal = objectsRef.current?.find((o) => o.id === tr.objectId);
          if (!evaluado || !principal) continue;
          deltasGrupo.set(
            tr.id,
            componerMatrizTransforma({ ...principal.transform, ...evaluado })
              .multiply(componerMatrizTransforma(principal.transform).invert())
          );
        }
         for (const child of meshGroup.children) {
           if (!child.userData.sceneObjectDuplicate) continue;
           const oid = child.userData.sceneObjectId as string;
           let tr = transformTracksRef.current?.find(
             (tk) => tk.objectId === oid
           );
           let esGrupo = false;
           if (!tr) {
             // Miembro de un grupo: usa la pista de grupo si existe.
             tr = transformTracksRef.current?.find(
               (tk) => tk.objectIds && tk.objectIds.includes(oid)
             );
             esGrupo = true;
           }
           if (!tr) continue;
          const obj = objectsRef.current?.find((o) => o.id === oid);
          if (!obj) continue;
          const objectMatrix = componerMatrizTransforma(obj.transform);
          if (esGrupo) {
            const delta = deltasGrupo.get(tr.id);
            if (!delta) continue;
            child.matrix
              .copy(inverseSel)
              .multiply(delta)
              .multiply(objectMatrix);
          } else {
            const evaluadoDup = evaluateTransformTrack(tr, time);
            if (!evaluadoDup) continue;
            const merged = { ...obj.transform, ...evaluadoDup } as ObjectTransform;
            child.matrix
              .copy(inverseSel)
              .multiply(componerMatrizTransforma(merged));
          }
          child.matrixAutoUpdate = false;
        }
      }

      // 3) Parámetros de plugin agrupados por objeto (un plugin por objeto).
      const pTracks = pluginTracksRef.current;
      if (pTracks && pTracks.length > 0) {
        const porObjeto = new Map<string, PluginParamTrack[]>();
        for (const tr of pTracks) {
          const lista = porObjeto.get(tr.objectId) ?? [];
          lista.push(tr);
          porObjeto.set(tr.objectId, lista);
        }
        for (const [oid, tracks] of porObjeto) {
          const pluginIds = [...new Set(tracks.map((t) => t.pluginId))];
          if (pluginIds.length !== 1) continue;
          const def = obtenerPlugin(pluginIds[0]);
          if (!def) continue;
          const base = pluginBaseMeshesRef.current?.[oid] as Mesh | undefined;
          if (!base) {
            if (!motionWarnedMissingBase.has(oid)) {
              console.warn('[motion] Sin malla base congelada para', oid);
              motionWarnedMissingBase.add(oid);
            }
            continue;
          }
          // Parámetros completos: defaults del plugin + valores evaluados.
          const params: PluginParams = {};
          for (const p of def.params) params[p.id] = p.valor;
          let cambio = false;
          for (const tr of tracks) {
            const v = evaluatePluginParamTrack(tr, time);
            if (v === null) continue;
            const pDef = def.params.find((p) => p.id === tr.paramId);
            const tol =
              pDef && pDef.tipo === 'slider' && typeof pDef.valor === 'number'
                ? (pDef.paso ?? Math.abs(pDef.max - pDef.min) / 200)
                : 1e-4;
            const anterior = motionParamsCache.get(oid)?.[tr.paramId];
            if (anterior === undefined || Math.abs(anterior - v) > tol) cambio = true;
            params[tr.paramId] = v;
          }
          if (!cambio) continue;
          try {
            const resultado = def.aplicar(base as Mesh, params);
            if (!resultado || !resultado.vertices.length || !resultado.faces.length) continue;
            const obj = objectsRef.current?.find((o) => o.id === oid);
            const visual = buildSnapshotObjectVisual(
              resultado,
              obj?.smooth ?? false,
              obj?.textureProjection ?? 'planar',
              undefined,
              resultado.textureRepeat ?? 1,
              resultado.textureRepeatY,
              envCreadaRef.current
            );
            if (visual.children.length === 0) continue;
            if (oid === selId) {
              // Transplante de geometría a la malla principal.
              const main = findMainMesh(meshGroup);
              const nuevaGeo = findMainMesh(visual)?.geometry;
              if (main && nuevaGeo) {
                if (motionOrigGeometry.mesh && motionOrigGeometry.mesh !== main) {
                  // La selección cambió durante la reproducción: devolver
                  // la geometría original a la malla anterior y empezar
                  // de cero con la nueva.
                  motionOrigGeometry.mesh.geometry = motionOrigGeometry.geo!;
                  motionAnimatedGeo.geo = null;
                  motionOrigGeometry.mesh = null;
                  motionOrigGeometry.geo = null;
                }
                if (!motionOrigGeometry.mesh) {
                  motionOrigGeometry.mesh = main;
                  motionOrigGeometry.geo = main.geometry;
                }
                if (motionAnimatedGeo.geo) motionAnimatedGeo.geo.dispose();
                motionAnimatedGeo.geo = nuevaGeo;
                main.geometry = nuevaGeo;
              }
              // La geometría del visual se queda en la malla principal:
              // solo se disponen sus materiales (prestados y temporales).
              visual.traverse((item) => {
                const m = item as THREE.Mesh;
                if (m.material) disposeMaterial(m.material as THREE.Material);
              });
            } else {
              // Duplicado: sustituir sus hijos por el visual nuevo.
              const dup = meshGroup.children.find(
                (c) =>
                  c.userData.sceneObjectDuplicate &&
                  c.userData.sceneObjectId === oid
              );
              if (!dup) continue;
              if (!motionOrigChildren.has(oid)) {
                // Primera vez: los hijos actuales SON los originales.
                motionOrigChildren.set(oid, [...dup.children]);
              }
              for (const hijo of [...dup.children]) {
                dup.remove(hijo);
                if (motionOrigChildren.has(oid)) {
                  hijo.traverse?.((item) => {
                    const m = item as THREE.Mesh;
                    m.geometry?.dispose?.();
                    if (m.material) disposeMaterial(m.material as THREE.Material);
                  });
                }
              }
              dup.add(visual);
            }
          } catch (err) {
            console.error('[motion] Error al aplicar plugin animado:', err);
          }
        }
      }

      // 4) Efectos visuales: overrides de efectos (lluvia, humo, estrellas)
      // por objeto: cada pista apunta a SU objeto (objectId); las pistas
      // viejas sin objectId van al objeto activo.
      const efTracks = effectTracksRef.current;
      if (efTracks && efTracks.length > 0) {
        const activoId = meshGroup.userData.sceneObjectId as string | undefined;
        for (const tr of efTracks) {
          const evaluated = evaluateEffectTrack(tr, time);
          if (!evaluated) continue;
          const objetivos = tr.objectId
            ? [tr.objectId]
            : tr.objectIds && tr.objectIds.length > 0
              ? tr.objectIds
              : activoId
                ? [activoId]
                : [];
          for (const oid of objetivos) {
            const rt = fxApiRef.current.runtimeDe(oid, true);
            if (rt) aplicarOverrideEfectoObjeto(rt, tr.effectType, evaluated);
          }
        }
      }
    };

    const clock = new THREE.Clock();
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      const dt = Math.min(clock.getDelta(), 0.05);

      const exportState = exportStateRef.current;
      // Cámara-objeto: la cámara elegida en ESTA ventana maneja el visor
      // con SU pose (estática con 1 fotograma, recorrido con ≥2); durante
      // la exportación manda la cámara de exportación. OrbitControls queda
      // deshabilitado y sus eventos no llegan a los paneles; al salir se
      // restaura la vista del panel.
      const camVentana = activeCameraRef.current;
      const camExport = exportState ? exportCameraRef.current ?? camVentana : null;
      const camObjeto = exportState ? camExport : camVentana;
      const manejaCamara =
        !!camObjeto &&
        camObjeto.keyframes.length >= (exportState ? 2 : 1);
      // Modo grabación: la vista grabadora SÍ sigue a la cámara en vivo
      // (evaluación de keyframes como en el manejo) — mover la cámara es
      // ver el mundo moverse, «la cámara en la mano». La evaluación se
      // pausa solo durante un arrastre de la vista: OrbitControls orbita
      // en mano alrededor del foco y al soltar se captura el fotograma.
      const grabaVista =
        !exportState && !!grabacionActivaRef.current && !!camVentana;
      // Durante la exportación o la vista de cámara no deben salir ayudas
      // de edición: el gizmo del objeto (con sus aros de giro y su bola de
      // estirar), los focos (cono, aros y bola de dirección), el recorrido de
      // la cámara con sus asas y su bola de foco, el gizmo del foco de luz,
      // las esferas de vértice, el resaltado de caras y los marcadores de FX.
      // Lo que se ve por la cámara es justo lo que se captura.
      const exportActivo = !!exportState;
      const ayudasOcultas =
        exportActivo || grabaVista || (manejaCamara && !!camObjeto);
      if (ayudasOcultas) {
        if (gizmoGroupRef.current) gizmoGroupRef.current.visible = false;
        if (cameraObjectPathRef.current)
          cameraObjectPathRef.current.group.visible = false;
        if (objectMotionPathRef.current)
          objectMotionPathRef.current.group.visible = false;
        if (lightGizmoGroupRef.current) lightGizmoGroupRef.current.visible = false;
        // Los ayudantes de luz (cono, bola amarilla, aros) también son
        // ayudas de edición: fuera del vídeo. Al terminar se restaura
        // su visibilidad desde la casilla showLightHelpers.
        if (lightHelpersGroupRef.current)
          lightHelpersGroupRef.current.visible = false;
        if (vertexHelpersRef.current) vertexHelpersRef.current.visible = false;
        // El resaltado de caras/vértices/segmentos también es ayuda de
        // edición: fuera del vídeo.
        if (faceSelectionOverlayRef.current)
          faceSelectionOverlayRef.current.visible = false;
        if (faceGuideRef.current) faceGuideRef.current.visible = false;
        // Gizmo de sub-selección y resaltado de hover: fuera del vídeo.
        if (selectionGizmoGroupRef.current)
          selectionGizmoGroupRef.current.visible = false;
        if (faceHoverOverlayRef.current)
          faceHoverOverlayRef.current.visible = false;
      } else if (exportPrevioRef.current) {
        if (gizmoGroupRef.current) {
          const esCamara =
            (objectsRef.current ?? []).find(
              (o) => o.id === selectedObjectIdRef.current
            )?.kind === 'camera';
          gizmoGroupRef.current.visible =
            gizmoOnRef.current &&
            ((meshRef.current?.vertices?.length ?? 0) > 0 || esCamara);
        }
        if (cameraObjectPathRef.current)
          cameraObjectPathRef.current.group.visible = !activeCameraRef.current;
        if (objectMotionPathRef.current)
          objectMotionPathRef.current.group.visible =
            !!showMotionPathRef.current;
        if (lightGizmoGroupRef.current)
          lightGizmoGroupRef.current.visible = !!lightConfigRef.current?.spotlights.find(
            (s) => s.enabled
          );
        if (lightHelpersGroupRef.current)
          lightHelpersGroupRef.current.visible = showLightHelpersRef.current;
        if (vertexHelpersRef.current) vertexHelpersRef.current.visible = true;
        if (faceSelectionOverlayRef.current)
          faceSelectionOverlayRef.current.visible = true;
        if (faceGuideRef.current) faceGuideRef.current.visible = true;
      }
      exportPrevioRef.current = ayudasOcultas;
      // El tiempo efectivo SIEMPRE viene del reloj de la animación
      // (scrubbing): el reloj-de-pared rompía el scrubbing con pistas de
      // cámara. Durante la exportación, el reloj real acota la duración.
      const effectiveTime = exportState
        ? Math.min((performance.now() - exportState.startTime) / 1000, exportState.duration)
        : animationTimeRef.current;
      // Editor de movimiento: aplicar el override visual (transformadas y
      // parámetros de plugin) cada frame cuando hay pistas de movimiento.
      // Esto incluye reproducción, scrubbing y pausa en cualquier momento:
      // el visor muestra el estado a currentTime en todo momento.
      const hasMotionTracks =
        (transformTracksRef.current?.length ?? 0) +
        (pluginTracksRef.current?.length ?? 0) +
        (effectTracksRef.current?.length ?? 0) > 0;
      const motionActivo = hasMotionTracks;
      if (motionActivo !== motionPrev) {
        motionPrev = motionActivo;
        if (!motionActivo) restoreMotionVisuals();
      }
      if (motionActivo) applyMotionOverride(effectiveTime);
      if (grabaVista && camVentana) {
        const kfs = camVentana.keyframes;
        // La maquinaria de restauración al salir sigue funcionando igual
        // cuando la cámara tiene recorrido que maneje la vista.
        camaraObjetoManejandoRef.current = kfs.length >= 1;
        // El gesto de vista debe enganchar al pulsar: con el manejador
        // activo desde el primer frame el arrastre de grabación funciona.
        controls.enabled = true;
        if (kfs.length >= 1) {
          // Sin arrastre ni gesto de zoom en curso, la vista viaja con la
          // cámara evaluada (el zoom en grabación pausa la evaluación
          // hasta capturar el fotograma del acercamiento).
          if (
            !recDownRef.current &&
            performance.now() - recZoomRef.current > 600
          ) {
            const pose = evaluateCameraKeyframes(
              kfs,
              effectiveTime * 1000,
              camVentana.fov
            );
            if (pose) {
              camera.position.set(
                pose.position.x,
                pose.position.y,
                pose.position.z
              );
              camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
              if (Math.abs(camera.fov - pose.fov) > 0.01) {
                camera.fov = pose.fov;
                camera.updateProjectionMatrix();
              }
              // El pivote de órbita sigue al foco evaluado: arrastrar la
              // vista orbita alrededor del foco, como llevar la cámara
              // en la mano mirando al objeto.
              controls.target.set(
                pose.target.x,
                pose.target.y,
                pose.target.z
              );
            }
          }
          // Con recorrido, el ojo sigue dentro del cuerpo: se oculta igual
          // que en la rama de manejo (acumulado para restaurarlo al salir).
          const cuerpo = meshGroupRef.current?.children.find(
            (c) =>
              c.userData.sceneObjectId === camVentana.id &&
              (c.userData.cameraBodyActive || c.userData.sceneObjectDuplicate)
          );
          if (cuerpo) {
            if (!cuerposOcultosRef.current.includes(cuerpo)) {
              cuerposOcultosRef.current.push(cuerpo);
            }
            cuerpo.visible = false;
          }
        }
        // El gizmo queda fuera: con recorrido el cuerpo está oculto (el
        // ojo vive dentro) y sus drags no deben disputar el gesto.
        if (gizmoGroupRef.current) gizmoGroupRef.current.visible = false;
      } else if (manejaCamara && camObjeto) {
        const pose = evaluateCameraKeyframes(
          camObjeto.keyframes,
          effectiveTime * 1000,
          camObjeto.fov
        );
        if (pose) {
          camera.position.set(pose.position.x, pose.position.y, pose.position.z);
          camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
          if (Math.abs(camera.fov - pose.fov) > 0.01) {
            camera.fov = pose.fov;
            camera.updateProjectionMatrix();
          }
          if (controls.enabled) controls.enabled = false;
          camaraObjetoManejandoRef.current = true;
          // El ojo queda DENTRO del cuerpo de la cámara-objeto: su lente y
          // su cono de visión taparían la imagen. Se oculta el visual de
          // ESA cámara (el root activo en meshGroup o su duplicado) y
          // vuelve al salir.
          const cuerpo = meshGroupRef.current?.children.find(
            (c) =>
              c.userData.sceneObjectId === camObjeto.id &&
              (c.userData.cameraBodyActive || c.userData.sceneObjectDuplicate)
          );
          if (cuerpo) {
            // Acumulado entre fotogramas: si ya está oculto de un frame
            // anterior hay que recordarlo igual para restaurarlo al salir.
            if (!cuerposOcultosRef.current.includes(cuerpo)) {
              cuerposOcultosRef.current.push(cuerpo);
            }
            cuerpo.visible = false;
          }
          // Durante la exportación el recorrido no sale en el vídeo.
          if (exportState && cameraObjectPathRef.current) {
            cameraObjectPathRef.current.group.visible = false;
          }
        }
      } else if (camaraObjetoManejandoRef.current) {
        camaraObjetoManejandoRef.current = false;
        controls.enabled = true;
        // El cuerpo de la cámara vuelve a verse (si el objeto no está oculto).
        for (const r of cuerposOcultosRef.current) {
          const oculto = (objectsRef.current ?? []).find(
            (o) => o.id === r.userData.sceneObjectId
          )?.hidden;
          r.visible = !oculto;
        }
        cuerposOcultosRef.current = [];
        // Restaura la vista del panel que había antes del manejo.
        const vista = vistaPanelRef.current ?? camera3D;
        if (vista) applyCamera(camera, controls, vista);
        // Devuelve el manipulador a su visibilidad normal.
        if (gizmoGroupRef.current) {
          const esCamara =
            (objectsRef.current ?? []).find(
              (o) => o.id === selectedObjectIdRef.current
            )?.kind === 'camera';
          gizmoGroupRef.current.visible =
            gizmoOnRef.current &&
            ((meshRef.current?.vertices?.length ?? 0) > 0 || esCamara);
        }
      }
      // Efectos por objeto: actualizar cada runtime con partículas vivas.
      const colocandoAhora = placeTargetRef.current;
      for (const rt of fxObjetosRef.current.values()) {
        if (rt.sparks?.points.visible) {
          updateSparks(rt.sparks, dt, emisorDeFoco(rt, 'sparks'));
        }
        if (rt.fire?.points.visible) {
          // El estilo viene del fireEstilo del objeto. Con focos el emisor
          // ya es un punto (no se converge); sin focos la pluma converge
          // hacia el promedio vivo de los nacimientos.
          updateFire(
            rt.fire,
            dt,
            emisorDeFoco(rt, 'fire'),
            rt.estatico.fire?.fireEstilo ?? 0,
            rt.focos.fire.length === 0
          );
        }
        if (rt.stars?.group.visible) {
          updateStars(rt.stars, dt, rt.sampler, rt.starSize);
        }
        if (rt.rain) {
          rt.rain.points.visible = rt.rainActivo;
          if (rt.rainActivo) updateRain(rt.rain, dt);
        }
        if (rt.smoke) {
          rt.smoke.points.visible = rt.smokeActivo;
          if (rt.smokeActivo) updateSmoke(rt.smoke, dt, emisorDeFoco(rt, 'smoke'));
        }
        // Estrellas colocadas: latido suave + giro lento. Las aleatorias
        // se pausan mientras se está colocando para editar sin ruido.
        const placed = rt.colocadas;
        if (placed) {
          const tNow = clock.elapsedTime;
          placed.group.visible = placed.stars.length > 0;
          for (const star of placed.stars) {
            const pulse = 0.8 + 0.2 * Math.sin(tNow * 2.2 + star.phase);
            star.sprite.scale.setScalar(star.rawScale * star.tamaño * pulse);
            star.sprite.material.rotation += dt * 0.35;
          }
        }
        if (rt.stars) {
          rt.stars.group.visible = rt.starsOn && !colocandoAhora;
        }
        // Los marcadores de foco (guías) no deben salir en el vídeo ni en
        // la vista de cámara.
        rt.anchorGroup.visible = !ayudasOcultas;
        // Cada guía se oculta cuando su efecto ya está emitiendo (así los
        // círculos desaparecen al activar Llamas/Humo/Chispas), salvo que
        // se esté colocando justo ese efecto, para seguir editándolo.
        const emitiendo: Record<string, boolean> = {
          fire: !!(rt.fire && rt.fire.points.visible),
          smoke: !!(rt.smoke && rt.smoke.points.visible),
          sparks: !!(rt.sparks && rt.sparks.points.visible),
        };
        for (const child of rt.anchorGroup.children) {
          const kind = child.userData.kind as
            | 'fire'
            | 'smoke'
            | 'sparks'
            | undefined;
          child.visible = !kind || !emitiendo[kind] || colocandoAhora === kind;
        }
        // Fuego: luz cálida que parpadea; si hay humo, la luz se atenúa
        // (el humo oscurece el brillo del fuego).
        if (rt.luz) {
          const t = clock.elapsedTime;
          const base = rt.fire?.points.visible
            ? 0.9 + Math.sin(t * 11.3) * 0.28 + Math.sin(t * 27.1) * 0.2
            : 0;
          rt.luz.intensity = rt.smokeActivo ? base * 0.35 : base;
        }
      }

       // Update light helper visuals each frame so cones follow lights
      const cfg = lightConfigRef.current;
      if (cfg) {
        // Focos vinculados a un objeto: recolocar su objetivo cada frame para
        // que sigan apuntándolo aunque se mueva.
        for (const s of spotlightRefs.current) {
          const sIdx = s.userData?.spotlightIdx;
          if (sIdx === undefined) continue;
          const sCfg = cfg.spotlights[sIdx];
          if (sCfg?.targetObjectId) {
            const sTgt = resolveSpotTarget(sCfg, objectsRef.current);
            s.target.position.set(sTgt.x, sTgt.y, sTgt.z);
          }
        }
      }
      if (lightHelpersGroupRef.current && cfg) {
        for (const child of lightHelpersGroupRef.current.children) {
          const ud = child.userData as { lightType?: string; handleType?: string; spotlightIdx?: number };
          if (ud.lightType !== 'spotlight' || ud.spotlightIdx === undefined) continue;
          const idx = ud.spotlightIdx;
          const sp = cfg.spotlights[idx];
          if (!sp) continue;
          // Sync visibility: hidden when light is off or helperVisible is false
          const helperShouldShow = sp.enabled && sp.helperVisible !== false;
          if (child.visible !== helperShouldShow) {
            child.visible = helperShouldShow;
          }
          if (!helperShouldShow) continue;
          const lightPos = new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z);
          const spTgt = resolveSpotTarget(sp, objectsRef.current);
          const lightDir = new THREE.Vector3(
            spTgt.x - lightPos.x,
            spTgt.y - lightPos.y,
            spTgt.z - lightPos.z
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
          // Pistas de OBJETO: solo el aviso de fin (el visor aplica el
          // valor evaluado por pista en flujos posteriores). La cámara
          // animada ya no es una pista: es una cámara-objeto (activeCamera)
          // y la maneja la rama de arriba.
          if (!track.looping && effectiveTime * 1000 >= track.duration && !completedTracksRef.current.has(track.id)) {
            completedTracksRef.current.add(track.id);
            onAnimationCompleteRef.current?.(track.id);
          }
        }
        }
       // Actualizar el CubeCamera para reflejos de espejo (solo en las
       // vistas 3D libres: en las ventanas 2D los materiales son planos
       // sin reflejos, y compilar/renderizar 6 caras por frame sería
       // trabajo nulo — además el modo plano les cambia el material).
       const cubeCam = cubeCameraRef.current;
       if (cubeCam && !flat2DRef.current) {
         cubeCam.position.copy(camera.position);
         cubeCam.position.y = Math.max(0.5, cubeCam.position.y);
         cubeCam.update(renderer, scene);
       }

        // Update face selection overlay and HTML elements
        const m = meshRef.current;
        // El cuerpo de la cámara-objeto no es una malla editable: ignora
        // cualquier hijo llamado 'mesh' que no lo sea de verdad.
        const meshObj = findMainMesh(meshGroupRef.current);
        if (faceSelectModeRef.current && m && meshObj) {
          // MODO SUB-SELECCIÓN (petición del usuario): TODA la escena pasa a
          // gris liso, sin textura — cada objeto pierde su color y así el
          // hover/selección se leen limpios sobre cualquier figura. Además la
          // superficie se empuja una pizca hacia atrás (polygonOffset) para
          // que los resaltes coplanares ganen el test de profundidad. Al
          // salir se restaura todo.
          const raizWash = meshGroupRef.current;
          if (raizWash) {
            const objetivo = faceSelectionTargetRef.current;
            raizWash.traverse((o) => {
              if (!(o instanceof THREE.Mesh)) return;
              if (o.renderOrder >= 990) return; // overlays/guías: jamás
              if (o.userData?.sceneObjectDuplicate || o.userData?.cameraBodyActive) return;
              let padre: THREE.Object3D | null = o.parent;
              while (padre && padre !== raizWash) {
                if (padre.userData?.sceneObjectDuplicate || padre.userData?.cameraBodyActive) return;
                padre = padre.parent;
              }
              const matsW = Array.isArray(o.material) ? o.material : [o.material];
              for (const mat of matsW) {
                const matU = mat as THREE.MeshStandardMaterial & {
                  userData: Record<string, unknown>; polygonOffset: boolean;
                };
                if (!matU || !matU.userData) continue;
                if (matU.userData.__ovPO !== true) {
                  if (!matU.userData.__ovApariencia) {
                    // Primera vez en el modo: guardar la apariencia.
                    matU.userData.__ovApariencia = {
                      map: 'map' in matU ? matU.map : undefined,
                      color: 'color' in matU && matU.color ? matU.color.getHex() : null,
                    };
                  }
                  if ('map' in matU && matU.map) {
                    matU.map = null;
                    matU.needsUpdate = true;
                  }
                  if ('color' in matU && matU.color) matU.color.setHex(0xd9d9d9);
                  matU.needsUpdate = true;
                }
                matU.polygonOffset = true;
                // Con segmentos el resalte coplanar pierde el test de
                // profundidad con empuje mínimo: más empuje en ambos.
                matU.polygonOffsetFactor = objetivo === 'segmento' ? 3 : 1;
                matU.polygonOffsetUnits = objetivo === 'segmento' ? 4 : 1;
                matU.userData.__ovPO = true;
              }
            });
          }
          const worldMatrix = meshObj.matrixWorld;
          const target = faceSelectionTargetRef.current;

          // El grupo de resalte debe vivir DENTRO de la malla viva: un
          // remontaje (HMR/StrictMode) puede dejarlo en la escena de un
          // montaje anterior — invisible para siempre. Si el padre no es la
          // malla actual, se re-adosa aquí (add re-parenta).
          const overlayGr = faceSelectionOverlayRef.current;
          if (overlayGr && overlayGr.parent !== meshObj) meshObj.add(overlayGr);

          // Guías DESACTIVADAS (petición del usuario): el objeto se renderiza
          // NORMAL — sin puntos azules en cada vértice, sin líneas en cada
          // arista, sin marcas en cada cara. Solo hover/selección colorean el
          // elemento. La guía se vacía por si quedó sucia de una sesión previa.
          const guideGroup = faceGuideRef.current;
          if (guideGroup && guideGroup.children.length > 0) {
            while (guideGroup.children.length) {
              const child = guideGroup.children[0];
              guideGroup.remove(child);
              child.traverse?.((o) => {
                if (o instanceof THREE.Points || o instanceof THREE.LineSegments) {
                  o.geometry?.dispose?.();
                  (o.material as THREE.Material)?.dispose?.();
                }
              });
            }
            faceGuideCacheRef.current = { mesh: null, target: '' };
          }

          // Update 3D overlay of selected faces/vertices/edges
          const group = faceSelectionOverlayRef.current;
          if (group) {
            // Remove old overlay meshes (los grupos anidan esferas: recorrer)
            while (group.children.length) {
              const child = group.children[0];
              group.remove(child);
              child.traverse?.((o) => {
                if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
                  o.geometry?.dispose?.();
                  (o.material as THREE.Material)?.dispose?.();
                }
              });
            }
            if (target === 'cara') {
              const overlay = buildFaceSelectionOverlay(
                m,
                new Set(selectedFaceIdsRef.current)
              );
              if (overlay) {
                group.add(overlay);
              }
            } else if (target === 'vertice') {
              const overlay = buildVertexSelectionOverlay(
                m,
                new Set(selectedVertexIdsRef.current)
              );
              if (overlay) {
                group.add(overlay);
              }
            } else {
              const overlay = buildEdgeSelectionOverlay(
                m,
                new Set(selectedEdgeIdsRef.current)
              );
              if (overlay) {
                group.add(overlay);
              }
            }
          }

          // El polígono se dibuja ahora con clics sucesivos: mantener el
          // SVG oculto salvo mientras hay una forma en curso.
          if (faceSelectionPolyDivRef.current && faceSelectionPointsRef.current.length === 0) {
            faceSelectionPolyDivRef.current.style.display = 'none';
          }

          // Resaltado del elemento apuntado (hover) en NARANJA: SIEMPRE el
          // elemento completo de un golpe (la cara con todos sus triángulos
          // y bordes, la arista completa, el punto). Reconstruido solo al
          // cambiar de elemento; durante un arrastre no hay hover.
          const hovGr = faceHoverOverlayRef.current;
          if (hovGr) {
            if (hovGr.parent !== meshObj) meshObj.add(hovGr);
            const hover =
              faceMoveDragRef.current ||
              faceSelectionStartRef.current ||
              selectionGizmoDragRef.current
                ? null
                : hoverElementRef.current;
            // La firma del hover incluye el anillo (si el modo lo agrupa):
            // apuntar a OTRO borde de la misma cara cambia de anillo y el
            // resalte tiene que reconstruirse.
            const hovKey = hover
              ? `${hover.t}|${String(hover.id)}|${
                  'anillos' in hover && hover.anillos ? hover.anillos.join(',') : ''
                }`
              : ''
            if (hovKey !== hoverKeyRef.current) {
              hoverKeyRef.current = hovKey;
              while (hovGr.children.length) {
                const hijo = hovGr.children[0];
                hovGr.remove(hijo);
                hijo.traverse?.((o) => {
                  if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
                    o.geometry?.dispose?.();
                    (o.material as THREE.Material)?.dispose?.();
                  }
                });
              }
              if (hover) {
                if (hover.t === 'cara') {
                  // Modo anillos: resaltar el ANILLO completo que el pick
                  // ya devolvió agrupado; si no viene, coplanares de siempre.
                  const faceGroup =
                    'anillos' in hover && hover.anillos && hover.anillos.length > 0
                      ? hover.anillos
                      : getFaceGroup(m, hover.id as number);
                  const overlay = buildFaceSelectionOverlay(
                    m,
                    new Set(faceGroup),
                    { fillOpacity: 0.45 } // hover amarillo translúcido; sel. sólida
                  );
                  if (overlay) hovGr.add(overlay);
                } else if (hover.t === 'vertice') {
                  const vertexGroup = getVertexGroup(m, hover.id as number);
                  const overlay = buildVertexSelectionOverlay(
                    m,
                    new Set(vertexGroup),
                    0xffff00, // hover amarillo (mismo esquema que las caras)
                    { hover: true }
                  );
                  if (overlay) hovGr.add(overlay);
                } else {
                  const edgeGroup = getEdgeGroup(m, String(hover.id));
                  const overlay = buildEdgeSelectionOverlay(
                    m,
                    new Set(edgeGroup),
                    0xffff00 // hover amarillo
                  );
                  if (overlay) hovGr.add(overlay);
                }
              }
            }
            hovGr.visible = hovGr.children.length > 0;
          } else {
            hoverKeyRef.current = '';
          }

          // Gizmo de la sub-selección: anclado en vivo al centroide de la
          // selección (en mundo) y a escala 3/4 del gizmo de objetos. El
          // centroide se re-deduce al cambiar la selección o mientras un
          // arrastre mueve los vértices.
          const selKey = `${target}|${selectedFaceIdsRef.current.join(',')}|${selectedVertexIdsRef.current.join(',')}|${selectedEdgeIdsRef.current.join(',')}`;
          if (selectionKeyRef.current !== selKey || selectionGizmoDragRef.current) {
            selectionKeyRef.current = selKey;
            const recogidoSel = collectSelectionVerts(
              m,
              target,
              selectedFaceIdsRef.current,
              selectedVertexIdsRef.current,
              selectedEdgeIdsRef.current
            );
            selectionGizmoCentroRef.current =
              recogidoSel.vertIdx.length > 0 ? recogidoSel.centroLocal : null;
            selectionGizmoNormalRef.current =
              recogidoSel.vertIdx.length > 0
                ? normalSubSeleccion(m, target, selectedFaceIdsRef.current, selectedVertexIdsRef.current, selectedEdgeIdsRef.current)
                : null;
          }
          const selGizmoGr = selectionGizmoGroupRef.current;
          if (selGizmoGr) {
            const centroLocalG = selectionGizmoCentroRef.current;
            if (centroLocalG && !ayudasOcultas) {
              const posSelGizmo = centroLocalG.clone().applyMatrix4(worldMatrix);
              // El gizmo flota por delante de la superficie: se desplaza
              // a lo largo de la normal de la selección (en mundo) para
              // que las flechas no queden dentro del objeto. Misma
              // magnitud relativa mientras se arrastra (el centro se
              // re-deduce en vivo y el offset lo sigue).
              const normalSelG = selectionGizmoNormalRef.current;
              if (normalSelG) {
                posSelGizmo.add(
                  normalSelG.clone().transformDirection(worldMatrix)
                    .multiplyScalar(Math.max(0.05, gizmoBaseScaleRef.current * 0.75) * 0.4)
                );
              }
              // Más el offset que le puso el usuario desde su modo de
              // configuración (como el offset del gizmo de objetos).
              posSelGizmo.add(selGizmoOffsetRef.current);
              selGizmoGr.position.copy(posSelGizmo);
              selGizmoGr.scale.setScalar(
                Math.max(0.05, gizmoBaseScaleRef.current * 0.75)
              );
              selGizmoGr.visible = true;
            } else {
              selGizmoGr.visible = false;
            }
          }
        } else if (!faceSelectModeRef.current) {
          // Al salir del modo: quitar hover y el gizmo de sub-selección.
          hoverElementRef.current = null;
          hoverKeyRef.current = '';
          if (faceHoverOverlayRef.current)
            faceHoverOverlayRef.current.visible = false;
          if (selectionGizmoGroupRef.current)
            selectionGizmoGroupRef.current.visible = false;
          selectionKeyRef.current = '';

          // Restaurar la apariencia de TODAS las mallas de la escena (gris +
          // polygonOffset del modo selección; en modo se grisaron todas).
          const raizOff = meshGroupRef.current;
          if (raizOff) {
            raizOff.traverse((o) => {
              if (!(o instanceof THREE.Mesh) || !o.material) return;
              const matsPO = Array.isArray(o.material) ? o.material : [o.material];
              for (const mat of matsPO) {
                const matU = mat as THREE.MeshStandardMaterial & { userData: Record<string, unknown>; polygonOffset: boolean };
                if (!matU || !matU.userData || matU.userData.__ovPO !== true) continue;
                const guardado = matU.userData.__ovApariencia as { map?: THREE.Texture | null; color?: number | null } | undefined;
                if (guardado) {
                  if (matU.map !== guardado.map) { matU.map = guardado.map ?? null; matU.needsUpdate = true; }
                  if (matU.color && typeof guardado.color === 'number') matU.color.setHex(guardado.color);
                }
                matU.polygonOffset = false;
                delete matU.userData.__ovPO;
                delete matU.userData.__ovApariencia;
              }
            });
          }
          // Only hide 3D overlay when NOT in face select mode
          if (faceSelectionOverlayRef.current) {
            faceSelectionOverlayRef.current.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.visible = false;
              }
            });
          }
          // Sin modo selección no hay guía: vaciarla hasta la próxima vez.
          const guideGroup = faceGuideRef.current;
          if (guideGroup && guideGroup.children.length > 0) {
            while (guideGroup.children.length) {
              const child = guideGroup.children[0];
              guideGroup.remove(child);
              child.traverse?.((o) => {
                if (o instanceof THREE.Points || o instanceof THREE.LineSegments) {
                  o.geometry?.dispose?.();
                  (o.material as THREE.Material)?.dispose?.();
                }
              });
            }
            faceGuideCacheRef.current = { mesh: null, target: '' };
          }
          if (faceSelectionPolyDivRef.current) faceSelectionPolyDivRef.current.style.display = 'none';
          if (faceSelectionLineRef.current) faceSelectionLineRef.current.style.display = 'none';
          if (faceSelectionRectDivRef.current) faceSelectionRectDivRef.current.style.display = 'none';
          if (faceSelectionCircleDivRef.current) faceSelectionCircleDivRef.current.style.display = 'none';
          // Un polígono a medias no sobrevive a salir del modo.
          faceSelectionPointsRef.current.length = 0;
          poligonoCerradaRef.current = null;
        }
       // Modo 2D (dibujo técnico): materiales planos sin sombreado. Se
       // repasa cada frame para cubrir las mallas reconstruidas; es
       // idempotente (los meshes ya convertidos quedan marcados).
       if (flat2DRef.current) aplicarModoPlano(scene);
       renderer.render(scene, camera);

       // Gizmo de ejes: se pinta en un viewport pequeño de la esquina
       // inferior izquierda, reorientado con la cámara principal. Se omite
       // durante la exportación para que no salga en el vídeo.
       if (!exportActivo) {
         const axisScene = axisGizmoSceneRef.current;
         const axisGroup = axisGizmoGroupRef.current;
         const axisCam = axisGizmoCameraRef.current;
         if (axisScene && axisGroup && axisCam) {
           // La inversa de la cámara hace que las flechas apunten al eje
           // del mundo tal y como se ve en pantalla.
           axisGroup.quaternion.copy(camera.quaternion).invert();
           axisGroup.updateMatrixWorld(true);

           const full = renderer.getSize(new THREE.Vector2());
           const gizmoSize = Math.round(
             Math.max(72, Math.min(120, Math.min(full.x, full.y) * 0.18))
           );
           const margin = Math.round(gizmoSize * 0.12);

           renderer.autoClear = false;
           renderer.setScissorTest(true);
           renderer.setViewport(margin, margin, gizmoSize, gizmoSize);
           renderer.setScissor(margin, margin, gizmoSize, gizmoSize);
           renderer.clearDepth();
           renderer.render(axisScene, axisCam);
           renderer.setScissorTest(false);
           renderer.setViewport(0, 0, full.x, full.y);
           renderer.autoClear = true;
         }
       }

       if (exportState) {
         const elapsed = (performance.now() - exportState.startTime) / 1000;
         const percent = Math.min(100, Math.round((elapsed / exportState.duration) * 100));
         onExportProgressRef.current?.(percent);
         if (elapsed >= exportState.duration) {
           exportState.mediaRecorder.stop();
           exportStateRef.current = null;
         }
       }
     };
      animate();

      startMp4ExportRef.current = () => {
        if (mp4ExportActive) return;
        const renderer = rendererRef.current;
        if (!renderer) {
          onExportCompleteRef.current?.({ success: false, error: 'No hay animación para exportar' });
          return;
        }
        mp4ExportActive = true;
        const canvas = renderer.domElement;
        if (!canvas.captureStream || !(window as any).MediaRecorder) {
          mp4ExportActive = false;
          onExportCompleteRef.current?.({ success: false, error: 'No se pudo iniciar la grabación (MediaRecorder no disponible)' });
          return;
        }
        // La exportación sigue la primera cámara-objeto con recorrido (≥2 fotogramas)
        const camObj = (objectsRef.current ?? []).find(
          (o) => o.kind === 'camera' && (o.camera?.keyframes.length ?? 0) >= 2
        );
        const camKfs = camObj?.camera?.keyframes ?? [];
        if (!camObj || camKfs.length === 0) {
          mp4ExportActive = false;
          onExportCompleteRef.current?.({ success: false, error: 'No hay cámara con recorrido para exportar' });
          return;
        }
        const maxDuration = Math.max(Math.max(...camKfs.map((k) => k.time)) / 1000, 1);

        // Exportación en ALTA CALIDAD: se renderiza a 1920×1080 (16:9) con
        // el aspecto de cámara ajustado a ese tamaño (si no, la imagen saldría
        // deformada) y se graba con VP9 a un bitrate alto; el VP8 queda de
        // respaldo. El transcode final usa CRF bajo (electron/main.js).
        const exportWidth = 1920;
        const exportHeight = 1080;
        const originalPixelRatio = renderer.getPixelRatio();
        const originalAspect = camera.aspect;
        renderer.setPixelRatio(1);
        renderer.setSize(exportWidth, exportHeight, false);
        camera.aspect = exportWidth / exportHeight;
        camera.updateProjectionMatrix();
        renderer.setAnimationLoop(null);
        // Ocultar ya las ayudas de edición en el primer fotograma exportado,
        // para que no aparezcan ni un instante (gizmo, focos con su bola
        // amarilla, recorrido de la cámara con su asa amarilla/bola de foco,
        // recorrido del objeto, vértices, caras y marcadores de FX).
        if (gizmoGroupRef.current) gizmoGroupRef.current.visible = false;
        if (cameraObjectPathRef.current)
          cameraObjectPathRef.current.group.visible = false;
        if (objectMotionPathRef.current)
          objectMotionPathRef.current.group.visible = false;
        if (lightGizmoGroupRef.current) lightGizmoGroupRef.current.visible = false;
        if (lightHelpersGroupRef.current)
          lightHelpersGroupRef.current.visible = false;
        if (vertexHelpersRef.current) vertexHelpersRef.current.visible = false;
        if (faceSelectionOverlayRef.current)
          faceSelectionOverlayRef.current.visible = false;
        if (faceGuideRef.current) faceGuideRef.current.visible = false;
        for (const rt of fxObjetosRef.current.values()) {
          rt.anchorGroup.visible = false;
        }
        renderer.render(scene, camera);
        const fps = 30;
        const stream = canvas.captureStream(fps);
        const MediaRecorderCtor = (window as any).MediaRecorder;
        const usaVp9 = MediaRecorderCtor?.isTypeSupported?.('video/webm;codecs=vp9');
        const mediaRecorder = new MediaRecorderCtor(stream, {
          mimeType: usaVp9 ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8',
          videoBitsPerSecond: 20_000_000,
        });

        const chunks: BlobPart[] = [];
        mediaRecorder.ondataavailable = (e: BlobEvent) => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
          try {
            const webmBlob = new Blob(chunks, { type: 'video/webm' });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            const doTranscodeAndDownload = async (tempDir: string) => {
              const tempWebmPath = tempDir + '/zeus_export_temp_' + stamp + '.webm';
              const tempMp4Path = tempDir + '/zeus_anim_' + stamp + '.mp4';

              const arrayBuffer = await webmBlob.arrayBuffer();
              const written = await writeFile(tempWebmPath, new Uint8Array(arrayBuffer));
              if (!written) {
                onExportCompleteRef.current?.({ success: false, error: 'No se pudo guardar el archivo temporal' });
                return;
              }
              onExportProgressRef.current?.(70);
              const result = await transcodeVideo(tempWebmPath, tempMp4Path, (percent) => {
                onExportProgressRef.current?.(70 + Math.round(percent * 0.3));
              });
              await deleteFile(tempWebmPath);

              if (!result.success) {
                onExportCompleteRef.current?.({ success: false, error: result.error });
                return;
              }

              const mp4Data = await readFileBuffer(result.outputPath!);
              await deleteFile(result.outputPath!);

              if (mp4Data) {
                const mp4Blob = new Blob([mp4Data.buffer as ArrayBuffer], { type: 'video/mp4' });
                const url = URL.createObjectURL(mp4Blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'zeus_anim_' + stamp + '.mp4';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                onExportCompleteRef.current?.({ success: true, outputPath: 'Descargado' });
              } else {
                onExportCompleteRef.current?.({ success: false, error: 'No se pudo leer el MP4 generado' });
              }
            };

            if (isElectron()) {
              const paths = await getLocalPaths();
              const videoFolder = paths.video || paths.proyectos_video;
              if (videoFolder) {
                const tempWebmPath = videoFolder + '/zeus_export_temp_' + stamp + '.webm';
                const mp4OutputPath = videoFolder + '/zeus_anim_' + stamp + '.mp4';
                const arrayBuffer = await webmBlob.arrayBuffer();
                const written = await writeFile(tempWebmPath, new Uint8Array(arrayBuffer));
                if (!written) {
                  onExportCompleteRef.current?.({ success: false, error: 'No se pudo guardar el archivo temporal' });
                  return;
                }
                onExportProgressRef.current?.(70);
                const result = await transcodeVideo(tempWebmPath, mp4OutputPath, (percent) => {
                  onExportProgressRef.current?.(70 + Math.round(percent * 0.3));
                });
                await deleteFile(tempWebmPath);
                if (result.success) {
                  onExportCompleteRef.current?.({ success: true, outputPath: result.outputPath });
                } else {
                  onExportCompleteRef.current?.({ success: false, error: result.error });
                }
              } else {
                const tempDir = await getTempDir();
                if (!tempDir) {
                  onExportCompleteRef.current?.({ success: false, error: 'No se pudo determinar la carpeta temporal' });
                  return;
                }
                await doTranscodeAndDownload(tempDir);
              }
            } else {
              const url = URL.createObjectURL(webmBlob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'zeus_anim_' + stamp + '.webm';
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              onExportCompleteRef.current?.({ success: true, outputPath: 'Descargado (WebM)' });
            }
          } catch (e) {
            onExportCompleteRef.current?.({ success: false, error: (e as Error)?.message ?? 'Error durante la exportación' });
          } finally {
            mp4ExportActive = false;
            // Restore original renderer resolution and pixel ratio
            renderer.setPixelRatio(originalPixelRatio);
            renderer.setSize(mount.clientWidth, mount.clientHeight, false);
            camera.aspect = originalAspect;
            camera.updateProjectionMatrix();
          }
        };
        mediaRecorder.start();
        exportStateRef.current = {
          mediaRecorder,
          startTime: performance.now(),
          duration: maxDuration,
        };
        onExportProgressRef.current?.(0);
      };

    const handleResize = () => {
      if (!mount) return;
      // Cámara orto (modo 2D): el frustum deriva del aspecto actual → se
      // re-aplica el último estado del panel; con perspectiva basta aspect.
      if (camera instanceof THREE.OrthographicCamera) {
        const estado =
          vistaPanelRef.current ?? camera3D ?? IDENTITY_CAMERA3D;
        applyCamera(camera, controls, estado);
      } else {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
      }
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    // El contenedor también puede cambiar de tamaño sin que cambie la
    // ventana (p. ej. al arrastrar el separador del editor de
    // movimiento): el listener de window no se entera, así que se
    // observa el propio div del visor.
    const mountResizeObserver =
      typeof ResizeObserver !== 'undefined' && mount
        ? new ResizeObserver(() => handleResize())
        : null;
    if (mountResizeObserver) mountResizeObserver.observe(mount);

    if (camera3D) {
      // El estado de montaje ES la vista del panel: lo fija como referencia
      // (vía de arranque para el pan/zoom en modo 2D antes del primer eco).
      vistaPanelRef.current = camera3D;
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
      const isGizmo = drag.target === 'gizmo';
      // Para el arrastre del offset del gizmo, `t` debe ser el transform
      // MUNDIAL del gizmo (posición + rotación del objeto combinados con
      // el offset), no el offset puro. Si se usara el offset, los
      // valores de rotación/posición heredados por `{...t}` serían
      // incorrectos (espacio de offset en vez de espacio mundial), lo
      // que haría girar o saltar el gizmo.
      const t = isHelper
        ? textureHelperTransformRef.current
        : isGizmo
          ? (() => {
              const objT = transformRef.current;
              const objQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(objT.rx, objT.ry, objT.rz)
              );
              const off = gizmoOffsetRef.current;
              const gizmoWorldPos = new THREE.Vector3(
                off.px, off.py, off.pz
              ).applyQuaternion(objQuat).add(
                new THREE.Vector3(objT.px, objT.py, objT.pz)
              );
              const offQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(off.rx, off.ry, off.rz)
              );
              const gizmoWorldE = new THREE.Euler().setFromQuaternion(
                objQuat.clone().multiply(offQuat)
              );
              return {
                px: gizmoWorldPos.x,
                py: gizmoWorldPos.y,
                pz: gizmoWorldPos.z,
                rx: gizmoWorldE.x,
                ry: gizmoWorldE.y,
                rz: gizmoWorldE.z,
                sx: off.sx,
                sy: off.sy,
                sz: off.sz,
                o: off.o,
              };
            })()
          : transformRef.current;
      // La pieza de textura vive en las coordenadas locales de la malla:
      // el rayo se pasa a ese espacio antes de medir el arrastre
      const ray =
        isHelper && drag.rayToLocal
          ? raycasterRef.current.ray.clone().applyMatrix4(drag.rayToLocal)
          : raycasterRef.current.ray;
      let next: ObjectTransform;
      if (drag.mode === 'rotate') {
        // Cámara-objeto: rotar NO gira el cuerpo (su mirada es siempre
        // lookAt al foco); el mismo ángulo ÓRBITA el foco alrededor del
        // cuerpo. El resultado lo reporta el padre vía onCameraTargetOrbit.
        const camActiva = cameraEditorRef.current;
        if (
          camActiva?.objectId &&
          camActiva.objectId === selectedObjectIdRef.current &&
          camActiva.focus &&
          !isHelper
        ) {
          const hit = new THREE.Vector3();
          if (!ray.intersectPlane(drag.plane, hit)) return;
          const d = hit.sub(drag.startPos);
          const ang = Math.atan2(d.dot(drag.basisV), d.dot(drag.basisU));
          const dq = new THREE.Quaternion().setFromAxisAngle(
            drag.axisWorld,
            ang - drag.startAngle
          );
          const cuerpo = new THREE.Vector3(t.px, t.py, t.pz);
          const radio = new THREE.Vector3(
            camActiva.focus.x - cuerpo.x,
            camActiva.focus.y - cuerpo.y,
            camActiva.focus.z - cuerpo.z
          ).applyQuaternion(dq);
          const nuevo = cuerpo.add(radio);
          onCameraTargetOrbitRef.current?.({ x: nuevo.x, y: nuevo.y, z: nuevo.z });
          return;
        }
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(drag.plane, hit)) return;
        const d = hit.sub(drag.startPos);
        const ang = Math.atan2(d.dot(drag.basisV), d.dot(drag.basisU));
        const dq = new THREE.Quaternion().setFromAxisAngle(
          drag.axisWorld,
          ang - drag.startAngle
        );
        // Ángulo continuo (sin salto ±π) para la órbita: permite dar toda la
        // vuelta y revertir el arrastre sin que el gizmo se corte a los 180°.
        const prev = drag.prevAngle ?? drag.startAngle;
        const swept =
          (drag.sweptAngle ?? 0) +
          Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
        drag.sweptAngle = swept;
        drag.prevAngle = ang;
        const dqOrbit = new THREE.Quaternion().setFromAxisAngle(
          drag.axisWorld,
          swept
        );
        // Vista previa del giro multi-selección: el activo y el resto de
        // seleccionados comparten estas rotaciones (dq: giro individual;
        // dqOrbit: órbita del conjunto alrededor del centro).
        if (drag.target === 'object') {
          drag.lastDq = dq;
          drag.lastDqOrbit = dqOrbit;
        }
        if (drag.rotatePivot) {
          // Gizmo desplazado (offset activo) sobre un único objeto: el objeto
          // rota ORBITANDO alrededor del pivote (posición de mundo del gizmo).
          // Rotación rígida: la posición traslada y la orientación rota con el
          // mismo ángulo. Al atar el gizmo al objeto mediante el offset,
          // objPos+offset == pivote siempre → el gizmo se queda en el centro
          // y los ejes apuntan a donde quedó el objeto al soltar, por lo que
          // sirve para seguir inclinándolo.
          const startObjPos = drag.startObjectPos ?? new THREE.Vector3(t.px, t.py, t.pz);
          const newPos = new THREE.Vector3()
            .subVectors(startObjPos, drag.startPos)
            .applyQuaternion(dqOrbit)
            .add(drag.startPos);
          const e = new THREE.Euler().setFromQuaternion(
            drag.startQuat.clone().premultiply(dqOrbit)
          );
          next = { ...t, px: newPos.x, py: newPos.y, pz: newPos.z, rx: e.x, ry: e.y, rz: e.z };
        } else {
          const e = new THREE.Euler().setFromQuaternion(
            drag.startQuat.clone().premultiply(dq)
          );
          next = { ...t, rx: e.x, ry: e.y, rz: e.z };
        }
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
          const scaled = Math.max(0.05, drag.startScale[drag.axis] + delta);
          next = { ...t };
          if (drag.axis === 'x') next.sx = scaled;
          else if (drag.axis === 'y') next.sy = scaled;
          else next.sz = scaled;
        }
      }
      if (isHelper) {
        // Se avisa en cada movimiento: así la textura va siguiendo la
        // pieza en vivo mientras se arrastra (igual que los vértices).
        textureHelperTransformRef.current = next;
        applyTextureHelperTransform(next);
        onTextureHelperTransformRef.current?.(next);
       } else if (isGizmo) {
          if (drag.objectQuat && drag.objectPos) {
            const invObjQuat = drag.objectQuat.clone().invert();
            const offsetPos = new THREE.Vector3(next.px, next.py, next.pz)
              .sub(drag.objectPos)
              .applyQuaternion(invObjQuat);
            const effQuat = new THREE.Quaternion().setFromEuler(
             new THREE.Euler(next.rx, next.ry, next.rz)
           );
           const offsetQuat = invObjQuat.multiply(effQuat);
           const offsetE = new THREE.Euler().setFromQuaternion(offsetQuat);
           const offsetNext: ObjectTransform = {
             ...next,
             px: offsetPos.x,
             py: offsetPos.y,
             pz: offsetPos.z,
             rx: offsetE.x,
             ry: offsetE.y,
             rz: offsetE.z,
           };
          gizmoOffsetRef.current = offsetNext;
          onGizmoOffsetChangeRef.current?.(offsetNext);
        } else {
          gizmoOffsetRef.current = next;
          onGizmoOffsetChangeRef.current?.(next);
        }
        applyObjectTransform(transformRef.current);
      } else {
        transformRef.current = next;
        applyObjectTransform(next);
      }
    };

     const onPointerMove = (e: PointerEvent) => {
       const rect = renderer.domElement.getBoundingClientRect();
       pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
       pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Modo grabación: marcar el arrastre como movimiento real (umbral
      // de 4 px) para no capturar un mero clic sin arrastre.
      if (
        recDownRef.current &&
        !gizmoDragRef.current &&
        !cameraPathDragRef.current &&
        !dragRef.current
      ) {
        const dx = e.clientX - recDownRef.current.x;
        const dy = e.clientY - recDownRef.current.y;
        if (Math.hypot(dx, dy) > 4) recDownRef.current.moved = true;
      }

        // --- Mover la selección de caras/vértices/segmentos ---
        if (faceMoveDragRef.current && faceSelectModeRef.current) {
          const move = faceMoveDragRef.current;
          raycasterRef.current.setFromCamera(pointerRef.current, camera);
          const intersection = new THREE.Vector3();
          if (move.plane && raycasterRef.current.ray.intersectPlane(move.plane, intersection)) {
            // El delta se lleva al espacio LOCAL de la malla (donde viven
            // los vértices): misma inversa de matrixWorld con la que se
            // convirtió el ancla inicial.
            const meshObj = findMainMesh(meshGroupRef.current);
            if (meshObj) {
              meshObj.updateWorldMatrix(true, false);
              const invMatrix = new THREE.Matrix4().copy(meshObj.matrixWorld).invert();
              const localNow = intersection.clone().applyMatrix4(invMatrix);
              const dx = localNow.x - move.localStart.x;
              const dy = localNow.y - move.localStart.y;
              const dz = localNow.z - move.localStart.z;
              const verts = move.originalVerts.map((v) => ({ ...v }));
              for (const idx of move.vertIdx) {
                const v = verts[idx];
                if (!v) continue;
                v.x += dx;
                v.y += dy;
                v.z += dz;
              }
              // Con selecciones grandes (miles de vértices) emitir en CADA
              // pointermove reconstruye la figura decenas de veces por
              // segundo y cuelga la página: como mucho una emisión cada
              // 80 ms; al soltar se emite la posición final exacta.
              move.latestVerts = verts;
              const ahora = performance.now();
              if (move.lastEmit === undefined || ahora - move.lastEmit >= 80) {
                move.lastEmit = ahora;
                onVerticesChangeRef.current?.(verts);
              }
            }
          }
          return;
        }

        // --- Gizmo de sub-selección en modo configuración: mover SU ---
        // --- offset de sitio (no la selección) ------------------------
        const offDragSel = selGizmoOffsetDragRef.current;
        if (offDragSel) {
          raycasterRef.current.setFromCamera(pointerRef.current, camera);
          const deltaOff = new THREE.Vector3();
          if (offDragSel.axis) {
            const tcOff = closestPointOnAxis(
              raycasterRef.current.ray,
              offDragSel.startPos,
              offDragSel.axisDir
            );
            if (tcOff !== null) {
              deltaOff.copy(offDragSel.axisDir).multiplyScalar(tcOff - offDragSel.startT);
            }
          } else {
            const hitOff = new THREE.Vector3();
            if (raycasterRef.current.ray.intersectPlane(offDragSel.plane, hitOff)) {
              deltaOff.copy(hitOff).sub(offDragSel.startPos);
            }
          }
          if (deltaOff.lengthSq() > 0) {
            selGizmoOffsetRef.current.copy(offDragSel.startOffset).add(deltaOff);
            onSelGizmoOffsetChangeRef.current?.({
              x: selGizmoOffsetRef.current.x,
              y: selGizmoOffsetRef.current.y,
              z: selGizmoOffsetRef.current.z,
            });
          }
          return;
        }

        // --- Gizmo de sub-selección: mover/escalar en vivo ---------------
        const selDrag = selectionGizmoDragRef.current;
        if (selDrag) {
          raycasterRef.current.setFromCamera(pointerRef.current, camera);
          const meshObjSelMove = findMainMesh(meshGroupRef.current);
          let verts: Vertex3D[] | null = null;
          if (meshObjSelMove) {
            meshObjSelMove.updateWorldMatrix(true, false);
            const invMatrixSel = new THREE.Matrix4()
              .copy(meshObjSelMove.matrixWorld)
              .invert();
            if (selDrag.mode === 'move') {
              const tc = closestPointOnAxis(
                raycasterRef.current.ray,
                selDrag.centroMundoStart,
                selDrag.axisWorld
              );
              if (tc !== null) {
                // Vector MUNDO del desplazamiento, llevado a LOCAL por la
                // inversa de matrixWorld (dos puntos: se anula el traslado).
                const p0 = new THREE.Vector3(0, 0, 0).applyMatrix4(invMatrixSel);
                const p1 = selDrag.axisWorld
                  .clone()
                  .multiplyScalar(tc - selDrag.startT)
                  .applyMatrix4(invMatrixSel);
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const dz = p1.z - p0.z;
                verts = selDrag.vertOriginales.map((v) => ({ ...v }));
                for (const idx of selDrag.vertIdx) {
                  const v = verts[idx];
                  if (!v) continue;
                  v.x += dx;
                  v.y += dy;
                  v.z += dz;
                }
              }
            } else {
              // Escala (uniforme con el cubo blanco; por eje con las bolas),
              // pivotada en el centroide de la selección.
              const hitSel = new THREE.Vector3();
              if (raycasterRef.current.ray.intersectPlane(selDrag.plane, hitSel)) {
                const delta = hitSel.sub(selDrag.centroMundoStart).dot(selDrag.basisU);
                const factor = Math.max(0.05, 1 + delta);
                const cx = selDrag.centroLocal.x;
                const cy = selDrag.centroLocal.y;
                const cz = selDrag.centroLocal.z;
                verts = selDrag.vertOriginales.map((v) => ({ ...v }));
                for (const idx of selDrag.vertIdx) {
                  const v = verts[idx];
                  if (!v) continue;
                  if (selDrag.mode === 'uniform-scale') {
                    v.x = cx + (v.x - cx) * factor;
                    v.y = cy + (v.y - cy) * factor;
                    v.z = cz + (v.z - cz) * factor;
                  } else if (selDrag.axis === 'x') {
                    v.x = cx + (v.x - cx) * factor;
                  } else if (selDrag.axis === 'y') {
                    v.y = cy + (v.y - cy) * factor;
                  } else {
                    v.z = cz + (v.z - cz) * factor;
                  }
                }
              }
            }
          }
          if (verts) {
            // Misma disciplina que el arrastre de la selección: emisión
            // como mucho cada 80 ms y posición final exacta al soltar.
            selDrag.latestVerts = verts;
            const ahoraSel = performance.now();
            if (
              selDrag.lastEmit === undefined ||
              ahoraSel - selDrag.lastEmit >= 80
            ) {
              selDrag.lastEmit = ahoraSel;
              onVerticesChangeRef.current?.(verts);
            }
          }
          return;
        }

        // --- Polígono: previsualización (clics sucesivos, no arrastra) ---
        if (
          faceSelectModeRef.current &&
          faceSelectionToolRef.current === 'poligono' &&
          faceSelectionPointsRef.current.length > 0
        ) {
          const canvasRect = renderer.domElement.getBoundingClientRect();
          const pts = faceSelectionPointsRef.current;
          const poly = faceSelectionPolyDivRef.current;
          const lineEl = faceSelectionLineRef.current;
          if (poly && poly.parentElement && lineEl) {
            poly.parentElement.style.display = 'block';
            poly.style.display = 'block';
            // Relleno de la forma con el punto vivo siguiendo al cursor.
            poly.setAttribute(
              'points',
              pts
                .map((p) => `${p.x - canvasRect.left},${p.y - canvasRect.top}`)
                .join(' ') +
                ` ${e.clientX - canvasRect.left},${e.clientY - canvasRect.top}`
            );
            // Goma viva: del último vértice al cursor.
            const ultimo = pts[pts.length - 1];
            lineEl.style.display = 'block';
            lineEl.setAttribute('x1', String(ultimo.x - canvasRect.left));
            lineEl.setAttribute('y1', String(ultimo.y - canvasRect.top));
            lineEl.setAttribute('x2', String(e.clientX - canvasRect.left));
            lineEl.setAttribute('y2', String(e.clientY - canvasRect.top));
          }
          return;
        }

        // --- Face selection: update overlay during drag ---
        if (faceSelectionStartRef.current && faceSelectModeRef.current) {
          const start = faceSelectionStartRef.current;
          const startRect = start.rect;
          const canvasRect = startRect;
          const tool = faceSelectionToolRef.current;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;

          if (tool === 'rectangle') {
            const left = Math.min(start.x - canvasRect.left, e.clientX - canvasRect.left);
            const top = Math.min(start.y - canvasRect.top, e.clientY - canvasRect.top);
            const width = Math.abs(dx);
            const height = Math.abs(dy);
          const rectDiv = faceSelectionRectDivRef.current;
          if (rectDiv) {
              if (width > 2 && height > 2) {
                rectDiv.style.display = 'block';
                rectDiv.style.left = `${left}px`;
                rectDiv.style.top = `${top}px`;
                rectDiv.style.width = `${width}px`;
                rectDiv.style.height = `${height}px`;
              } else {
                rectDiv.style.display = 'none';
              }
            }
          } else if (tool === 'circle') {
            const radius = Math.sqrt(dx * dx + dy * dy);
            const circleDiv = faceSelectionCircleDivRef.current;
            if (circleDiv) {
              if (radius > 5) {
                circleDiv.style.display = 'block';
                circleDiv.style.left = `${start.x - canvasRect.left}px`;
                circleDiv.style.top = `${start.y - canvasRect.top}px`;
                circleDiv.style.width = `${radius * 2}px`;
                circleDiv.style.height = `${radius * 2}px`;
              } else {
                circleDiv.style.display = 'none';
              }
            }
          } else if (tool === 'line') {
            const lineEl = faceSelectionLineRef.current;
            if (lineEl) {
              lineEl.style.display = 'block';
              lineEl.setAttribute('x1', String(start.x - canvasRect.left));
              lineEl.setAttribute('y1', String(start.y - canvasRect.top));
              lineEl.setAttribute('x2', String(e.clientX - canvasRect.left));
              lineEl.setAttribute('y2', String(e.clientY - canvasRect.top));
            }
          }
          controls.enabled = false;
          renderer.domElement.style.cursor = 'crosshair';
          return;
        }

        // --- Rubber-band selection: update rectangle overlay ---
        if (selectionStartRef.current) {
         const start = selectionStartRef.current;
         const canvasRect = renderer.domElement.getBoundingClientRect();
         const x1 = start.x - canvasRect.left;
         const y1 = start.y - canvasRect.top;
         const x2 = e.clientX - canvasRect.left;
         const y2 = e.clientY - canvasRect.top;
         const selRect = selectionRectRef.current;
         if (selRect) {
           const left = Math.min(x1, x2);
           const top = Math.min(y1, y2);
           const width = Math.abs(x2 - x1);
           const height = Math.abs(y2 - y1);
           if (width > 2 && height > 2) {
             selRect.style.display = 'block';
             selRect.style.left = `${left}px`;
             selRect.style.top = `${top}px`;
             selRect.style.width = `${width}px`;
             selRect.style.height = `${height}px`;
           } else {
             selRect.style.display = 'none';
           }
         }
         return;
       }

       if (gizmoDragRef.current) {
        updateGizmoDrag();
        return;
      }

      // Arrastre de un asa del recorrido de la cámara-objeto: aplica el
      // delta sobre el plano perpendicular a la vista y avisa al padre en
      // vivo (escribe el fotograma o el foco mientras se arrastra).
      if (cameraPathDragRef.current) {
        const drag = cameraPathDragRef.current;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hit = new THREE.Vector3();
        if (!raycasterRef.current.ray.intersectPlane(drag.plane, hit)) return;
        const delta = hit.clone().sub(drag.startPos);
        const nuevo = drag.original.clone().add(delta);
        if (drag.kind === 'target') {
          onCameraTargetMoveRef.current?.({ x: nuevo.x, y: nuevo.y, z: nuevo.z });
        } else {
          onCameraKeyframeMoveRef.current?.(drag.index, {
            x: nuevo.x,
            y: nuevo.y,
            z: nuevo.z,
          });
        }
        return;
      }

      // Arrastre de un asa del recorrido del objeto (editor de
      // movimiento): mismo plano perpendicular a la vista, avisa al padre
      // en vivo con la nueva posición del fotograma.
      if (motionPathDragRef.current) {
        const drag = motionPathDragRef.current;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hit = new THREE.Vector3();
        if (!raycasterRef.current.ray.intersectPlane(drag.plane, hit)) return;
        const delta = hit.clone().sub(drag.startPos);
        const nuevo = drag.original.clone().add(delta);
        onMotionKeyframeMoveRef.current?.(drag.index, {
          x: nuevo.x,
          y: nuevo.y,
          z: nuevo.z,
        });
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
                           // Al re-apuntar a mano se suelta el vínculo con el objeto.
                           targetObjectId: undefined,
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
           ? gizmoHandlesRef.current.filter((h) => h.visible)
           : [];
      const helperHandles =
        textureHelperOnRef.current && textureHelperGizmoGroupRef.current?.visible
          ? textureHelperHandlesRef.current.filter((h) => h.visible)
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

      // Hover cursor for light helpers (when not dragging). El punto amarillo
      // de cada foco solo es visible al pasar el ratón sobre él o mientras se
      // arrastra (por defecto no se dibuja; solicitud del usuario).
      const lightDragEstado = lightDragRef.current as { spotlightIdx?: number } | null;
      const lightDragIdx = lightDragEstado?.spotlightIdx;
      let posHelperHovered: THREE.Object3D | null = null;
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
          posHelperHovered = lightHover[0]?.object ?? null;
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

      // --- Sub-selección: cursor del gizmo propio + hover del elemento ---
      if (
        faceSelectModeRef.current &&
        !dragRef.current &&
        !faceMoveDragRef.current &&
        !faceSelectionStartRef.current &&
        !selectionGizmoDragRef.current
      ) {
        // Mano/selector sobre las asas del gizmo de la sub-selección (si
        // hay selección: sin ella el gizmo está oculto).
        if (selectionGizmoGroupRef.current?.visible) {
          raycasterRef.current.setFromCamera(pointerRef.current, camera);
          const selHoverHandles = raycasterRef.current.intersectObjects(
            selectionGizmoHandlesRef.current,
            false
          );
          if (selHoverHandles.length > 0) {
            const udH = selHoverHandles[0].object.userData as { mode?: string };
            renderer.domElement.style.cursor =
              udH.mode === 'move' ? 'grab' : 'pointer';
          }
        }
        // Elemento bajo el cursor en AMARILLO, revisado como mucho cada
        // 40 ms (el raycast/proyecciones no deben ir en cada pointermove).
        // SIN depender del gizmo: el hover funciona ANTES de seleccionar
        // nada (el usuario lo pidió: se ilumina al pasar, se elige al clic).
        const ahoraHover = performance.now();
        if (ahoraHover - lastHoverCheckRef.current >= 40) {
          lastHoverCheckRef.current = ahoraHover;
          const mHover = meshRef.current;
          const meshObjHover = findMainMesh(meshGroupRef.current);
          let hoverNuevo: {
            t: 'cara' | 'vertice' | 'segmento';
            id: number | string;
            anillos?: number[];
          } | null = null;
          if (mHover && meshObjHover && mHover.vertices.length > 0) {
            hoverNuevo = pickSubElemento(
              mHover,
              meshObjHover,
              camera,
              e.clientX,
              e.clientY,
              renderer.domElement.getBoundingClientRect(),
              faceSelectionTargetRef.current,
              faceSelectVisibleOnlyRef.current,
              faceAnillosRef.current && faceSelectionToolRef.current === 'directo'
            );
          }
          hoverElementRef.current = hoverNuevo;
          if (!hoverNuevo) {
            renderer.domElement.style.cursor = '';
          }
        }
      }

      // Punto visible solo si está under el ratón o en pleno arrastre.
      for (const helper of lightPositionHelpersRef.current) {
        const dot = helper.children[0] as THREE.Mesh | undefined;
        if (!dot) continue;
        const esArrastrado =
          lightDragIdx !== undefined &&
          (helper.userData as { spotlightIdx?: number }).spotlightIdx === lightDragIdx;
        dot.visible = helper === posHelperHovered || esArrastrado;
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

    // Colocación de focos/estrellas: clic (sin arrastre) sobre CUALQUIER
    // objeto añade un punto; clic cerca de uno colocado lo quita. El punto
    // queda en coordenadas locales del objeto y se persiste en sus efectos
    // (vive con el proyecto y sus deshacer/rehacer).
    const handleFxPlacementClick = (clientX: number, clientY: number) => {
      const target = placeTargetRef.current;
      if (!target) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);

      // 1) Clic sobre un punto ya colocado -> lo quita (busca en todos los
      // objetos: el punto puede vivir en otro objeto del escenario).
      for (const rt of fxObjetosRef.current.values()) {
        if (target === 'stars') {
          if (!rt.colocadas || rt.estrellas.length === 0) continue;
        } else if (rt.focos[target].length === 0) {
          continue;
        }
        rt.grupo.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(rt.grupo.matrixWorld).invert();
        const localRay = raycasterRef.current.ray.clone().applyMatrix4(inv);
        if (target === 'stars') {
          if (rt.colocadas && removePlacedStarAt(rt.colocadas, localRay)) {
            // Sincroniza la copia serializada con la lista de sprites.
            rt.estrellas = rt.colocadas.stars.map((s) => ({
              x: s.sprite.position.x,
              y: s.sprite.position.y,
              z: s.sprite.position.z,
              tamaño: s.tamaño,
            }));
            rt.firmaEstrellas = firmaPuntos(rt.estrellas);
            guardarEstrellasObjeto(rt);
            return;
          }
        } else if (quitarFocoObjeto(rt, target, localRay)) {
          rt.firmaFocos = firmaDeFocos(rt.focos);
          guardarFocosObjeto(rt, target);
          return;
        }
      }

      // 2) Si no se quitó nada, coloca un punto en la superficie del objeto
      // golpeado (el foco viaja con ESE objeto, no con el activo).
      const superficie = raycastObjectSurface();
      if (!superficie) return;
      const { hit, objectId } = superficie;
      if (!objectId) return;
      const rt = fxApiRef.current.runtimeDe(objectId, true);
      if (!rt) return;
      const local = rt.grupo.worldToLocal(hit.point.clone());
      if (target === 'stars') {
        addPlacedStar(rt.colocadas, local, starSizeRef.current);
        rt.estrellas.push({
          x: local.x,
          y: local.y,
          z: local.z,
          tamaño: starSizeRef.current,
        });
        rt.firmaEstrellas = firmaPuntos(rt.estrellas);
        guardarEstrellasObjeto(rt);
      } else {
        anadirFocoObjeto(rt, target, local);
        rt.firmaFocos = firmaDeFocos(rt.focos);
        guardarFocosObjeto(rt, target);
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
      target: 'object' | 'texture' | 'gizmo',
      rayToLocal?: THREE.Matrix4,
      objectQuat?: THREE.Quaternion,
      objectPos?: THREE.Vector3,
      axisWorldOverride?: THREE.Vector3,
      startPosOverride?: THREE.Vector3
    ): GizmoDrag | null => {
      // Si el gizmo fue desplazado del centro del objeto (offset activo) y
      // se rota un único objeto, el gizmo actúa como pivote: el objeto gira
      // alrededor de su posición de mundo en vez de sobre su centro. El
      // offset es LOCAL, así que al orbitar el gizmo vuelve a quedar en el
      // mismo punto de mundo (se re-deriva al render).
      let gizmoPivot: THREE.Vector3 | undefined;
      if (target === 'object' && ud.mode === 'rotate') {
        const selIdsMulti = selectedObjectIdsRef.current ?? [];
        const esMulti =
          !selectionModeRef.current && selIdsMulti.length > 1;
        if (esMulti) {
          // Multi-selección: el giro se mide desde el centro del CONJUNTO.
          // Sin giro individual el conjunto rota como UNA pieza: el activo
          // órbita alrededor de ese centro (rotatePivot) y el resto de
          // seleccionados los arrastra la misma rotación (release).
          const centro =
            startPosOverride ?? computeSelectionCenter();
          if (centro && !giroIndividualRef.current) {
            gizmoPivot = centro;
          }
        } else {
          const off = gizmoOffsetRef.current;
          if (off.px || off.py || off.pz) {
            const isSingle =
              !selectionModeRef.current &&
              (selectedObjectIdsRef.current?.length ?? 0) <= 1;
            if (isSingle) {
              const objQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(t.rx, t.ry, t.rz)
              );
              const objPos = new THREE.Vector3(t.px, t.py, t.pz);
              gizmoPivot = new THREE.Vector3(off.px, off.py, off.pz)
                .applyQuaternion(objQuat)
                .add(objPos);
            }
          }
        }
      }
      let pos: THREE.Vector3;
      if (gizmoPivot) {
        pos = gizmoPivot;
      } else if (startPosOverride) {
        pos = startPosOverride.clone();
      } else if (objectPos) {
        pos = new THREE.Vector3(t.px, t.py, t.pz).applyQuaternion(objectQuat!).add(objectPos);
      } else {
        pos = new THREE.Vector3(t.px, t.py, t.pz);
      }

      const effQuat = objectQuat
        ? objectQuat.clone().multiply(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz))
          )
        : new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz));

      const axisWorld = axisWorldOverride
        ? axisWorldOverride.clone()
        : GIZMO_AXIS_DIR[ud.axis].clone().applyQuaternion(effQuat);
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
          // Cámara mirando justo por el eje: camDir no deja componente
          // sobre el plano. Se toma un eje MUNDO perpendicular al eje del
          // aro (el fallback fijo podía quedar paralelo al aro y dejar
          // basisV de longitud cero: el ángulo moría y el drag no rotaba).
          basisU =
            Math.abs(axisWorld.x) < 0.5
              ? new THREE.Vector3(1, 0, 0)
              : new THREE.Vector3(0, 1, 0);
          // Se proyecta al plano por si el aro está inclinado.
          basisU.sub(axisWorld.clone().multiplyScalar(axisWorld.dot(basisU)));
          if (basisU.lengthSq() < 1e-6) {
            basisU =
              Math.abs(axisWorld.y) < 0.5
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(0, 0, 1);
          }
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
          startQuat: effQuat,
          startT: 0,
          plane,
          basisU,
          basisV,
          startAngle: Math.atan2(d.dot(basisV), d.dot(basisU)),
          sweptAngle: 0,
          rayToLocal,
          objectQuat,
          objectPos,
          rotatePivot: gizmoPivot,
          startObjectPos: new THREE.Vector3(t.px, t.py, t.pz),
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
          startQuat: effQuat,
          startT: 0,
          plane,
          basisU: screenUp,
          basisV: new THREE.Vector3(),
          startAngle: 0,
          rayToLocal,
          objectQuat,
          objectPos,
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
        startQuat: effQuat,
        startT: t0,
        plane: new THREE.Plane(),
        basisU: new THREE.Vector3(),
        basisV: new THREE.Vector3(),
        startAngle: 0,
        rayToLocal,
        objectQuat,
        objectPos,
      };
    };

    // Arrastre del gizmo de SUB-SELECCIÓN. mover: delta del rayo sobre la
    // línea del eje (en MUNDO; ejes siempre alineados al mundo — la
    // selección es una parte de la malla, no tiene orientación propia).
    // escalar: plano frontal a la cámara por el centroide, factor = 1 +
    // desplazamiento en pantalla (mismo criterio que el cubo blanco del
    // gizmo de objetos), pivotado en el centroide de la selección.
    const makeSelectionGizmoDrag = (
      ud: { axis: GizmoAxis; mode: 'move' | 'scale' | 'uniform-scale' },
      ray: THREE.Ray,
      camDir: THREE.Vector3,
      screenUp: THREE.Vector3,
      centroMundo: THREE.Vector3,
      recogido: { vertIdx: number[]; centroLocal: THREE.Vector3 },
      m: Mesh
    ): SelectionGizmoDrag | null => {
      if (recogido.vertIdx.length === 0) return null;
      if (ud.mode === 'scale' || ud.mode === 'uniform-scale') {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camDir.clone().negate(),
          centroMundo
        );
        const hit = new THREE.Vector3();
        if (!ray.intersectPlane(plane, hit)) return null;
        return {
          axis: ud.axis,
          mode: ud.mode,
          axisWorld:
            ud.mode === 'uniform-scale'
              ? new THREE.Vector3() // no se usa: escala los 3 ejes
              : GIZMO_AXIS_DIR[ud.axis].clone(),
          startT: 0,
          centroMundoStart: centroMundo.clone(),
          plane,
          basisU: screenUp.clone(),
          vertOriginales: m.vertices.map((v) => ({ ...v })),
          vertIdx: recogido.vertIdx,
          centroLocal: recogido.centroLocal.clone(),
        };
      }
      const axisWorld = GIZMO_AXIS_DIR[ud.axis].clone();
      const t0 = closestPointOnAxis(ray, centroMundo, axisWorld);
      if (t0 === null) return null;
      return {
        axis: ud.axis,
        mode: 'move',
        axisWorld,
        startT: t0,
        centroMundoStart: centroMundo.clone(),
        plane: new THREE.Plane(),
        basisU: new THREE.Vector3(),
        vertOriginales: m.vertices.map((v) => ({ ...v })),
        vertIdx: recogido.vertIdx,
        centroLocal: recogido.centroLocal.clone(),
      };
    };

     const onPointerDown = (e: PointerEvent) => {
       if (placeTargetRef.current) {
         // Registrar el punto inicial: solo coloca si NO hubo arrastre
         // (así girar la cámara con arrastre no coloca estrellas).
         placeDownRef.current = { x: e.clientX, y: e.clientY };
         return;
       }

      // Modo grabación: armar el posible arrastre de cámara AL PRINCIPIO.
      // Los drags de gizmo, asas, textura, caras o vértices quedan excluidos
      // por sus refs en el pointermove (no marcan «moved») y los modos de
      // selección no llegan a armar. Un arrastre sobre el cuerpo de la
      // cámara-objeto también cuenta: es el gesto de moverla.
      if (
        grabacionActivaRef.current &&
        e.button === 0 &&
        !recDownRef.current &&
        !selectionModeRef.current &&
        !faceSelectModeRef.current
      ) {
        recDownRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }

        // --- Face selection: start drag ---
         if (faceSelectModeRef.current && !gizmoDragRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();

          // --- Gizmo de la sub-selección: interceptar el gesto ANTES de
          // las herramientas (con la forma del polígono en curso no: el
          // clic es de cierre o de punto nuevo).
          const poligEnCurso =
            faceSelectionToolRef.current === 'poligono' &&
            faceSelectionPointsRef.current.length > 0;
          const mSel = meshRef.current;
          const meshObjSel = findMainMesh(meshGroupRef.current);
          if (
            !poligEnCurso &&
            mSel &&
            meshObjSel &&
            selectionGizmoGroupRef.current?.visible
          ) {
            pointerRef.current.x =
              ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointerRef.current.y =
              -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycasterRef.current.setFromCamera(pointerRef.current, camera);
            const hitsSel = raycasterRef.current.intersectObjects(
              selectionGizmoHandlesRef.current,
              false
            );
            const udSel = hitsSel[0]?.object
              .userData as { axis?: GizmoAxis; mode?: SelectionGizmoDrag['mode'] };
            if (
              hitsSel.length > 0 &&
              udSel?.axis &&
              udSel.mode
            ) {
              // Modo configuración del gizmo (gris): arrastrar una asa
              // MUEVE EL GIZMO de sitio (su offset de mundo), no la
              // selección — igual que el gizmo de objetos. Flecha/bola:
              // sigue su eje; cubo central: libre en el plano de vista.
              if (!selGizmoInteractiveRef.current) {
                const gizmoGrSel = selectionGizmoGroupRef.current;
                const gizmoPosSel = gizmoGrSel
                  ? gizmoGrSel.position.clone()
                  : hitsSel[0].object.getWorldPosition(new THREE.Vector3());
                const udAsaSel = hitsSel[0].object.userData as {
                  axis?: GizmoAxis;
                  mode?: string;
                };
                const ejeSel: GizmoAxis | null =
                  (udAsaSel.mode === 'move' || udAsaSel.mode === 'scale') && udAsaSel.axis
                    ? udAsaSel.axis
                    : null;
                const camDirSel = new THREE.Vector3();
                camera.getWorldDirection(camDirSel);
                selGizmoOffsetDragRef.current = {
                  axis: ejeSel,
                  axisDir: ejeSel ? GIZMO_AXIS_DIR[ejeSel].clone() : new THREE.Vector3(),
                  startPos: gizmoPosSel,
                  plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
                    camDirSel.clone().negate(),
                    gizmoPosSel
                  ),
                  startT: ejeSel
                    ? (closestPointOnAxis(raycasterRef.current.ray, gizmoPosSel, GIZMO_AXIS_DIR[ejeSel]) ?? 0)
                    : 0,
                  startOffset: selGizmoOffsetRef.current.clone(),
                };
                controls.enabled = false;
                renderer.domElement.style.cursor = 'grabbing';
                return;
              }
              meshObjSel.updateWorldMatrix(true, false);
              let recogidoSel = collectSelectionVerts(
                mSel,
                faceSelectionTargetRef.current,
                selectedFaceIdsRef.current,
                selectedVertexIdsRef.current,
                selectedEdgeIdsRef.current
              );
              let mArrastre = mSel;
              // CTRL AL ESCALAR = EXTRUDIR (estilo Blender): el editor
              // duplica la selección con sus paredes casi en el sitio; el
              // arrastre escala la COPIA y los anillos vecinos (arriba/
              // abajo/lados) no se estiran por los vértices compartidos.
              if (
                (udSel.mode === 'scale' || udSel.mode === 'uniform-scale') &&
                e.ctrlKey &&
                recogidoSel.vertIdx.length > 0
              ) {
                const resCtrl = onCtrlEscalarSubSelRef.current?.() ?? null;
                if (resCtrl) {
                  // Solo los DUPLICADOS de la selección se escalan: los
                  // vértices originales siguen siendo de las caras vecinas.
                  const vertIdx = recogidoSel.vertIdx
                    .map((idx) => resCtrl.vmap.get(idx))
                    .filter((idx): idx is number => idx !== undefined);
                  let centroLocal = new THREE.Vector3();
                  for (const idx of vertIdx) {
                    const v = resCtrl.mesh.vertices[idx];
                    if (!v) continue;
                    centroLocal.x += v.x;
                    centroLocal.y += v.y;
                    centroLocal.z += v.z;
                  }
                  if (vertIdx.length > 0) centroLocal.divideScalar(vertIdx.length);
                  else centroLocal.copy(recogidoSel.centroLocal);
                  recogidoSel = { vertIdx, centroLocal };
                  mArrastre = resCtrl.mesh;
                }
              }
              const centroMundo = recogidoSel.centroLocal
                .clone()
                .applyMatrix4(meshObjSel.matrixWorld);
              const camDirSel = new THREE.Vector3();
              camera.getWorldDirection(camDirSel);
              const screenUpSel = camera.up
                .clone()
                .applyQuaternion(camera.quaternion)
                .normalize();
              const dragSel = makeSelectionGizmoDrag(
                udSel as { axis: GizmoAxis; mode: SelectionGizmoDrag['mode'] },
                raycasterRef.current.ray,
                camDirSel,
                screenUpSel,
                centroMundo,
                recogidoSel,
                mArrastre
              );
              if (dragSel) {
                selectionGizmoDragRef.current = dragSel;
                controls.enabled = false;
                renderer.domElement.style.cursor = 'grabbing';
                // El resaltado de hover se apaga al arrastrar.
                hoverElementRef.current = null;
                hoverKeyRef.current = '';
                return;
              }
            }
          }

          // --- Polígono: añadir vértices con clics, cerrar/cancelar ---
          if (faceSelectionToolRef.current === 'poligono') {
            const polig = faceSelectionPointsRef.current;
            if (e.button !== 0 && e.button !== 2) return;
            // Clic derecho: cancela la forma en curso (sin seleccionar).
            if (e.button === 2) {
              if (polig.length > 0) {
                polig.length = 0;
                if (faceSelectionPolyDivRef.current) faceSelectionPolyDivRef.current.style.display = 'none';
                if (faceSelectionLineRef.current) faceSelectionLineRef.current.style.display = 'none';
              }
              return;
            }
            // Cierre: clic dentro del radio del PRIMER vértice con ≥3 lados.
            if (polig.length >= 3 && Math.hypot(e.clientX - polig[0].x, e.clientY - polig[0].y) <= POLIGONO_CIERRE_PX) {
              poligonoCerradaRef.current = polig.slice();
              polig.length = 0;
              // El pointerup es quien aplica la selección (y devuelve aquí
              // sin filtrar al resto de la lógica de clics).
              faceSelectionStartRef.current = { x: e.clientX, y: e.clientY, rect };
              controls.enabled = false;
              renderer.domElement.style.cursor = 'crosshair';
              if (faceSelectionPolyDivRef.current) faceSelectionPolyDivRef.current.style.display = 'none';
              if (faceSelectionLineRef.current) faceSelectionLineRef.current.style.display = 'none';
              return;
            }
            // Punto nuevo: aseguramos el SVG del polígono y crece la forma.
            polig.push({ x: e.clientX, y: e.clientY });
            poligonoCerradaRef.current = null;
            const mountElP = mountRef.current;
            if (mountElP && !faceSelectionPolyDivRef.current) {
              const svgNS = 'http://www.w3.org/2000/svg';
              const svg = document.createElementNS(svgNS, 'svg');
              svg.style.position = 'absolute';
              svg.style.top = '0';
              svg.style.left = '0';
              svg.style.width = '100%';
              svg.style.height = '100%';
              svg.style.pointerEvents = 'none';
              svg.style.zIndex = '10';
              const poly = document.createElementNS(svgNS, 'polygon');
              poly.setAttribute('fill', 'rgba(6, 183, 163, 0.15)');
              poly.setAttribute('stroke', '#06b7a3');
              poly.setAttribute('stroke-width', '1');
              svg.appendChild(poly);
              mountElP.appendChild(svg);
              faceSelectionPolyDivRef.current = poly;
            }
            if (mountElP && !faceSelectionLineRef.current) {
              const svgNS = 'http://www.w3.org/2000/svg';
              const svg = document.createElementNS(svgNS, 'svg');
              svg.style.position = 'absolute';
              svg.style.top = '0';
              svg.style.left = '0';
              svg.style.width = '100%';
              svg.style.height = '100%';
              svg.style.pointerEvents = 'none';
              svg.style.zIndex = '10';
              const line = document.createElementNS(svgNS, 'line');
              line.setAttribute('stroke', '#06b7a3');
              line.setAttribute('stroke-width', '1.5');
              line.setAttribute('stroke-dasharray', '4 3');
              svg.appendChild(line);
              mountElP.appendChild(svg);
              faceSelectionLineRef.current = line;
            }
            // Dibuja ya la forma (sin esperar al move) para que el punto
            // nuevo se vea con su segmento hacia el cursor.
            const canvasRectP = renderer.domElement.getBoundingClientRect();
            const poly = faceSelectionPolyDivRef.current;
            const lineEl = faceSelectionLineRef.current;
            if (poly && poly.parentElement && lineEl) {
              poly.parentElement.style.display = 'block';
              poly.style.display = 'block';
              poly.setAttribute(
                'points',
                polig
                  .map((p) => `${p.x - canvasRectP.left},${p.y - canvasRectP.top}`)
                  .join(' ')
              );
              const ultimo = polig[polig.length - 1];
              lineEl.style.display = 'block';
              lineEl.setAttribute('x1', String(ultimo.x - canvasRectP.left));
              lineEl.setAttribute('y1', String(ultimo.y - canvasRectP.top));
              lineEl.setAttribute('x2', String(e.clientX - canvasRectP.left));
              lineEl.setAttribute('y2', String(e.clientY - canvasRectP.top));
            }
            return;
          }
          // Cambio de herramienta desde polígono: limpiar la forma en curso.
          if (faceSelectionPointsRef.current.length > 0) {
            faceSelectionPointsRef.current.length = 0;
            poligonoCerradaRef.current = null;
            if (faceSelectionPolyDivRef.current) faceSelectionPolyDivRef.current.style.display = 'none';
          }

          // ¿El pointer está sobre un elemento ya seleccionado? Entonces
          // el gesto es MOVER la selección (y no dibujar una figura):
          // arrastre en el plano frontal a la cámara, emitiendo los
          // vértices desplazados por onVerticesChange.
          const mNow = meshRef.current;
          const meshGroupForMove = meshGroupRef.current;
          const meshObjForMove = findMainMesh(meshGroupForMove);
          if (mNow && meshObjForMove) {
            meshObjForMove.updateWorldMatrix(true, false);
            const worldMatrixMove = meshObjForMove.matrixWorld;
            pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycasterRef.current.setFromCamera(pointerRef.current, camera);

            // Puntos de anclaje por objetivo: centroides de caras,
            // posiciones de vértices o puntos medios de segmentos.
            const targetMove = faceSelectionTargetRef.current;
            const anchors: Array<{ world: THREE.Vector3; idx: number }> = [];
            const vertIdxSet = new Set<number>();
            if (targetMove === 'cara') {
              const sel = selectedFaceIdsRef.current;
              if (sel.length > 0) {
                const centroids = computeFaceCentroids(mNow, worldMatrixMove);
                for (const f of sel) {
                  const c = centroids[f];
                  if (c) anchors.push({ world: c, idx: f });
                }
                for (const f of sel) {
                  const face = mNow.faces[f];
                  if (face) {
                    for (const vi of face) {
                      getVertexGroup(mNow, vi).forEach(v => vertIdxSet.add(v));
                    }
                  }
                }
              }
            } else if (targetMove === 'vertice') {
              for (const vi of selectedVertexIdsRef.current) {
                const v = mNow.vertices[vi];
                if (!v) continue;
                anchors.push({
                  world: new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrixMove),
                  idx: vi,
                });
                getVertexGroup(mNow, vi).forEach(vGroup => vertIdxSet.add(vGroup));
              }
            } else {
              for (const edge of deriveMeshEdges(mNow)) {
                if (!selectedEdgeIdsRef.current.includes(edge.key)) continue;
                const va = mNow.vertices[edge.a];
                const vb = mNow.vertices[edge.b];
                if (!va || !vb) continue;
                anchors.push({
                  world: new THREE.Vector3((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2)
                    .applyMatrix4(worldMatrixMove),
                  idx: edge.a,
                });
                getVertexGroup(mNow, edge.a).forEach(v => vertIdxSet.add(v));
                getVertexGroup(mNow, edge.b).forEach(v => vertIdxSet.add(v));
              }
            }

            // Ancla más cercano en pantalla; si está a <14 px, agarrar.
            // Con MAYÚS no se agarra: Mayús+clic es DESELECCIONAR (el
            // usuario lo pidió), y el mouseup de selección se encarga.
            let grabbed: { world: THREE.Vector3 } | null = null;
            let bestDist = Infinity;
            for (const anchor of anchors) {
              const screenPt = projectToScreen(anchor.world, camera, rect);
              if (!screenPt) continue;
              const d = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
              if (d < bestDist) {
                bestDist = d;
                grabbed = anchor;
              }
            }
            if (grabbed && bestDist < 14 && vertIdxSet.size > 0 && !e.shiftKey) {
              const camDir = new THREE.Vector3();
              camera.getWorldDirection(camDir);
              const plane = new THREE.Plane();
              plane.setFromNormalAndCoplanarPoint(
                camDir.clone().negate(),
                grabbed.world
              );
              const worldStart = new THREE.Vector3();
              if (raycasterRef.current.ray.intersectPlane(plane, worldStart)) {
                const invMatrix = new THREE.Matrix4()
                  .copy(worldMatrixMove)
                  .invert();
                const localStart = worldStart.clone().applyMatrix4(invMatrix);
                faceMoveDragRef.current = {
                  plane,
                  worldStart,
                  localStart,
                  originalVerts: mNow.vertices.map((v) => ({ ...v })),
                  vertIdx: [...vertIdxSet],
                };
                controls.enabled = false;
                renderer.domElement.style.cursor = 'grabbing';
                return;
              }
            }
          }

          // --- DIRECTO (los botones Polígono/Aristas/Puntos): el clic
          // elige el ELEMENTO BAJO EL CURSOR, sin marco ni forma intermedia.
          // Sobre un elemento ya seleccionado y sin teclas NO se llega aquí
          // (el agarre de arriba lo convierte en arrastre de mover). ---
          if (faceSelectionToolRef.current === 'directo') {
            if (e.button !== 0) return; // solo el clic izquierdo pincha
            const mDir = meshRef.current;
            const meshObjDir = findMainMesh(meshGroupRef.current);
            const elegido = mDir && meshObjDir
              ? pickSubElemento(
                  mDir,
                  meshObjDir,
                  camera,
                  e.clientX,
                  e.clientY,
                  rect,
                  faceSelectionTargetRef.current,
                  faceSelectVisibleOnlyRef.current,
                  faceAnillosRef.current // herramienta 'directo': anillos activables
                )
              : null;
            const targetDir = faceSelectionTargetRef.current;
            const toggle = !!e.shiftKey || !!e.ctrlKey || !!e.metaKey;
            if (elegido) {
              if (targetDir === 'cara') {
                const prev = selectedFaceIdsRef.current ?? [];
                // Modo anillos: el clic elige el ANILLO completo que el
                // hover ya señala; sin anillos, el grupo de coplanares.
                const faceGroup =
                  elegido.anillos && elegido.anillos.length > 0
                    ? elegido.anillos
                    : getFaceGroup(mDir!, elegido.id as number);
                const yaEstaba = faceGroup.some(f => prev.includes(f));
                const nuevos = toggle
                  ? yaEstaba
                    ? prev.filter((f) => !faceGroup.includes(f))
                    : [...prev, ...faceGroup]
                  : [...faceGroup];
                onFaceSelectionChangeRef.current?.(nuevos);
                selectedFaceIdsRef.current = nuevos;
              } else if (targetDir === 'vertice') {
                const prev = selectedVertexIdsRef.current ?? [];
                const vertexGroup = getVertexGroup(mDir!, elegido.id as number);
                const yaEstaba = vertexGroup.some(v => prev.includes(v));
                const nuevos = toggle
                  ? yaEstaba
                    ? prev.filter((f) => !vertexGroup.includes(f))
                    : [...prev, ...vertexGroup]
                  : [...vertexGroup];
                onVertexSelectionChangeRef.current?.(nuevos);
                selectedVertexIdsRef.current = nuevos;
              } else {
                const prev = selectedEdgeIdsRef.current ?? [];
                const edgeGroup = getEdgeGroup(mDir!, String(elegido.id));
                const yaEstaba = edgeGroup.some(e => prev.includes(e));
                const nuevos = toggle
                  ? yaEstaba
                    ? prev.filter((k) => !edgeGroup.includes(k))
                    : [...prev, ...edgeGroup]
                  : [...edgeGroup];
                onEdgeSelectionChangeRef.current?.(nuevos);
                selectedEdgeIdsRef.current = nuevos;
              }
            } else if (!toggle) {
              // Clic al vacío: limpia la selección del objetivo activo.
              if (targetDir === 'cara') {
                onFaceSelectionChangeRef.current?.([]);
                selectedFaceIdsRef.current = [];
              } else if (targetDir === 'vertice') {
                onVertexSelectionChangeRef.current?.([]);
                selectedVertexIdsRef.current = [];
              } else {
                onEdgeSelectionChangeRef.current?.([]);
                selectedEdgeIdsRef.current = [];
              }
            }
            // El gizmo se re-anclea en el animate a la nueva selección.
            hoverElementRef.current = null;
            hoverKeyRef.current = '';
            return;
          }

          faceSelectionStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            rect,
          };
          controls.enabled = false;
          renderer.domElement.style.cursor = 'crosshair';

          // Create / ensure HTML overlays for selection shapes
           const mountEl = mountRef.current;
           if (mountEl) {
            if (!faceSelectionRectDivRef.current) {
              const div = document.createElement('div');
              div.style.position = 'absolute';
              div.style.border = '1px dashed #06b7a3';
              div.style.backgroundColor = 'rgba(6, 183, 163, 0.15)';
              div.style.pointerEvents = 'none';
              div.style.zIndex = '10';
              div.style.display = 'none';
              mountEl.appendChild(div);
              faceSelectionRectDivRef.current = div;
            } else if (!faceSelectionRectDivRef.current.parentElement) {
              mountEl.appendChild(faceSelectionRectDivRef.current);
            }
            if (!faceSelectionCircleDivRef.current) {
              const div = document.createElement('div');
              div.style.position = 'absolute';
              div.style.border = '1px dashed #06b7a3';
              div.style.backgroundColor = 'rgba(6, 183, 163, 0.15)';
              div.style.borderRadius = '50%';
              div.style.pointerEvents = 'none';
              div.style.zIndex = '10';
              div.style.display = 'none';
              mountEl.appendChild(div);
              faceSelectionCircleDivRef.current = div;
            } else if (!faceSelectionCircleDivRef.current.parentElement) {
              mountEl.appendChild(faceSelectionCircleDivRef.current);
            }
            if (!faceSelectionPolyDivRef.current) {
              const svgNS = 'http://www.w3.org/2000/svg';
              const svg = document.createElementNS(svgNS, 'svg');
              svg.style.position = 'absolute';
              svg.style.top = '0';
              svg.style.left = '0';
              svg.style.width = '100%';
              svg.style.height = '100%';
              svg.style.pointerEvents = 'none';
              svg.style.zIndex = '10';
              const poly = document.createElementNS(svgNS, 'polygon');
              poly.setAttribute('fill', 'rgba(6, 183, 163, 0.15)');
              poly.setAttribute('stroke', '#06b7a3');
              poly.setAttribute('stroke-width', '1');
              svg.appendChild(poly);
              mountEl.appendChild(svg);
              faceSelectionPolyDivRef.current = poly;
            }
            if (!faceSelectionLineRef.current) {
              const svgNS = 'http://www.w3.org/2000/svg';
              const svg = document.createElementNS(svgNS, 'svg');
              svg.style.position = 'absolute';
              svg.style.top = '0';
              svg.style.left = '0';
              svg.style.width = '100%';
              svg.style.height = '100%';
              svg.style.pointerEvents = 'none';
              svg.style.zIndex = '10';
              const line = document.createElementNS(svgNS, 'line');
              line.setAttribute('stroke', '#06b7a3');
              line.setAttribute('stroke-width', '1.5');
              svg.appendChild(line);
              mountEl.appendChild(svg);
              faceSelectionLineRef.current = line;
            }
          }
          return;
        }

        // --- Rubber-band selection ---
        if (selectionModeRef.current && !gizmoDragRef.current) {
         const rect = renderer.domElement.getBoundingClientRect();
         selectionStartRef.current = {
           x: e.clientX,
           y: e.clientY,
           rect,
         };
         controls.enabled = false;
         renderer.domElement.style.cursor = 'crosshair';
         // Create selection rectangle overlay
         if (!selectionRectRef.current) {
           const selDiv = document.createElement('div');
           selDiv.style.position = 'absolute';
           selDiv.style.border = '1px dashed #38bdf8';
           selDiv.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
           selDiv.style.pointerEvents = 'none';
           selDiv.style.zIndex = '10';
           selDiv.style.display = 'none';
           mountRef.current?.appendChild(selDiv);
           selectionRectRef.current = selDiv;
         } else if (!selectionRectRef.current.parentElement) {
           mountRef.current?.appendChild(selectionRectRef.current);
         }
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

      // Manipulador: si el clic cae sobre un asa, empiece su arrastre (si es
      // interactivo) o, si no lo es (modo configuración), consume el click
      // para que no caiga en los controles de órbita y gire la escena.
      if (gizmoOnRef.current && gizmoGroupRef.current?.visible) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hits = raycasterRef.current.intersectObjects(
          gizmoHandlesRef.current.filter((h) => h.visible),
          false
        );
        if (hits.length > 0) {
          const ud = hits[0].object.userData as {
            axis: GizmoAxis;
            mode: 'move' | 'scale' | 'uniform-scale' | 'planar-scale' | 'rotate';
          };
          // En modo no interactivo (configuración): arrastrar el gizmo
          // modifica SU offset, no el objeto. Se consume el click para
          // bloquear los controles de órbita.
          if (!gizmoInteractiveRef.current) {
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            const screenUp = camera.up
              .clone()
              .applyQuaternion(camera.quaternion)
              .normalize();

            // El eje REAL del gizmo, tal como está pintado: extraído de su
            // matriz mundial. Así el arrastre siempre coincide con lo que se
            // ve, sin recomponer rotaciones a mano.
            const gizmoGroup = gizmoGroupRef.current;
            const gizmoWorldQuat = new THREE.Quaternion();
            const gizmoWorldPos = new THREE.Vector3();
             if (gizmoGroup) {
               gizmoGroup.updateWorldMatrix(true, true);
               gizmoGroup.matrixWorld.decompose(gizmoWorldPos, gizmoWorldQuat, new THREE.Vector3());
             }
            const axisWorldOverride = GIZMO_AXIS_DIR[ud.axis]
              .clone()
              .applyQuaternion(gizmoWorldQuat);

            const objT = transformRef.current;
            const objectQuat = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(objT.rx, objT.ry, objT.rz)
            );
            const objectPos = new THREE.Vector3(objT.px, objT.py, objT.pz);

            const drag = makeGizmoDrag(
              ud,
              gizmoOffsetRef.current,
              raycasterRef.current.ray,
              camDir,
              screenUp,
              'gizmo',
              undefined,
              objectQuat,
              objectPos,
              axisWorldOverride,
              gizmoWorldPos
            );
            if (!drag) return;
            gizmoDragRef.current = drag;
            controls.enabled = false;
            renderer.domElement.style.cursor = 'grabbing';
            return;
          }
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const screenUp = camera.up
            .clone()
            .applyQuaternion(camera.quaternion)
            .normalize();
          // El eje REAL del gizmo, tal como se dibuja: si el offset del
          // gizmo lleva rotación (modo configuración), las flechas
          // salen giradas y el arrastre del objeto debe seguir ESA
          // dirección, no la del objeto, para que la figura vaya adonde
          // apunta la flecha.
          const gizmoGroupForDrag = gizmoGroupRef.current;
          const gizmoWorldQuatForDrag = new THREE.Quaternion();
          if (gizmoGroupForDrag) {
            gizmoGroupForDrag.updateWorldMatrix(true, true);
            gizmoGroupForDrag.matrixWorld.decompose(
              new THREE.Vector3(),
              gizmoWorldQuatForDrag,
              new THREE.Vector3()
            );
          }
          const objectAxisOverride = GIZMO_AXIS_DIR[ud.axis]
            .clone()
            .applyQuaternion(gizmoWorldQuatForDrag);
          // Multi-selección: centro del CONJUNTO seleccionado. En rotación
          // es el pivote del giro (plano del anillo); en mover/escalar solo
          // ancla el gizmo durante el gesto.
          const selIdsMulti = selectedObjectIdsRef.current ?? [];
          const esMulti =
            !selectionModeRef.current && selIdsMulti.length > 1;
          const centroMulti = esMulti ? computeSelectionCenter() : undefined;
          const drag = makeGizmoDrag(
            ud,
            transformRef.current,
            raycasterRef.current.ray,
            camDir,
            screenUp,
            'object',
            undefined,
            undefined,
            undefined,
            objectAxisOverride,
            ud.mode === 'rotate' ? (centroMulti ?? undefined) : undefined
          );
          if (!drag) return;
          if (centroMulti) drag.multiCenter = centroMulti;
          // Store initial transforms of all selected objects for multi-transform
          const selIds = selectedObjectIdsRef.current ?? [];
          multiTransformStartRef.current = {};
          for (const obj of objectsRef.current ?? []) {
            if (selIds.includes(obj.id)) {
              multiTransformStartRef.current[obj.id] = { ...obj.transform };
            }
          }
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
          textureHelperHandlesRef.current.filter((h) => h.visible),
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
      // Asas del recorrido de la cámara-objeto: arrastrar el fotograma
      // (cian) o el foco del fotograma seleccionado (naranja) en el plano
      // perpendicular a la vista.
      if (
        cameraObjectPathRef.current?.group.visible &&
        !activeCameraRef.current
      ) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const asaHits = raycasterRef.current.intersectObjects(
          cameraObjectPathRef.current.handles.children,
          true
        );
        if (asaHits.length > 0) {
          let asa: THREE.Object3D | null = asaHits[0].object;
          while (
            asa &&
            asa.userData.cameraKeyframe === undefined &&
            !asa.userData.cameraTarget
          ) {
            asa = asa.parent;
          }
          if (asa) {
            const esTarget = !!asa.userData.cameraTarget;
            const punto = asa.getWorldPosition(new THREE.Vector3());
            const normal = camera
              .getWorldDirection(new THREE.Vector3())
              .negate();
            cameraPathDragRef.current = {
              kind: esTarget ? 'target' : 'keyframe',
              index: (asa.userData.cameraKeyframe as number) ?? 0,
              plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
                normal,
                punto
              ),
              startPos: punto.clone(),
              original: punto.clone(),
            };
            controls.enabled = false;
            renderer.domElement.style.cursor = 'grabbing';
            return;
          }
        }
      }
      // Asas del recorrido del objeto (editor de movimiento): mismo
      // arrastre en plano perpendicular a la vista que las de la cámara.
      if (objectMotionPathRef.current?.group.visible) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const asaHits = raycasterRef.current.intersectObjects(
          objectMotionPathRef.current.handles.children,
          true
        );
        if (asaHits.length > 0) {
          let asa: THREE.Object3D | null = asaHits[0].object;
          while (asa && asa.userData.motionKeyframe === undefined) {
            asa = asa.parent;
          }
          if (asa) {
            const punto = asa.getWorldPosition(new THREE.Vector3());
            const normal = camera
              .getWorldDirection(new THREE.Vector3())
              .negate();
            motionPathDragRef.current = {
              index: asa.userData.motionKeyframe as number,
              plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
                normal,
                punto
              ),
              startPos: punto.clone(),
              original: punto.clone(),
            };
            controls.enabled = false;
            renderer.domElement.style.cursor = 'grabbing';
            return;
          }
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
          // Los objetos CONGELADOS no se pueden seleccionar: el clic pasa
          // de largo hasta la figura no congelada que quede detrás.
          const esCongelado = (id: string) =>
            (objectsRef.current ?? []).find((o) => o.id === id)?.frozen === true;
          for (const objectHit of objectHits) {
            let seleccionado: THREE.Object3D | null = objectHit.object;
            while (seleccionado && !seleccionado.userData.sceneObjectId) {
              seleccionado = seleccionado.parent;
            }
            const id = seleccionado?.userData.sceneObjectId;
            if (!id || esCongelado(id)) continue;
            onObjectSelectRef.current?.(id);
            if (id !== selectedObjectIdRef.current) return;
            break;
          }
        }
      }
      if (!showVerticesRef.current) return;
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
          // Los objetos congelados no admiten edición de vértices.
          const pid = selectedObject.userData.sceneObjectId;
          const congelado = (objectsRef.current ?? []).find(
            (o) => o.id === pid
          )?.frozen;
          if (congelado) return;
          onObjectSelectRef.current?.(pid);
          if (!showVerticesRef.current) return;
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
        // --- Modo grabación: capturar al soltar ---
        if (recDownRef.current) {
          const movido = recDownRef.current.moved;
          recDownRef.current = null;
          if (
            grabacionActivaRef.current &&
            movido &&
            onGrabacionCapturaRef.current
          ) {
            // La pose de la vista grabando: cámara + pivote de órbita (la
            // cámara mira siempre a controls.target mientras OrbitControls
            // orbita y panea) + FOV actual.
            onGrabacionCapturaRef.current({
              position: {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
              },
              target: {
                x: controls.target.x,
                y: controls.target.y,
                z: controls.target.z,
              },
              fov: camera.fov,
            });
          }
        }
        // --- Mover selección: soltar ---
        if (faceMoveDragRef.current) {
          // Emisión final: el último frame pudo quedar throttled.
          const move = faceMoveDragRef.current;
          if (move.latestVerts) {
            onVerticesChangeRef.current?.(move.latestVerts);
          } else if (e.ctrlKey || e.shiftKey) {
            // Ctrl/Mayús+clic SIN arrastrar sobre la selección: quitar la
            // cara pinchada. Sin esto el agarre de movimiento se come el
            // clic y no se puede reducir una a una dentro de la selección.
            const mClic = meshRef.current;
            const meshObjClic = findMainMesh(meshGroupRef.current);
            if (mClic && meshObjClic && mClic.faces.length > 0) {
              meshGroupRef.current?.updateMatrixWorld();
              meshObjClic.updateWorldMatrix(true, false);
              const worldMatrix = meshObjClic.matrixWorld;
              const rectClic = renderer.domElement.getBoundingClientRect();
              const ray = new THREE.Raycaster();
              ray.setFromCamera(
                new THREE.Vector2(
                  ((e.clientX - rectClic.left) / rectClic.width) * 2 - 1,
                  -((e.clientY - rectClic.top) / rectClic.height) * 2 + 1
                ),
                camera
              );
              const hits = ray.intersectObject(meshObjClic, false);
              if (hits.length > 0) {
                const puntoHit = hits[0].point;
                const centroids = computeFaceCentroids(mClic, worldMatrix);
                let mejorIdx = -1;
                let mejorDist = Infinity;
                for (let i = 0; i < centroids.length; i++) {
                  const d = centroids[i].distanceTo(puntoHit);
                  if (d < mejorDist) { mejorDist = d; mejorIdx = i; }
                }
                if (mejorIdx >= 0) {
                  const prev = selectedFaceIdsRef.current ?? [];
                  // Quitar lo mismo que el hover señala: la cara del grupo
                  // coplanar, o el ANILLO entero si el modo está activo.
                  const grupoQuitar = faceAnillosRef.current
                    ? pickSubElemento(
                        mClic,
                        meshObjClic,
                        camera,
                        e.clientX,
                        e.clientY,
                        rectClic,
                        'cara',
                        faceSelectVisibleOnlyRef.current,
                        true
                      )?.anillos ?? getFaceGroup(mClic, mejorIdx)
                    : [mejorIdx];
                  if (prev.includes(mejorIdx)) {
                    const nuevos = prev.filter((f) => !grupoQuitar.includes(f));
                    onFaceSelectionChangeRef.current?.(nuevos);
                    selectedFaceIdsRef.current = nuevos;
                  }
                }
              }
            }
          }
          faceMoveDragRef.current = null;
          controls.enabled = true;
          renderer.domElement.style.cursor = '';
          return;
        }

        // --- Gizmo de sub-selección (modo configuración): soltar ---------
        if (selGizmoOffsetDragRef.current) {
          // Emisión final: el último pointermove pudo quedar sin emitir.
          onSelGizmoOffsetChangeRef.current?.({
            x: selGizmoOffsetRef.current.x,
            y: selGizmoOffsetRef.current.y,
            z: selGizmoOffsetRef.current.z,
          });
          selGizmoOffsetDragRef.current = null;
          controls.enabled = true;
          renderer.domElement.style.cursor = '';
          return;
        }

        // --- Gizmo de sub-selección: soltar -------------------------------
        if (selectionGizmoDragRef.current) {
          // Emisión final: el último frame pudo quedar throttled.
          const selDrag = selectionGizmoDragRef.current;
          if (selDrag.latestVerts) {
            onVerticesChangeRef.current?.(selDrag.latestVerts);
          }
          selectionGizmoDragRef.current = null;
          // El centroide del gizmo se re-deduce con los vértices ya movidos.
          selectionKeyRef.current = '';
          controls.enabled = true;
          renderer.domElement.style.cursor = '';
          return;
        }

        // --- Face selection: finalize ---
        if (faceSelectionStartRef.current && faceSelectModeRef.current) {
          const start = faceSelectionStartRef.current;
          faceSelectionStartRef.current = null;
          controls.enabled = true;
          renderer.domElement.style.cursor = '';

          // Hide HTML overlays
          if (faceSelectionRectDivRef.current) faceSelectionRectDivRef.current.style.display = 'none';
          if (faceSelectionCircleDivRef.current) faceSelectionCircleDivRef.current.style.display = 'none';
          if (faceSelectionPolyDivRef.current) faceSelectionPolyDivRef.current.style.display = 'none';
          if (faceSelectionLineRef.current) faceSelectionLineRef.current.style.display = 'none';

          const m = meshRef.current;
          if (!m) return;

          // Get the world matrix of the mesh object in the scene
          const meshGroup = meshGroupRef.current;
          if (!meshGroup) return;
          meshGroup.updateMatrixWorld();
          const meshObj = findMainMesh(meshGroup);
          if (!meshObj) return;
          meshObj.updateWorldMatrix(true, false);
          const worldMatrix = meshObj.matrixWorld;

          const rect = renderer.domElement.getBoundingClientRect();
          const tool = faceSelectionToolRef.current;
          const target = faceSelectionTargetRef.current;

          // Polígono cerrado en este gesto (se vacía para el siguiente): el
          // clic de cierre casi no se mueve, así que NO cuenta como «clic
          // simple» — el área de la forma manda.
          const poligonoCerrada =
            tool === 'poligono' && poligonoCerradaRef.current
              ? poligonoCerradaRef.current
              : null;
          poligonoCerradaRef.current = null;

          // La prueba de la herramienta sobre un punto de pantalla,
          // unificada para los cuatro objetivos (el polígono: ray-casting
          // sobre los vértices de la forma; la línea: puntos a <12 px del
          // segmento dibujado).
          const insideShape = (screenPt: { x: number; y: number }): boolean => {
            if (tool === 'rectangle') {
              const x1 = Math.min(start.x, e.clientX);
              const y1 = Math.min(start.y, e.clientY);
              const x2 = Math.max(start.x, e.clientX);
              const y2 = Math.max(start.y, e.clientY);
              return isPointInRect(screenPt.x, screenPt.y, x1, y1, x2, y2);
            }
            if (tool === 'circle') {
              const radius = Math.sqrt(
                (e.clientX - start.x) ** 2 + (e.clientY - start.y) ** 2
              );
              return isPointInCircle(screenPt.x, screenPt.y, start.x, start.y, radius);
            }
            if (tool === 'poligono') {
              if (!poligonoCerrada || poligonoCerrada.length < 3) return false;
              return isPointInPolygon(screenPt.x, screenPt.y, poligonoCerrada);
            }
            // line
            return distanceToSegment(
              screenPt.x, screenPt.y,
              start.x, start.y, e.clientX, e.clientY
            ) <= FACE_LINE_TOLERANCE;
          };
          // Las herramientas de ÁREA (rectángulo/círculo/polígono) piden
          // contención COMPLETA: el usuario no quiere caras cogidas «por la
          // mitad». La línea se queda con su regla de cercanía al segmento.
          const pruebaArea = tool !== 'line';

          // Clic casi sin arrastre: elegir el elemento más cercano al
          // puntero (un rectángulo de tamaño cero no atraparía nada). En el
          // polígono NO hay clic simple: el clic de cierre aplica el área.
          const clicSimple =
            !poligonoCerrada &&
            Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4;
          // Teclas acumuladoras: Ctrl AÑADE la nueva selección y Mayús la
          // QUITA de la existente (el usuario lo pidió: ctrl selecciona,
          // mayús deselecciona).
          const esCtrl = e.ctrlKey;
          const esMayus = e.shiftKey;
          const modificada = esCtrl || esMayus;

          // Visibilidad: solo caras FRONTALES (mirando a la cámara) y los
          // vértices/segmentos que pertenecen a alguna de ellas. Sin esto
          // un rectángulo atraviesa el objeto y captura lo que está detrás.
          const soloVisible = faceSelectVisibleOnlyRef.current;
          const camPos = camera.getWorldPosition(new THREE.Vector3());
          let frenteCaras: Uint8Array | null = null;
          if (soloVisible) {
            frenteCaras = new Uint8Array(m.faces.length);
            for (let i = 0; i < m.faces.length; i++) {
              const face = m.faces[i];
              if (face.length < 3) continue;
              const a = m.vertices[face[0]];
              const b = m.vertices[face[1]];
              const c = m.vertices[face[2]];
              if (!a || !b || !c) continue;
              const wa = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(worldMatrix);
              const wb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(worldMatrix);
              const wc = new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(worldMatrix);
              const n = new THREE.Vector3()
                .subVectors(wb, wa)
                .cross(new THREE.Vector3().subVectors(wc, wa));
              if (n.dot(new THREE.Vector3().subVectors(camPos, wa)) > 0) {
                frenteCaras[i] = 1;
              }
            }
          }

          if (target === 'vertice') {
            // Un vértice es visible si pertenece a alguna cara frontal.
            let verticeVisible: Uint8Array | null = null;
            if (frenteCaras) {
              verticeVisible = new Uint8Array(m.vertices.length);
              for (let i = 0; i < m.faces.length; i++) {
                if (!frenteCaras[i]) continue;
                for (const vi of m.faces[i]) {
                  if (vi < verticeVisible.length) verticeVisible[vi] = 1;
                }
              }
            }
            // Vértices: un punto de pantalla por vértice.
            const selected: number[] = [];
            if (clicSimple) {
              let mejorIdx = -1;
              let mejorDist = 16;
              for (let i = 0; i < m.vertices.length; i++) {
                if (verticeVisible && !verticeVisible[i]) continue;
                const v = m.vertices[i];
                if (!v) continue;
                const world = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix);
                const screenPt = projectToScreen(world, camera, rect);
                if (!screenPt) continue;
                const dist = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
                if (dist < mejorDist) { mejorDist = dist; mejorIdx = i; }
              }
              if (mejorIdx >= 0) selected.push(mejorIdx);
            } else {
              for (let i = 0; i < m.vertices.length; i++) {
                if (verticeVisible && !verticeVisible[i]) continue;
                const v = m.vertices[i];
                if (!v) continue;
                const world = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix);
                const screenPt = projectToScreen(world, camera, rect);
                if (!screenPt) continue;
                if (insideShape(screenPt)) selected.push(i);
              }
            }
            // Expand selected vertices to their coincident groups
            const expandedSelected = new Set<number>();
            for (const v of selected) {
              if (!expandedSelected.has(v)) {
                getVertexGroup(m, v).forEach((gv) => expandedSelected.add(gv));
              }
            }
            const expandedArray = Array.from(expandedSelected);

            const prev = selectedVertexIdsRef.current ?? [];
            let newIds: number[];
            if (expandedArray.length === 0 && !modificada) {
              // Clic o área en el vacío sin teclas: deselecciona todo.
              newIds = [];
            } else if (esMayus) {
              // Mayús+clic o Mayús+área: QUITA los vértices del área.
              newIds = expandedArray.length
                ? prev.filter((f) => !expandedArray.includes(f))
                : prev;
            } else if (esCtrl) {
              // Ctrl+clic o Ctrl+área: AÑADE los vértices del área.
              newIds = expandedArray.length
                ? [...new Set([...prev, ...expandedArray])]
                : prev;
            } else {
              // Nueva área sin teclas: reemplaza la selección.
              newIds = expandedArray;
            }
            onVertexSelectionChangeRef.current?.(newIds);
            selectedVertexIdsRef.current = newIds;
            return;
          }

          if (target === 'segmento') {
            // Un segmento es visible si pertenece a alguna cara frontal.
            let edgeVisible: Set<string> | null = null;
            if (frenteCaras) {
              edgeVisible = new Set<string>();
              for (let i = 0; i < m.faces.length; i++) {
                if (!frenteCaras[i]) continue;
                const face = m.faces[i];
                for (let j = 0; j < face.length; j++) {
                  const va = face[j];
                  const vb = face[(j + 1) % face.length];
                  if (va === vb) continue;
                  edgeVisible.add(`${Math.min(va, vb)}-${Math.max(va, vb)}`);
                }
              }
            }
            // Segmentos: un punto de pantalla por punto medio de arista.
            const edges = deriveMeshEdges(m);
            const selectedKeys: string[] = [];
            if (clicSimple) {
              let mejorKey: string | null = null;
              let mejorDist = 16;
              for (const edge of edges) {
                if (edgeVisible && !edgeVisible.has(edge.key)) continue;
                const va = m.vertices[edge.a];
                const vb = m.vertices[edge.b];
                if (!va || !vb) continue;
                const mid = new THREE.Vector3(
                  (va.x + vb.x) / 2,
                  (va.y + vb.y) / 2,
                  (va.z + vb.z) / 2
                ).applyMatrix4(worldMatrix);
                const screenPt = projectToScreen(mid, camera, rect);
                if (!screenPt) continue;
                const dist = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
                if (dist < mejorDist) { mejorDist = dist; mejorKey = edge.key; }
              }
              if (mejorKey) selectedKeys.push(mejorKey);
            } else if (pruebaArea) {
              // Área: solo segmentos con AMBOS extremos dentro de la figura
              // (el punto medio admitía aristas cogidas «por la mitad»).
              for (const edge of edges) {
                if (edgeVisible && !edgeVisible.has(edge.key)) continue;
                const va = m.vertices[edge.a];
                const vb = m.vertices[edge.b];
                if (!va || !vb) continue;
                const pA = projectToScreen(
                  new THREE.Vector3(va.x, va.y, va.z).applyMatrix4(worldMatrix),
                  camera,
                  rect
                );
                const pB = projectToScreen(
                  new THREE.Vector3(vb.x, vb.y, vb.z).applyMatrix4(worldMatrix),
                  camera,
                  rect
                );
                if (!pA || !pB) continue;
                if (insideShape(pA) && insideShape(pB)) selectedKeys.push(edge.key);
              }
            } else {
              for (const edge of edges) {
                if (edgeVisible && !edgeVisible.has(edge.key)) continue;
                const va = m.vertices[edge.a];
                const vb = m.vertices[edge.b];
                if (!va || !vb) continue;
                const mid = new THREE.Vector3(
                  (va.x + vb.x) / 2,
                  (va.y + vb.y) / 2,
                  (va.z + vb.z) / 2
                ).applyMatrix4(worldMatrix);
                const screenPt = projectToScreen(mid, camera, rect);
                if (!screenPt) continue;
                if (insideShape(screenPt)) selectedKeys.push(edge.key);
              }
            }
            // Expand selected edges to their collinear macro-edge groups
            const expandedSelected = new Set<string>();
            for (const k of selectedKeys) {
              if (!expandedSelected.has(k)) {
                getEdgeGroup(m, k).forEach(ge => expandedSelected.add(ge));
              }
            }
            const expandedArray = Array.from(expandedSelected);

            const prev = selectedEdgeIdsRef.current ?? [];
            let newIds: string[];
            if (expandedArray.length === 0 && !modificada) {
              // Clic o área en el vacío sin teclas: deselecciona todo.
              newIds = [];
            } else if (esMayus) {
              // Mayús+clic o Mayús+área: QUITA los segmentos del área.
              newIds = expandedArray.length
                ? prev.filter((k) => !expandedArray.includes(k))
                : prev;
            } else if (esCtrl) {
              // Ctrl+clic o Ctrl+área: AÑADE los segmentos del área.
              newIds = expandedArray.length
                ? [...new Set([...prev, ...expandedArray])]
                : prev;
            } else {
              // Nueva área sin teclas: reemplaza la selección.
              newIds = expandedArray;
            }
            onEdgeSelectionChangeRef.current?.(newIds);
            selectedEdgeIdsRef.current = newIds;
            return;
          }

          // Caras (objetivo por defecto): centroides.
          const centroids = computeFaceCentroids(m, worldMatrix);
          const selected: number[] = [];
          const selectedFaceIds = selectedFaceIdsRef.current ?? [];
          let mejorIdx = -1;

          if (clicSimple) {
            // Raycast: el primer punto golpeado es SIEMPRE de la cara más
            // cercana a la cámara; así el clic no atraviesa el objeto y
            // selecciona una cara que está detrás. Entre las caras se
            // elige la de centroide más cercano al punto golpeado.
            let puntoHit: THREE.Vector3 | null = null;
            const meshObjClic = findMainMesh(meshGroupRef.current);
            if (meshObjClic) {
              const ray = new THREE.Raycaster();
              ray.setFromCamera(
                new THREE.Vector2(
                  ((e.clientX - rect.left) / rect.width) * 2 - 1,
                  -((e.clientY - rect.top) / rect.height) * 2 + 1
                ),
                camera
              );
              const hits = ray.intersectObject(meshObjClic, false);
              if (hits.length > 0) puntoHit = hits[0].point;
            }
            let mejorDist = puntoHit ? Infinity : 24;
            for (let i = 0; i < centroids.length; i++) {
              if (frenteCaras && !frenteCaras[i]) continue;
              if (puntoHit) {
                const dist = centroids[i].distanceTo(puntoHit);
                if (dist < mejorDist) { mejorDist = dist; mejorIdx = i; }
              } else {
                const screenPt = projectToScreen(centroids[i], camera, rect);
                if (!screenPt) continue;
                const dist = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
                if (dist < mejorDist) { mejorDist = dist; mejorIdx = i; }
              }
            }
          } else if (pruebaArea) {
            // Área (rectángulo/círculo/polígono): solo caras COMPLETAMENTE
            // dentro — TODAS sus esquinas proyectadas caen dentro de la
            // figura. La prueba por centroide admitía caras cogidas «por la
            // mitad»; las proyecciones se cachean por vértice.
            const enPantalla = new Map<number, { x: number; y: number } | null>();
            const proyectaVertice = (vi: number) => {
              let pt = enPantalla.get(vi);
              if (pt === undefined) {
                const v = m.vertices[vi];
                pt = v
                  ? projectToScreen(
                      new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix),
                      camera,
                      rect
                    )
                  : null;
                enPantalla.set(vi, pt);
              }
              return pt ?? null;
            };
            for (let i = 0; i < m.faces.length; i++) {
              if (frenteCaras && !frenteCaras[i]) continue;
              const face = m.faces[i];
              if (!face || face.length < 3) continue;
              let completa = true;
              for (const vi of face) {
                const pt = proyectaVertice(vi);
                if (!pt || !insideShape(pt)) { completa = false; break; }
              }
              if (completa) selected.push(i);
            }
          } else {
            for (let i = 0; i < centroids.length; i++) {
              if (frenteCaras && !frenteCaras[i]) continue;
              const screenPt = projectToScreen(centroids[i], camera, rect);
              if (!screenPt) continue;
              if (insideShape(screenPt)) {
                selected.push(i);
              }
            }
          }
          if (clicSimple && mejorIdx >= 0) selected.push(mejorIdx);

          // Expand selection to coplanar face groups
          const expandedSelected = new Set<number>();
          for (const f of selected) {
            if (!expandedSelected.has(f)) {
              getFaceGroup(m, f).forEach((gf) => expandedSelected.add(gf));
            }
          }
          const expandedArray = Array.from(expandedSelected);

          // Clic simple sin teclas: la selección pasa a ser SOLO esa cara (y su grupo).
          // Ctrl/Mayús+clic: añade (o quita, si ya estaba) esa cara una a
          // una, sin perder el resto.
          // Nueva área SIN teclas: REEMPLAZA — las caras del área anterior
          // que no vuelven a estar dentro salen de la selección sola.
          let newFaceIds: number[];
          if (clicSimple && !modificada) {
            newFaceIds = mejorIdx >= 0 ? getFaceGroup(m, mejorIdx) : [];
          } else if (esMayus) {
            // Mayús+clic: QUITA las caras nuevas de la selección (los que
            // ya no vuelven a estar dentro salen; el resto se conserva).
            newFaceIds = expandedArray.length
              ? selectedFaceIds.filter((f) => !expandedArray.includes(f))
              : selectedFaceIds;
          } else if (esCtrl) {
            // Ctrl+clic: AÑADE las caras nuevas a la selección.
            newFaceIds = expandedArray.length
              ? [...new Set([...selectedFaceIds, ...expandedArray])]
              : selectedFaceIds;
          } else if (!clicSimple && expandedArray.length === 0) {
            // Área en el vacío: deselecciona todo.
            newFaceIds = [];
          } else {
            newFaceIds = expandedArray;
          }
          onFaceSelectionChangeRef.current?.(newFaceIds);
          selectedFaceIdsRef.current = newFaceIds;
          return;
        }

        // --- Rubber-band selection: finalize ---
        if (selectionStartRef.current) {
         const start = selectionStartRef.current;
         const canvasRect = renderer.domElement.getBoundingClientRect();
         const dx = e.clientX - start.x;
         const dy = e.clientY - start.y;
         // Hide selection rectangle
         if (selectionRectRef.current) {
           selectionRectRef.current.style.display = 'none';
         }
         selectionStartRef.current = null;
         controls.enabled = true;
         renderer.domElement.style.cursor = '';

          // Only do selection if there was a meaningful drag
          if (dx * dx + dy * dy > 16) {
            const x1 = Math.min(start.x, e.clientX);
            const y1 = Math.min(start.y, e.clientY);
            const x2 = Math.max(start.x, e.clientX);
            const y2 = Math.max(start.y, e.clientY);

            const meshGroup = meshGroupRef.current;
            if (meshGroup) {
              meshGroup.updateMatrixWorld();
              const rect = renderer.domElement.getBoundingClientRect();
              // Proyectar las 8 esquinas de la caja a pantalla: con la
              // cámara en perspectiva, la esquina mínima 3D no siempre
              // cae a la izquierda/abajo de la máxima en pantalla (el
              // intervalo quedaba invertido y el objeto se escapaba del
              // rectángulo aunque lo cubriera). Devuelve null si la caja
              // está vacía.
              const enPantalla = (figura: THREE.Object3D) => {
                const box = new THREE.Box3().setFromObject(figura);
                if (box.isEmpty()) return null;
                const { min, max } = box;
                const corners = [
                  [min.x, min.y, min.z], [max.x, min.y, min.z],
                  [min.x, max.y, min.z], [max.x, max.y, min.z],
                  [min.x, min.y, max.z], [max.x, min.y, max.z],
                  [min.x, max.y, max.z], [max.x, max.y, max.z],
                ].map(([cx, cy, cz]) =>
                  new THREE.Vector3(cx, cy, cz).project(camera)
                );
                const sx = corners.map(
                  (v) => ((v.x + 1) * 0.5) * rect.width + rect.left
                );
                const sy = corners.map(
                  (v) => ((1 - v.y) * 0.5) * rect.height + rect.top
                );
                return {
                  sx1: Math.min(...sx),
                  sx2: Math.max(...sx),
                  sy1: Math.min(...sy),
                  sy2: Math.max(...sy),
                };
              };
              const toca = (c: {
                sx1: number;
                sx2: number;
                sy1: number;
                sy2: number;
              }) => !(c.sx2 < x1 || c.sx1 > x2 || c.sy2 < y1 || c.sy1 > y2);
              const selectedIds: string[] = [];
              // Los objetos CONGELADOS se dibujan como duplicados: la
              // figura activa NO es un duplicado (es la malla principal),
              // así que sin ella el rectángulo nunca la tomaría a ella
              // también — con 2 objetos solo seleccionaba 1.
              const activoId = meshGroup.userData.sceneObjectId as
                | string
                | undefined;
              const principal = meshGroup.children.find(
                (c) => !c.userData.sceneObjectDuplicate
              );
              const cajaPrincipal =
                activoId && principal ? enPantalla(principal) : null;
              // Los objetos CONGELADOS no participan en la selección por
              // rectángulo (no se pueden seleccionar ni manipular).
              const esCongelado = (id: string) =>
                (objectsRef.current ?? []).find((o) => o.id === id)?.frozen ===
                true;
              if (
                activoId &&
                cajaPrincipal &&
                toca(cajaPrincipal) &&
                !esCongelado(activoId)
              ) {
                selectedIds.push(activoId);
              }
              for (const dup of meshGroup.children) {
                if (!dup.userData.sceneObjectDuplicate) continue;
                const caja = enPantalla(dup);
                if (!caja || !toca(caja)) continue;
                const objId = dup.userData.sceneObjectId;
                if (objId && !esCongelado(objId)) selectedIds.push(objId);
              }
              // If the rectangle selected nothing, clear all selections
              if (selectedIds.length === 0) {
                onSelectionChangeRef.current?.([]);
                return;
              }
              // Toggle selection: if all found objects are already selected, deselect them;
              // otherwise add to current selection
              const current = selectedObjectIdsRef.current ?? [];
              const allSelected = selectedIds.every((id) => current.includes(id));
              let newIds: string[];
              if (allSelected && selectedIds.length > 0) {
                newIds = current.filter((id) => !selectedIds.includes(id));
              } else {
                newIds = [...new Set([...current, ...selectedIds])];
              }
              onSelectionChangeRef.current?.(newIds);
            }
          }
          return;
        }

        if (placeTargetRef.current && placeDownRef.current) {
        const dx = e.clientX - placeDownRef.current.x;
        const dy = e.clientY - placeDownRef.current.y;
        placeDownRef.current = null;
        if (dx * dx + dy * dy < 36) {
          handleFxPlacementClick(e.clientX, e.clientY);
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

      // Release camera-object path handle drag
      if (cameraPathDragRef.current) {
        cameraPathDragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        return;
      }

      // Release object motion path handle drag
      if (motionPathDragRef.current) {
        motionPathDragRef.current = null;
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
        const wasGizmo = gizmoDragRef.current.target === 'gizmo';
        const dragFinal = gizmoDragRef.current;
        gizmoDragRef.current = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = '';
        // Confirma el transform arrastrado (estado + aviso al editor).
        // La pieza de textura ya avisó en cada movimiento (la textura va
        // en vivo), así que aquí solo queda confirmar el del objeto.
        // El arrastre del gizmo-offset también avisó en cada movimiento.
        if (!wasHelper && !wasGizmo) {
          let t = transformRef.current;
          // Escala de CONJUNTO (multi-selección, transformación individual
          // apagada): el gizmo escala el activo en su sitio; para que la
          // composición entera crezca del pivote común sin separarse, el
          // activo también órbita alrededor del centro del conjunto con el
          // mismo factor (equivale a escalar el grupo como una sola pieza).
          const startPre = multiTransformStartRef.current;
          const selPre = selectedObjectIdsRef.current ?? [];
          const actPre = selectedObjectIdRef.current;
          const esMultiEscala =
            dragFinal.target === 'object' &&
            (dragFinal.mode === 'scale' ||
              dragFinal.mode === 'uniform-scale' ||
              dragFinal.mode === 'planar-scale') &&
            selPre.length > 1 &&
            selPre.includes(actPre ?? '') &&
            !!startPre[actPre ?? ''] &&
            !giroIndividualRef.current;
          const pivotConjunto = esMultiEscala
            ? dragFinal.multiCenter ?? null
            : null;
          let kxConjunto = 1;
          let kyConjunto = 1;
          let kzConjunto = 1;
          if (pivotConjunto) {
            const sA = startPre[actPre ?? ''];
            kxConjunto = sA.sx !== 0 ? t.sx / sA.sx : 1;
            kyConjunto = sA.sy !== 0 ? t.sy / sA.sy : 1;
            kzConjunto = sA.sz !== 0 ? t.sz / sA.sz : 1;
            t = {
              ...t,
              px: pivotConjunto.x + (sA.px - pivotConjunto.x) * kxConjunto,
              py: pivotConjunto.y + (sA.py - pivotConjunto.y) * kyConjunto,
              pz: pivotConjunto.z + (sA.pz - pivotConjunto.z) * kzConjunto,
            };
          }
          setTransform(t);
          onObjectTransformRef.current?.(t);
          // Modo grabación: soltar el gizmo sobre la cámara grabada
          // captura un fotograma con la pose del cuerpo (posición del
          // transform; foco = el último fotograma, o el foco apuntado si
          // el recorrido está vacío). Funciona desde cualquier ventana.
          const idArrastrado = selectedObjectIdRef.current;
          const camObj = (objectsRef.current ?? []).find(
            (o) => o.id === idArrastrado && o.kind === 'camera' && o.camera
          );
          // Un clic en el gizmo sin arrastrar no captura: el transform
          // de props aún es el previo al arrastre (no hay avisos en vivo).
          const trPrevio = camObj?.transform;
          const movioGizmo =
            !trPrevio ||
            Math.hypot(
              t.px - trPrevio.px,
              t.py - trPrevio.py,
              t.pz - trPrevio.pz
            ) > 1e-9;
          if (
            grabacionCamaraIdRef.current &&
            idArrastrado === grabacionCamaraIdRef.current &&
            movioGizmo &&
            onGrabacionCapturaRef.current
          ) {
            const kfsCam = camObj?.camera?.keyframes ?? [];
            const foco = kfsCam.length
              ? kfsCam[kfsCam.length - 1].target
              : (camObj?.camera?.target as Vec3 | undefined) ?? {
                  x: t.px,
                  y: t.py,
                  z: t.pz - 1,
                };
            onGrabacionCapturaRef.current({
              position: { x: t.px, y: t.py, z: t.pz },
              target: foco,
              fov: camera.fov,
            });
          }
          // Si hay objetos multiseleccionados, aplica el delta al resto
          const startTransforms = multiTransformStartRef.current;
          const selIds = selectedObjectIdsRef.current ?? [];
          const activeId = selectedObjectIdRef.current;
          if (selIds.length > 0 && selIds.includes(activeId ?? '')) {
            const updatedTransforms: { id: string; transform: ObjectTransform }[] = [];
            const startActive = startTransforms[activeId ?? ''];
            if (startActive) {
              const startQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(startActive.rx, startActive.ry, startActive.rz)
              );
              const endQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(t.rx, t.ry, t.rz)
              );
              const deltaQuat = endQuat.clone().multiply(startQuat.invert());
              if (
                dragFinal &&
                dragFinal.target === 'object' &&
                dragFinal.mode === 'rotate' &&
                !giroIndividualRef.current
              ) {
                // Giro de CONJUNTO (multi-selección, giro individual
                // apagado): cada seleccionado órbita alrededor del centro
                // del conjunto con la misma rotación total que el activo,
                // de modo que la composición gira como una sola pieza.
                const pivot = dragFinal.startPos;
                for (const id of selIds) {
                  if (id === activeId) continue;
                  const startObj = startTransforms[id];
                  if (!startObj) continue;
                  const quat = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(startObj.rx, startObj.ry, startObj.rz)
                  );
                  const pos = new THREE.Vector3(
                    startObj.px, startObj.py, startObj.pz
                  ).sub(pivot).applyQuaternion(deltaQuat).add(pivot);
                  const newQuat = deltaQuat.clone().multiply(quat);
                  const newEuler = new THREE.Euler().setFromQuaternion(newQuat, 'XYZ');
                  updatedTransforms.push({
                    id,
                    transform: {
                      px: pos.x,
                      py: pos.y,
                      pz: pos.z,
                      rx: newEuler.x,
                      ry: newEuler.y,
                      rz: newEuler.z,
                      sx: startObj.sx,
                      sy: startObj.sy,
                      sz: startObj.sz,
                    },
                  });
                }
              } else if (pivotConjunto) {
                // Escala de CONJUNTO: cada seleccionado se mueve alrededor
                // del pivote común con el mismo factor del gesto y su
                // tamaño se multiplica igual; la composición se mantiene
                // (el grupo crece como una sola pieza en su conjunto).
                for (const id of selIds) {
                  if (id === activeId) continue;
                  const startObj = startTransforms[id];
                  if (!startObj) continue;
                  const objQuat = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(startObj.rx, startObj.ry, startObj.rz)
                  );
                  const newQuat = deltaQuat.clone().multiply(objQuat);
                  const newEuler = new THREE.Euler().setFromQuaternion(newQuat, 'XYZ');
                  updatedTransforms.push({
                    id,
                    transform: {
                      px: pivotConjunto.x + (startObj.px - pivotConjunto.x) * kxConjunto,
                      py: pivotConjunto.y + (startObj.py - pivotConjunto.y) * kyConjunto,
                      pz: pivotConjunto.z + (startObj.pz - pivotConjunto.z) * kzConjunto,
                      rx: newEuler.x,
                      ry: newEuler.y,
                      rz: newEuler.z,
                      sx: startObj.sx * kxConjunto,
                      sy: startObj.sy * kyConjunto,
                      sz: startObj.sz * kzConjunto,
                    },
                  });
                }
              } else {
              const deltaPos = {
                x: t.px - startActive.px,
                y: t.py - startActive.py,
                z: t.pz - startActive.pz,
              };
              // Scale delta (factor)
              const deltaScale = {
                x: startActive.sx !== 0 ? t.sx / startActive.sx : 1,
                y: startActive.sy !== 0 ? t.sy / startActive.sy : 1,
                z: startActive.sz !== 0 ? t.sz / startActive.sz : 1,
              };
              for (const id of selIds) {
                if (id === activeId) continue;
                const startObj = startTransforms[id];
                if (!startObj) continue;
                const objQuat = new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(startObj.rx, startObj.ry, startObj.rz)
                );
                const newQuat = deltaQuat.clone().multiply(objQuat);
                const newEuler = new THREE.Euler().setFromQuaternion(newQuat, 'XYZ');
                updatedTransforms.push({
                  id,
                  transform: {
                    px: startObj.px + deltaPos.x,
                    py: startObj.py + deltaPos.y,
                    pz: startObj.pz + deltaPos.z,
                    rx: newEuler.x,
                    ry: newEuler.y,
                    rz: newEuler.z,
                    sx: startObj.sx * deltaScale.x,
                    sy: startObj.sy * deltaScale.y,
                    sz: startObj.sz * deltaScale.z,
                  },
                });
              }
              }
            }
            if (updatedTransforms.length > 0) {
              onMultiObjectTransformRef.current?.(updatedTransforms);
            }
          }
        }
        multiTransformStartRef.current = {};
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
    // Al salir del lienzo se limpia el resalte de hover y el cursor:
    // el último elemento apuntado no se queda pintado sin ratón encima.
    const onPointerLeaveCanvas = () => {
      hoverElementRef.current = null;
      renderer.domElement.style.cursor = '';
    };
    renderer.domElement.addEventListener('pointerleave', onPointerLeaveCanvas);
    // Rueda del ratón durante la grabación: OrbitControls acerca (dolly) y
    // este gesto también captura fotograma al quedar la vista quieta.
    const onRuedaGrabacion = () => gestoZoomGrabacion();
    renderer.domElement.addEventListener('wheel', onRuedaGrabacion, {
      passive: true,
    });

    return () => {
      cancelAnimationFrame(animId);
    // Clean up face selection HTML overlays
    if (faceSelectionRectDivRef.current) faceSelectionRectDivRef.current.remove();
    if (faceSelectionCircleDivRef.current) faceSelectionCircleDivRef.current.remove();
    if (faceSelectionPolyDivRef.current) {
      const parent = faceSelectionPolyDivRef.current.ownerSVGElement;
      if (parent) parent.remove();
    }
    faceSelectionRectDivRef.current = null;
    faceSelectionCircleDivRef.current = null;
    faceSelectionPolyDivRef.current = null;
    faceSelectionStartRef.current = null;
    faceSelectionPointsRef.current = [];
      window.removeEventListener('resize', handleResize);
      if (mountResizeObserver) mountResizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeaveCanvas);
      renderer.domElement.removeEventListener('wheel', onRuedaGrabacion);
      renderer.domElement.removeEventListener('wheel', handleWheelPlano);
      if (recZoomTimerRef.current) clearTimeout(recZoomTimerRef.current);
      controls.dispose();
      for (const h of gizmoHandlesRef.current) {
        h.geometry.dispose();
        const mats = Array.isArray(h.material) ? h.material : [h.material];
        for (const m of mats) (m as THREE.Material)?.dispose?.();
      }
      gizmoHandlesRef.current = [];
      for (const h of textureHelperHandlesRef.current) {
        h.geometry.dispose();
        const mats = Array.isArray(h.material) ? h.material : [h.material];
        for (const m of mats) (m as THREE.Material)?.dispose?.();
      }
      textureHelperHandlesRef.current = [];
      gizmoDragRef.current = null;
      if (axisGizmoSceneRef.current) {
        axisGizmoSceneRef.current.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose?.();
          const mat = mesh.material as
            | THREE.Material
            | THREE.Material[]
            | undefined;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else if (mat) {
            const spriteMat = mat as THREE.SpriteMaterial;
            spriteMat.map?.dispose?.();
            mat.dispose();
          }
        });
        axisGizmoSceneRef.current = null;
      }
      axisGizmoGroupRef.current = null;
      axisGizmoCameraRef.current = null;
      renderer.dispose();
      // Libera los runtimes de efectos por objeto.
      for (const rt of fxObjetosRef.current.values()) {
        disponerSistemasFx(rt);
        rt.grupo.parent?.remove(rt.grupo);
      }
      fxObjetosRef.current.clear();
       if (mount.contains(renderer.domElement)) {
         mount.removeChild(renderer.domElement);
       }
       if (selectionRectRef.current?.parentElement) {
         selectionRectRef.current.parentElement.removeChild(selectionRectRef.current);
       }
     };
  // showVertices se lee por showVerticesRef (ver su declaración): no debe
  // entrar aquí — si entrara, cada toggle de «Vértices» (y al entrar en el
  // modo selección de caras) desmontaría y recrearía TODO el visor y la
  // escena perdía los objetos sin mecanismo de repoblado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        child.userData.sceneObjectDuplicate ||
        child.userData.cameraBodyActive
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
    // También entra aquí una malla sin textura general pero con texturas
    // por cara (faceTextures): el material base queda sin mapa. Las texturas
    // por cara tienen prioridad sobre el sombreado suave (ese camino no
    // sabe pintarlas; sin esto no se verían).
    const tieneTexturasPorCara = (mesh.faceTextures ?? []).some((tx) => !!tx);
    if (
      ((mesh.texture && !smoothShading) ||
        // La textura de relieve dedicada también exige UVs: entra en la
        // construcción con texturas aunque no haya textura normal.
        (mesh.bumpTexture && !smoothShading) ||
        tieneTexturasPorCara) &&
      !wireframe
    ) {
      // Limpiar grupo
      for (const child of [...meshGroup.children]) {
        if (
          child === latheAxisRef.current ||
          child === textureHelperGroupRef.current ||
          child === textureHelperGizmoGroupRef.current ||
          child.userData.sceneObjectDuplicate ||
          child.userData.cameraBodyActive
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
      let minZ = Infinity, maxZ = -Infinity;
      for (const v of mesh.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
      }
      // Caja + ejes de la proyección: los MISMOS que usa la pieza
      // amarilla (misma caja y MISMA ESCALA del objeto al elegir la
      // cara), así el marco y la textura siempre calzan sobre la misma
      // cara — el cubo estirado en pared elige la cara grande de pared.
      const cajaProy = { minX, maxX, minY, maxY, minZ, maxZ };
      const escalaObjeto = { sx: transform.sx, sy: transform.sy, sz: transform.sz };
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
        // MISMA convención que lib/geometry.ts: V crece hacia ARRIBA
        // (v=1 arriba del objeto). flipY=true hace que V=1 muestre la
        // PARTE ALTA de la imagen — así la textura sale derecha. El
        // viejo «1 - …» la ponía boca abajo.
        if (textureProjection === 'planar') {
          return uvCaraPlana(p, cajaProy, ejeCaraPlanaDeEscena(cajaProy, escalaObjeto.sx, escalaObjeto.sy, escalaObjeto.sz));
        }
        if (textureProjection === 'spherical') {
          const length = Math.max(1e-6, Math.hypot(p.x, p.y, p.z));
          const u = ((Math.atan2(p.z, p.x) / (Math.PI * 2)) + 1) % 1;
          return [u, 1 - Math.acos(p.y / length) / Math.PI];
        }
        return uvCilindrica(p, cajaProy, ejeCilindroDeEscena(cajaProy, escalaObjeto.sx, escalaObjeto.sy, escalaObjeto.sz));
      };

      // Textura SOBRE LA SELECCIÓN: UNA imagen global estirada sobre las
      // caras de la asignación. Caja de la unión de los vértices del
      // grupo; los DOS ejes de mayor extensión de esa caja reciben U·V,
      // con Y como «arriba» cuando participa, para que la imagen salga
      // derecha. Las caras sin grupo (caras de antes) comparten todas
      // una caja global.
      const faceTexturesList = mesh.faceTextures ?? null;
      const gruposTextura = mesh.faceTextureGroups ?? null;
      const uvDeCara = new Map<number, number[]>();
      {
        const lista: Array<{ face: number[]; faceIdx: number }> = [];
        mesh.faces.forEach((face, faceIdx) => {
          const tex = faceTexturesList?.[faceIdx] ?? null;
          if (!tex || face.length < 3) return;
          lista.push({ face, faceIdx });
        });
        const gruposList = lista.map((item) => gruposTextura?.[item.faceIdx] ?? null);
        // Agrupar: cada asignación es un grupo propio (cada una con su
        // caja de UV, así una segunda selección NO reescala la primera);
        // las sin grupo van todas juntas en la caja de siempre.
        const porGrupo = new Map<string, Array<{ face: number[]; faceIdx: number }>>();
        for (let i = 0; i < lista.length; i++) {
          const clave = gruposList[i] ? `g${gruposList[i]}` : 'global';
          let arr = porGrupo.get(clave);
          if (!arr) { arr = []; porGrupo.set(clave, arr); }
          arr.push(lista[i]);
        }
        const encajeCaja = (
          miembros: Array<{ face: number[]; faceIdx: number }>,
        ) => {
          let ax = Infinity, axx = -Infinity, ay = Infinity, ayy = -Infinity, az = Infinity, azz = -Infinity;
          for (const { face } of miembros) {
            for (const idx of face) {
              const v = mesh.vertices[idx];
              if (!v) continue;
              if (v.x < ax) ax = v.x; if (v.x > axx) axx = v.x;
              if (v.y < ay) ay = v.y; if (v.y > ayy) ayy = v.y;
              if (v.z < az) az = v.z; if (v.z > azz) azz = v.z;
            }
          }
          const rangos: Array<[number, number, number]> = [
            [axx - ax, ax, axx], [ayy - ay, ay, ayy], [azz - az, az, azz],
          ];
          // «Arriba» = Y si es uno de los dos ejes dominantes de la caja
          // de la selección; si no, los dos mayores en su orden.
          const ordenados = [...rangos].sort((a, b) => b[0] - a[0]);
          let ejeU = ordenados[0];
          let ejeV = ordenados[1];
          if (rangos[1] === ordenados[0] || rangos[1] === ordenados[1]) {
            ejeV = rangos[1];
            ejeU = ejeV === ordenados[0] ? ordenados[1] : ordenados[0];
          }
          const dimU = ejeU === rangos[0] ? 0 : ejeU === rangos[1] ? 1 : 2;
          const dimV = ejeV === rangos[0] ? 0 : ejeV === rangos[1] ? 1 : 2;
          const rangoU = Math.max(1e-6, ejeU[0]);
          const rangoV = Math.max(1e-6, ejeV[0]);
          const baseU = dimU === 0 ? ax : dimU === 1 ? ay : az;
          const baseV = dimV === 0 ? ax : dimV === 1 ? ay : az;
          for (const { face, faceIdx } of miembros) {
            const uv: number[] = [];
            for (const idx of face) {
              const v = mesh.vertices[idx];
              if (!v) { uv.push(0.5, 0.5); continue; }
              const cu = dimU === 0 ? v.x : dimU === 1 ? v.y : v.z;
              const cv = dimV === 0 ? v.x : dimV === 1 ? v.y : v.z;
              uv.push((cu - baseU) / rangoU, (cv - baseV) / rangoV);
            }
            uvDeCara.set(faceIdx, uv);
          }
        };
        for (const miembros of porGrupo.values()) encajeCaja(miembros);
      }

      // Construir geometría con UVs
      // Por cara apilada: cuántos triángulos aporta y qué textura lleva,
      // para montar los grupos de material de las texturas por cara.
      const faceEntries: Array<{ triCount: number; tex: string | null }> = [];
      for (let faceIdx = 0; faceIdx < mesh.faces.length; faceIdx++) {
        const face = mesh.faces[faceIdx];
        if (face.length < 3) continue;
        const v0 = mesh.vertices[face[0]];
        const v1 = mesh.vertices[face[1]];
        const v2 = mesh.vertices[face[2]];
        if (!v0 || !v1 || !v2) continue;

        const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
        const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
        const n = e1.cross(e2).normalize();

        const baseIdx = positions.length / 3;
        // UVs prefabricadas por cara (imagen encajada) para las caras con
        // textura propia; el resto lleva su UV de siempre.
        const uvPropia = uvDeCara.get(faceIdx);
        let posEnCara = 0;
        for (const idx of face) {
          const v = mesh.vertices[idx];
          if (!v) {
            posEnCara++;
            continue;
          }
          positions.push(v.x, v.y, v.z);
          normals.push(n.x, n.y, n.z);

          if (uvPropia) {
            uvs.push(uvPropia[posEnCara * 2], uvPropia[posEnCara * 2 + 1]);
          } else
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
          posEnCara++;
        }
        // Triangulación
        for (let i = 1; i < face.length - 1; i++) {
          indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
        }
        faceEntries.push({
          triCount: face.length - 2,
          tex: faceTexturesList?.[faceIdx] ?? null,
        });
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
        const finish = mesh.textureFinish ?? objectTextureFinish;
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: finish === 'metallic' ? 0.3 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.05 : finish === 'mirror' ? 1 : 0.3,
          roughness: finish === 'metallic' ? 0.1 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.9 : finish === 'mirror' ? 0.05 : 0.45,
          clearcoat: finish === 'metallic' ? 1 : finish === 'glossy' ? 0 : finish === 'mirror' ? 1 : 0,
          clearcoatRoughness: finish === 'metallic' ? 0.015 : finish === 'glossy' ? 0.015 : finish === 'mirror' ? 0 : 0,
        side: THREE.DoubleSide,
        map: null, // Se cargará después
        bumpMap: null,
        bumpScale: (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP,
        transparent: true,
        opacity,
        alphaTest: 0,
        envMapIntensity: finish === 'mirror' ? 1.5 : 0,
      });

      // Textura CREADA (Crea texturas): mismo material físico que la vista
      // previa (transmisión en cristal/agua, metalidad, barniz…). Va
      // ANTES de crear los materiales por cara para que hereden sus
      // propiedades (metalidad/rugosidad).
      if (mesh.textureMaterialParams) {
        aplicarMaterialCreado(material, mesh.textureMaterialParams);
        // Y el entorno brillante de la vista previa (la escena del editor
        // suele ser oscura: sin esto el cristal se refracta negro).
        if (envCreadaRef.current) material.envMap = envCreadaRef.current;
      }

      // Texturas por cara: un material extra por textura distinta y un
      // grupo de índices por tramo contiguo de caras con la misma textura.
      // Las caras sin textura quedan en el material 0 (el general).
      let meshMaterials: THREE.Material | THREE.Material[] = material;
      if (faceEntries.some((e) => e.tex)) {
        const texMatIndex = new Map<string, number>();
        const extraMaterials: THREE.MeshPhysicalMaterial[] = [];
        const faceLoader = new THREE.TextureLoader();
        const loadFaceTexture = (mat: THREE.MeshPhysicalMaterial, url: string) => {
          faceLoader.load(
            url,
            (texture) => {
              if (cancelled) return;
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.anisotropy = 4;
              texture.needsUpdate = true;
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.RepeatWrapping;
              mat.map = texture;
              mat.color.set(0xffffff);
              mat.needsUpdate = true;
            },
            undefined,
            (err) => console.error('Error loading face texture:', err)
          );
        };
        for (const entry of faceEntries) {
          if (!entry.tex || texMatIndex.has(entry.tex)) continue;
          const faceMat = new THREE.MeshPhysicalMaterial({
            color: 0xcccccc,
            side: THREE.DoubleSide,
            transparent: true,
            opacity,
            map: null,
            metalness: material.metalness,
            roughness: material.roughness,
          });
          loadFaceTexture(faceMat, entry.tex);
          texMatIndex.set(entry.tex, 1 + extraMaterials.length);
          extraMaterials.push(faceMat);
        }
        // Grupos sobre el búfer de índices: tramos contiguos con el mismo
        // material. Sin grupo que cubra un tramo, ese tramo no se dibuja.
        let runStart = 0;
        let runMat = -1;
        let idxCursor = 0;
        for (const entry of faceEntries) {
          let matIndex = 0;
          if (entry.tex) matIndex = texMatIndex.get(entry.tex) ?? 0;
          if (matIndex !== runMat) {
            if (runMat >= 0 && idxCursor > runStart) {
              geometry.addGroup(runStart, idxCursor - runStart, runMat);
            }
            runStart = idxCursor;
            runMat = matIndex;
          }
          idxCursor += entry.triCount * 3;
        }
        if (runMat >= 0 && idxCursor > runStart) {
          geometry.addGroup(runStart, idxCursor - runStart, runMat);
        }
        meshMaterials = [material, ...extraMaterials];
      }

      const meshObj = new THREE.Mesh(geometry, meshMaterials);
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;
      meshGroup.add(meshObj);

      // Cargar la textura
      if (mesh.texture && mesh.textureMaterialParams && !mesh.bumpTexture) {
        // Textura CREADA: material PURO, igual que la vista previa — sin
        // mapa (no hay vetas/grano que la previsualización no muestre) y
        // teñido con el color de la textura.
        for (const m of Array.isArray(meshMaterials) ? meshMaterials : [meshMaterials]) {
          const fisico = m as THREE.MeshPhysicalMaterial;
          fisico.color.set(mesh.textureMaterialParams.color);
          fisico.needsUpdate = true;
        }
      } else if (mesh.texture) {
        const loader = new THREE.TextureLoader();
        loader.load(
          mesh.texture,
          (texture) => {
            if (cancelled) return;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            texture.repeat.set(
              mesh.textureRepeat ?? textureRepeat,
              mesh.textureRepeatY ?? textureRepeatY ?? textureRepeat
            );
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            material.map = texture;
            // Textura de relieve dedicada: SOLO ella genera el relieve.
            material.bumpMap = mesh.bumpTexture ? null : texture;
            material.bumpScale = (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP;
            material.color.set(0xffffff);
            material.needsUpdate = true;
            aplicarTexturaRelieve(
              material, mesh,
              mesh.textureRepeat ?? textureRepeat,
              mesh.textureRepeatY ?? textureRepeatY ?? textureRepeat
            );
          },
          undefined,
          (err) => {
            console.error('Error loading texture:', err);
            material.color.set(0xcccccc); // Fallback
          }
        );
      }

      // Sin textura normal pero con textura de relieve dedicada: el
      // relieve sale solo de ella (el material queda blanco).
      if (!mesh.texture && mesh.bumpTexture) {
        const materialesRelieve = Array.isArray(meshMaterials)
          ? meshMaterials
          : [meshMaterials];
        for (const m of materialesRelieve) {
          aplicarTexturaRelieve(
            m as THREE.MeshPhysicalMaterial, mesh,
            mesh.textureRepeat ?? textureRepeat,
            mesh.textureRepeatY ?? textureRepeatY ?? textureRepeat
          );
        }
      }

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
      let minZ = Infinity, maxZ = -Infinity;
      for (const v of mesh.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
      }
      // Caja + ejes de la proyección: los MISMOS que usa la pieza
      // amarilla, así el marco y la textura siempre calzan.
      const cajaProy = { minX, maxX, minY, maxY, minZ, maxZ };
      const escalaObjeto = { sx: transform.sx, sy: transform.sy, sz: transform.sz };
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
        if (textureProjection === 'planar') {
          uvs.push(...uvCaraPlana(p, cajaProy, ejeCaraPlanaDeEscena(cajaProy, escalaObjeto.sx, escalaObjeto.sy, escalaObjeto.sz)));
          return;
        }
        if (textureProjection === 'spherical') {
          const length = Math.max(1e-6, Math.hypot(p.x, p.y, p.z));
          const u = ((Math.atan2(p.z, p.x) / (Math.PI * 2)) + 1) % 1;
          uvs.push(u, 1 - Math.acos(p.y / length) / Math.PI);
        } else {
          uvs.push(...uvCilindrica(p, cajaProy, ejeCilindroDeEscena(cajaProy, escalaObjeto.sx, escalaObjeto.sy, escalaObjeto.sz)));
        }
      });
      for (const face of mesh.faces) {
        if (face.length < 3) continue;
        for (let j = 1; j + 1 < face.length; j++) {
          index.push(face[0], face[j], face[j + 1]);
        }
      }
      if (index.length === 0) {
        return;
      }

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

        // Malla fantasma bajo las aristas (como en la malla plana): sin
        // ella no hay MESH que raycastear en las vistas de alambre — la
        // selección de caras/vértices/segmentos moría en silencio.
        const ghostMatSuave = new THREE.MeshStandardMaterial({
          color: 0x9db4c8,
          metalness: 0.1,
          roughness: 0.6,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
          envMapIntensity: 0,
        });
        meshGroup.add(new THREE.Mesh(geometry, ghostMatSuave));
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
          metalness: mesh.textureFinish === 'metallic' ? 0.3 : mesh.textureFinish === 'glossy' ? 0.1 : mesh.textureFinish === 'matte' ? 0.05 : 0.1,
          roughness: mesh.textureFinish === 'metallic' ? 0.1 : mesh.textureFinish === 'glossy' ? 0.025 : mesh.textureFinish === 'matte' ? 0.9 : 0.45,
          clearcoat: mesh.textureFinish === 'metallic' ? 1 : mesh.textureFinish === 'glossy' ? 1 : 0,
          clearcoatRoughness: mesh.textureFinish === 'metallic' ? 0.015 : mesh.textureFinish === 'glossy' ? 0.015 : 0,
          side: THREE.DoubleSide,
          map: null,
          bumpMap: null,
          bumpScale: (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP,
          alphaTest: mesh.texture ? 0 : 0,
          // La textura del texto incluye un canal alfa, pero las tapas ya
          // siguen el contorno del glifo. Tratarlas como transparentes hace
          // que el frente parezca translúcido incluso con la opacidad de
          // costado al 100%. La transparencia de los laterales se asigna
          // abajo, en su material independiente.
          transparent: typeof mesh.opacity === 'number' && mesh.opacity < 1,
          opacity: typeof mesh.opacity === 'number' ? Math.max(0, Math.min(1, mesh.opacity)) : 1,
        });
        // Textura CREADA: mismo material físico que la vista previa
        // (transmisión en cristal/agua, metalidad, barniz…), con el
        // entorno brillante de la previsualización.
        if (mesh.textureMaterialParams) {
          aplicarMaterialCreado(material, mesh.textureMaterialParams);
          if (envCreadaRef.current) material.envMap = envCreadaRef.current;
        }
        const sideOpacity = hasFaceOpacity
          ? Math.max(0, Math.min(1, mesh.faceOpacities!.find((value) => value < 1) ?? 1))
          : 1;
        const sideMaterial = hasFaceOpacity
          ? material.clone()
          : material;
        if (hasFaceOpacity) {
          sideMaterial.transparent = sideOpacity < 1;
          sideMaterial.opacity = sideOpacity;
          // Siempre escribe profundidad: si fuera false con opacidades
          // semitransparentes, las caras casi opacas no taparian los efectos
          // (chispas/llamas) detrás de ellas y se verían atravesarlas.
          sideMaterial.depthWrite = true;
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

        if (mesh.texture && mesh.textureMaterialParams && !mesh.bumpTexture) {
          // Textura CREADA: material PURO sin mapa, igual que la vista
          // previa (la imagen traería vetas/grano de más); teñido con su
          // color. Los materiales por cara (costado) idem.
          for (const currentMaterial of hasFaceOpacity
            ? [material, sideMaterial]
            : [material]) {
            currentMaterial.color.set(mesh.textureMaterialParams.color);
            currentMaterial.needsUpdate = true;
          }
        } else if (mesh.texture) {
          const loader = new THREE.TextureLoader();
          loader.load(mesh.texture, (texture) => {
            if (cancelled) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            // Envolver la imagen en vez de recortar al borde: sin esto, en
            // cuanto la repetición pasa de 1 las UV (>1) quedan fuera de la
            // imagen y three.js clampa al borde — la "copia" que entra sale
            // como rayas del color del borde, no como la textura repetida.
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            // Repetición por eje: horizontal (X) y vertical (Y) — la Y
            // copia la X salvo que se haya fijado una propia.
            const repiteX = mesh.textureRepeat ?? textureRepeat ?? 1;
            const repiteY = mesh.textureRepeatY ?? textureRepeatY ?? repiteX;
            texture.repeat.set(repiteX, repiteY);
            texture.needsUpdate = true;
            const materials = Array.isArray(meshMaterials)
              ? meshMaterials
              : [meshMaterials];
            const targetOpacity = typeof mesh.opacity === 'number'
              ? Math.max(0, Math.min(1, mesh.opacity))
              : 1;
            for (const currentMaterial of materials) {
              currentMaterial.map = texture;
              // Textura de relieve dedicada: SOLO ella genera el relieve.
              currentMaterial.bumpMap = mesh.bumpTexture ? null : texture;
              currentMaterial.bumpScale =
                (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP;
              currentMaterial.color.set(mesh.textureColor ?? 0xffffff);
              // NO forzar transparent = false. Respetar lo que ya tenía
              // (las caras del costado con opacidad parcial lo necesitan).
              currentMaterial.needsUpdate = true;
            }
            if (mesh.bumpTexture) {
              for (const m of materials) aplicarTexturaRelieve(m, mesh, repiteX, repiteY);
            }
          },
          undefined,
          () => {
            // La textura no pudo cargarse (p. ej. una ruta media:// de un
            // archivo antiguo cuyo archivo de imagen ya no existe). Evitar
            // que el objeto quede BLANCO PURO por el color base 0xffffff:
            // teñirlo con un gris neutro para que siga viéndose.
            if (cancelled) return;
            const fallbackMaterials = Array.isArray(meshMaterials)
              ? meshMaterials
              : [meshMaterials];
            for (const currentMaterial of fallbackMaterials) {
              currentMaterial.color.set(0xdedede);
              currentMaterial.needsUpdate = true;
            }
          });
        }
        // Sin textura normal pero con textura de relieve dedicada.
        if (!mesh.texture && mesh.bumpTexture) {
          const materialesRelieve = Array.isArray(meshMaterials)
            ? meshMaterials
            : [meshMaterials];
          for (const m of materialesRelieve) {
            aplicarTexturaRelieve(
              m, mesh,
              mesh.textureRepeat ?? textureRepeat ?? 1,
              mesh.textureRepeatY ?? textureRepeatY
            );
          }
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
      // El acabado del panel también manda aquí: un objeto sin textura
      // puede ser mate, brillante, metálico o espejo.
      const finish = mesh.textureFinish ?? 'semi-matte';
      const material = new THREE.MeshPhysicalMaterial({
        color: hasVertexColors ? 0xffffff : 0xdedede,
        vertexColors: hasVertexColors,
        metalness: finish === 'metallic' ? 0.3 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.05 : finish === 'mirror' ? 1 : 0.3,
        roughness: finish === 'metallic' ? 0.1 : finish === 'glossy' ? 0 : finish === 'matte' ? 0.9 : finish === 'mirror' ? 0.05 : 0.45,
        clearcoat: finish === 'metallic' ? 1 : finish === 'glossy' ? 0 : finish === 'mirror' ? 1 : 0,
        clearcoatRoughness: finish === 'metallic' ? 0.015 : finish === 'glossy' ? 0.015 : finish === 'mirror' ? 0 : 0,
        envMapIntensity: finish === 'mirror' ? 1.5 : 0,
        flatShading: true,
        side: THREE.DoubleSide,
        transparent: typeof mesh.opacity === 'number' && mesh.opacity < 1,
        opacity: typeof mesh.opacity === 'number' ? Math.max(0, Math.min(1, mesh.opacity)) : 1,
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
  }, [
    mesh,
    wireframe,
    smoothShading,
    textureProjection,
    textureHelperTransform,
    // La cara elegida para la UV depende de la ESCALA del objeto (mismo
    // criterio que la pieza amarilla): al estirarlo, la textura se
    // reproyecta sobre la cara que ahora es la grande.
    transform.sx,
    transform.sy,
    transform.sz,
  ]);

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
      visual.add(
        buildTextureHelperVisual(textureProjection, mesh.vertices, transform)
      );
    }
    applyTextureHelperTransform(textureHelperTransformRef.current);
  }, [
    textureHelper,
    textureProjection,
    mesh,
    applyTextureHelperTransform,
    // La cara elegida depende de la ESCALA del objeto: al estirarlo se
    // recoloca la pieza (la posición y el giro no la cambian).
    transform.sx,
    transform.sy,
    transform.sz,
  ]);

  // Escala las asas del gizmo de ayuda de textura al tamaño de la malla,
  // igual que el gizmo principal.
  useEffect(() => {
    const giz = textureHelperGizmoGroupRef.current;
    if (!giz) return;
    const on = !!textureHelper && mesh.vertices.length > 0;
    if (!on) return;
    const box = new THREE.Box3();
    for (const v of mesh.vertices) {
      box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
    }
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const objectScale =
      Math.max(
        Math.abs(transform.sx),
        Math.abs(transform.sy),
        Math.abs(transform.sz)
      ) || 1;
    // El manipulador cuelga del grupo de la malla, que YA lleva aplicada
    // la escala del objeto. Como aquí ya multiplicábamos por objectScale,
    // la escala se aplicaba dos veces (escala²): con objetos grandes el
    // gizmo explotaba — el cubo blanco central llenaba la vista y los aros
    // y flechas se veían como líneas enormes. Descontamos la escala del
    // padre para que su tamaño en pantalla coincida con el del gizmo
    // principal (que cuelga de la escena, sin escala heredada).
    const worldScale = Math.min(Math.max(r * 0.9 * objectScale, 0.35), 8);
    // La escala del padre se descuenta EJE A EJE, no con un escalar único:
    // un escalar solo vale si la escala del objeto es uniforme. Con una
    // figura plana o estirada (una pared, una placa, un tubo) el eje corto
    // aplastaba el manipulador contra esa dirección y los tres aros
    // cruzados quedaban como una calcomanía de dos dimensiones pegada al
    // objeto. Dividiendo por la escala de cada eje el manipulador vuelve a
    // ser uniforme en el mundo — igual que el principal, que al colgar de
    // la escena nunca se deformaba.
    // Se divide por la escala CON signo: así el producto padre×hijo sale
    // positivo (+worldScale) en los tres ejes y una figura espejada no
    // invierte el manipulador ni lo hace desaparecer por el culling.
    giz.scale.set(
      worldScale / (transform.sx || 1),
      worldScale / (transform.sy || 1),
      worldScale / (transform.sz || 1)
    );
  }, [textureHelper, mesh.vertices, transform]);

  // Ventanas 2D: mismas reglas de visibilidad que el gizmo principal para
  // las asas del manipulador de textura — el eje que apunta a la cámara se
  // retira (su drag muere sin avisar en orto: closestPointOnAxis da null)
  // y solo queda un aro de rotación en plano de pantalla. Diferencia: el
  // gizmo de textura cuelga del grupo de la malla, así que sus ejes son
  // LOCALES al objeto — la dirección de la cámara se convierte a ese
  // espacio antes de clasificar el eje (con un objeto girado, el asa que
  // sobra es la de SU eje profundo, no siempre la del eje del mundo).
  useEffect(() => {
    const giz = textureHelperGizmoGroupRef.current;
    if (!giz) return;
    const on = !!textureHelper && mesh.vertices.length > 0;
    let flatAxis: GizmoAxis | undefined;
    if (on && flat2DRef.current && cameraRef.current) {
      const meshGroup = meshGroupRef.current;
      if (meshGroup) {
        meshGroup.updateWorldMatrix(true, false);
        const invRot = meshGroup
          .getWorldQuaternion(new THREE.Quaternion())
          .invert();
        const dir = cameraRef.current
          .getWorldDirection(new THREE.Vector3())
          .applyQuaternion(invRot);
        flatAxis =
          Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z)
            ? 'x'
            : Math.abs(dir.y) >= Math.abs(dir.z)
              ? 'y'
              : 'z';
      }
    }
    for (const h of textureHelperHandlesRef.current) {
      const ud = h.userData as { mode: string; axis?: GizmoAxis };
      const m = ud.mode;
      h.visible =
        (flatAxis === undefined
          ? true
          : m === 'rotate'
            ? ud.axis === flatAxis
            : m === 'planar-scale'
              ? ud.axis === flatAxis
              : m === 'uniform-scale'
                ? true
                : ud.axis !== flatAxis) &&
        // Checkbox «Círculos»: también gobierna los aros del gizmo de
        // textura (misma casilla para ambos manipuladores).
        (m === 'rotate' ? showRotate : true);
    }
  }, [textureHelper, mesh.vertices, transform, flat2D, showRotate]);

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

  /**
   * Cuerpo de la cámara-objeto ACTIVA dentro de meshGroup: es un hijo más
   * del grupo (la malla principal está vacía para las cámaras), de modo
   * que el gizmo XYZ y applyObjectTransform la mueven igual que una
   * figura. Se orienta SIEMPRE hacia su foco (lookAt): el fotograma
   * seleccionado mientras haya uno, y camera.target en su defecto.
   */
  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;
    const activa = (objects ?? []).find(
      (o) => o.id === selectedObjectId && o.kind === 'camera'
    );
    const anteriores = meshGroup.children.filter((c) => c.userData.cameraBodyActive);
    for (const viejo of anteriores) {
      if (!activa || viejo.userData.sceneObjectId !== activa.id) {
        meshGroup.remove(viejo);
        viejo.traverse((item) => {
          const m = item as THREE.Mesh;
          m.geometry?.dispose();
          if (m.material) disposeMaterial(m.material);
        });
      }
    }
    if (!activa) return;
    let root = anteriores.find((c) => c.userData.sceneObjectId === activa.id);
    if (!root) {
      root = buildCameraObjectVisual(activa.camera);
      root.name = 'cameraBodyRoot';
      root.userData.cameraBodyActive = true;
      root.userData.sceneObjectId = activa.id;
      meshGroup.add(root);
    }
    const foco =
      cameraEditor?.objectId === activa.id
        ? cameraEditor.focus
        : activa.camera?.target ?? null;
    orientCameraBodyVisual(root, foco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedObjectId, cameraEditor]);

  // Recorrido 3D de la cámara-objeto seleccionada: curva + asas. Solo
  // cuando el objeto activo ES una cámara (y fuera de la vista de cámara).
  useEffect(() => {
    const activa = (objects ?? []).find(
      (o) => o.id === selectedObjectId && o.kind === 'camera'
    );
    rebuildCameraObjectPathRef.current({
      keyframes: activa?.camera?.keyframes ?? [],
      selected: cameraEditor?.keyframeIndex ?? null,
      focus: cameraEditor?.focus ?? null,
      visible: !!activa,
    });
  }, [objects, selectedObjectId, cameraEditor]);

  // Recorrido 3D del objeto seleccionado (pistas de transformada del
  // editor de movimiento): la posición de cada asa es el transform
  // estático del objeto con los valores del fotograma encima.
  useEffect(() => {
    const track = transformTracks?.find(
      (tr) => tr.objectId === selectedObjectId
    );
    const obj = (objects ?? []).find((o) => o.id === selectedObjectId);
    if (!track || !obj || !showMotionPath) {
      rebuildObjectMotionPathRef.current(null);
      return;
    }
    const keyframes = track.keyframes.map((kf) => {
      const vals = evaluateTransformTrack(track, kf.time) ?? {};
      const merged = { ...obj.transform, ...vals };
      return {
        time: kf.time,
        position: { x: merged.px ?? 0, y: merged.py ?? 0, z: merged.pz ?? 0 },
      };
    });
    rebuildObjectMotionPathRef.current({ keyframes, visible: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformTracks, objects, selectedObjectId, showMotionPath]);

   useEffect(() => {
   const meshGroup = meshGroupRef.current;
   if (!meshGroup) return;

    // Limpieza de huérfanos: al reemplazar la escena ("En escena nueva")
    // o al borrar un objeto, los duplicados de los objetos que salieron
    // de la lista deben desaparecer del visor. Antes este efecto solo
    // creaba y actualizaba duplicados: los de los objetos antiguos
    // quedaban huérfanos como hijos del grupo y seguían dibujándose
    // junto a los nuevos. Se hace antes de cualquier early-return para
    // que ocurra aunque la escena quede vacía o sin selección.
    const validIds = new Set((objects ?? []).map((object) => object.id));
    for (const child of [...meshGroup.children]) {
      if (!child.userData.sceneObjectDuplicate) continue;
      if (validIds.has(child.userData.sceneObjectId)) continue;
      meshGroup.remove(child);
      child.traverse((item) => {
        const childMesh = item as THREE.Mesh;
        childMesh.geometry?.dispose();
        if (childMesh.material) disposeMaterial(childMesh.material);
      });
    }

    if (!objects?.length) return;

    const selected = objects.find((object) => object.id === selectedObjectId);
    // Sin objeto activo, la malla principal no representa a nadie: cada
    // objeto se muestra con su duplicado y sus efectos siguen enganchados
    // a SU visual aunque no haya nada seleccionado.

    if (selected) {
      // La malla principal representa siempre el objeto activo: al cambiar
      // la selección se reconstruye con la figura del recién elegido (es
      // la malla que llega como prop). La copia que tenía en la escena ya
      // no hace falta —su figura es ahora la principal— y la figura del
      // que se deja la crea el bucle de abajo con sus propios datos.
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
      meshGroup.userData.sceneObjectId = selected.id;
    } else {
      meshGroup.userData.sceneObjectId = undefined;
    }
    displayedObjectIdRef.current = selected?.id;
    const selectedMatrix = selected
      ? new THREE.Matrix4().compose(
          new THREE.Vector3(selected.transform.px, selected.transform.py, selected.transform.pz),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(selected.transform.rx, selected.transform.ry, selected.transform.rz)
          ),
          new THREE.Vector3(selected.transform.sx, selected.transform.sy, selected.transform.sz)
        )
      : new THREE.Matrix4();
    // Sin activo, el grupo principal conserva la transformación del último
    // activo: los duplicados se expresan relativos a ESE marco.
    const inverseSelected = selected
      ? selectedMatrix.clone().invert()
      : meshGroup.matrix.clone().invert();

     for (const object of objects) {
       if (selected && object.id === selected.id) continue;
       // Find or create the duplicate for this object
       let duplicate = meshGroup.children.find(
         (child) => child.userData.sceneObjectDuplicate && child.userData.sceneObjectId === object.id
       ) as THREE.Group | undefined;

       // Config cambió SIN seleccionar el objeto (p. ej. tex/acabado/opacidad
       // escritos en su malla desde Escena o por el agente): el duplicado que
       // había dibujaba el material viejo — se rehace desde su instantánea.
       const firma = firmaVisualObjeto(object);
       if (duplicate && duplicate.userData.sceneObjectFirma !== firma) {
         meshGroup.remove(duplicate);
         duplicate.traverse((item) => {
           const childMesh = item as THREE.Mesh;
           childMesh.geometry?.dispose();
           if (childMesh.material) disposeMaterial(childMesh.material);
         });
         duplicate = undefined;
       }

       // Handle hidden objects: remove existing duplicate
       if (object.hidden) {
         if (duplicate) {
           meshGroup.remove(duplicate);
         }
         continue;
       }

       // If the duplicate doesn't exist, create it
       if (!duplicate) {
        duplicate = new THREE.Group();
        duplicate.userData.sceneObjectId = object.id;
        duplicate.userData.sceneObjectDuplicate = true;
        duplicate.userData.sceneObjectFirma = firma;
        // Cada objeto muestra SU propia instantánea congelada, sea o no
        // el dueño de la configuración: la figura de un objeto no puede
        // mutar porque cambie la pestaña activa del editor (el dueño se
        // congela al salir de su pestaña, así que su instantánea ya está
        // fresca). Solo un dueño recién creado que aún no se ha congelado
        // usa la figura viva de su pestaña como último recurso. Sin
        // instantánea ni figura viva el duplicado queda vacío: ya no se
        // clona la figura principal como "fantasma".
        if (object.mesh && object.mesh.vertices.length > 0) {
          duplicate.add(
            buildSnapshotObjectVisual(
              object.mesh,
              object.smooth ?? false,
              object.textureProjection ?? 'planar',
              undefined,
              object.mesh.textureRepeat ?? 1,
              object.mesh.textureRepeatY,
              envCreadaRef.current
            )
          );
        } else if (
          object.id === configObjectId &&
          (configMesh ?? mesh) &&
          (configMesh ?? mesh).vertices.length > 0
        ) {
          duplicate.add(
            buildSnapshotObjectVisual(
              configMesh ?? mesh,
              configSmooth ?? smoothShading,
              configProjection ?? textureProjection,
              (configMesh ?? mesh).textureFinish ?? 'semi-matte',
              undefined,
              undefined,
              envCreadaRef.current
            )
          );
        } else if (object.kind === 'camera') {
          // Cámara-objeto: cuerpo + cono de visión, sin malla.
          duplicate.add(buildCameraObjectVisual(object.camera));
          duplicate.name = `cameraBodyRoot:${object.id}`;
          // Mira a su foco (posición del fotograma o camera.target).
          const focoDuplicada = object.camera?.keyframes[0]?.target ?? object.camera?.target;
          orientCameraBodyVisual(duplicate, focoDuplicada ?? null);
        }
        meshGroup.add(duplicate);
      }
        // En modo boolean preview: el objeto cortador (duplicate) se muestra transparente
        if (booleanToolObjectId === object.id) {
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && child.material) {
              if (Array.isArray(child.material)) {
                child.material = child.material.map((m) =>
                  m && !(m as any).isBooleanPreview ? cloneAndStyleToolMaterial(m) : m
                );
              } else if (!(child.material as any).isBooleanPreview) {
                child.material = cloneAndStyleToolMaterial(child.material);
              }
            }
          });
        }
        // Si no es el tool: restaurar materiales clonados de preview previo
        if (booleanToolObjectId !== object.id) {
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && child.material) {
              if (Array.isArray(child.material)) {
                child.material = child.material.map((m) =>
                  m && (m as any).isBooleanPreview ? (m as any).originalMaterial : m
                );
              } else if ((child.material as any).isBooleanPreview) {
                child.material = (child.material as any).originalMaterial;
              }
            }
          });
        }
        // Apply frozen/unfrozen visual
        if (object.frozen && !duplicate.userData.isFrozen) {
          duplicate.userData.isFrozen = true;
          duplicate.userData.originalMaterials = [];
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && child.material) {
              const originals = Array.isArray(child.material)
                ? child.material.map((m) => m.clone())
                : [child.material.clone()];
              (child.userData as any).originalMaterials = originals;
              const grayMat = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.9,
                metalness: 0,
              });
              if (Array.isArray(child.material)) {
                child.material = child.material.map(() => grayMat);
              } else {
                child.material = grayMat;
              }
            }
          });
        } else if (!object.frozen && duplicate.userData.isFrozen) {
          duplicate.userData.isFrozen = false;
          duplicate.traverse(function (child) {
            if (child instanceof THREE.Mesh && (child.userData as any).originalMaterials) {
              const originals = (child.userData as any).originalMaterials;
              if (Array.isArray(child.material) && Array.isArray(originals)) {
                child.material = originals;
              } else if (!Array.isArray(child.material) && !Array.isArray(originals) && originals.length >= 1) {
                child.material = originals[0];
              }
              delete (child.userData as any).originalMaterials;
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

    // --- Orden de pintado de transparencias anidadas ------------------------
    // Todos los objetos de la escena se pintan como transparentes y three
    // los ordena por distancia al centro: con uno DENTRO de otro (líquido
    // dentro de la botella) esa ordenación cambia con la inclinación de la
    // cámara y a veces sale el contenedor primero. Entonces su pared
    // delantera escribe profundidad y CULLE al líquido: desaparecía según
    // el ángulo. Regla estable: quien esté contenido en la caja de otro
    // pinta ANTES (interior → contenedor), fijando renderOrder (que manda
    // sobre el orden por distancia); sin contención manda la distancia.
    const transparencias: { obj: THREE.Object3D; box: THREE.Box3 }[] = [];
    meshGroup.updateMatrixWorld(true);
    for (const object of objects) {
      if (object.hidden || object.kind === 'camera') continue;
      if (selected && object.id === selected.id) {
        const mainObj = findMainMesh(meshGroup);
        if (mainObj) {
          mainObj.updateMatrixWorld(true);
          transparencias.push({ obj: mainObj, box: new THREE.Box3().setFromObject(mainObj) });
        }
        continue;
      }
      const duplicate = meshGroup.children.find(
        (child) => child.userData.sceneObjectDuplicate && child.userData.sceneObjectId === object.id
      );
      if (!duplicate) continue;
      duplicate.updateMatrixWorld(true);
      transparencias.push({ obj: duplicate, box: new THREE.Box3().setFromObject(duplicate) });
    }
    for (const a of transparencias) {
      if (a.box.isEmpty()) continue;
      let contenedores = 0;
      for (const b of transparencias) {
        if (b === a || b.box.isEmpty()) continue;
        if (b.box.containsPoint(a.box.getCenter(new THREE.Vector3()))) contenedores++;
      }
      const orden = -contenedores;
      a.obj.traverse((hijo) => {
        hijo.renderOrder = orden;
      });
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
    configFinish,
    configRelief,
    smoothShading,
    textureProjection,
    ]);

  // --- Exclusión de luces por objeto (luz ambiente y focos) ----------
  // Excluir un objeto de una luz NO puede hacerse con capas de three:
  // las luces se recogen por CÁMARA (todas las luces de la pasada
  // entran en el shader de todos los materiales), así que se quita la
  // contribución del PROGRAMA del material: parcheo con
  // onBeforeCompile + uniformes por material. Cada objeto tiene sus
  // propios materiales (los build*Visual los crean frescos), así que
  // el parche queda contenido y se actualiza SIN recompilar al
  // cambiar la lista de excluidos. Límite: hasta 8 focos exluidos
  // por objeto (la lista de posiciones del uniforme va fija a 8).
  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;
    const aplicar = (
      mat: THREE.Material & { userData: Record<string, unknown> },
      amb: boolean,
      focos: THREE.Vector3[]
    ) => {
      let ya = mat.userData.excluyeLuces as
        | {
            amb: { value: number };
            n: { value: number };
            pos: { value: THREE.Vector3[] };
          }
        | undefined;
      if (!ya) {
        const uAmb = { value: amb ? 1 : 0 };
        const uN = { value: focos.length };
        const uPos = {
          value: [0, 1, 2, 3, 4, 5, 6, 7].map(
            (i) => focos[i] ?? new THREE.Vector3()
          ),
        };
        ya = { amb: uAmb, n: uN, pos: uPos };
        mat.userData.excluyeLuces = ya;
        const clave = `excluye-luces-${++contadorExclusiones}`;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.excluirAmbiente = uAmb;
          shader.uniforms.excluirFocos = uN;
          shader.uniforms.excluirFocoPos = uPos;
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
uniform float excluirAmbiente;
uniform int excluirFocos;
uniform vec3 excluirFocoPos[8];`
            )
            // El fragmento llega con los #include SIN resolver: ni la
            // línea del `irradiance` ambiente ni `spotLight = ...`
            // existen todavía como texto — el reemplazo va anclado al
            // TAG del bloque de luces, con el trozo ya preparado
            // (LUCES_FRAG_INICIO, a nivel de módulo) en la mano.
            .replace('#include <lights_fragment_begin>', LUCES_FRAG_INICIO);
        };
        mat.customProgramCacheKey = () => clave;
      }
      // La máscara llega por posición MUNDIAL del foco: es lo que el
      // shader ve en spotLights[].position (el foco cuelga de la raíz).
      ya.amb.value = amb ? 1 : 0;
      ya.n.value = focos.length;
      ya.pos.value = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) => focos[i] ?? new THREE.Vector3()
      );
    };
    // Material de PROFUNDIDAD por malla: three lo genera para el mapa
    // de sombras ignorando el `opacity` del material de pintura, así
    // que se cuelga uno propio (userData.matSombra) con uniformes
    // propios: el peso de la sombra según opacidad (con tramado) y
    // las posiciones de los focos que excluyen al objeto — en ese
    // pase cameraPosition ES la cámara-de-sombra del foco, así que
    // descartar por posición lo saca de SU mapa de sombras (una capa
    // por foco no existe: las capas se prueban contra la cámara del
    // visor, WebGLShadowMap.js ~522).
    const aplicarSombra = (
      malla: THREE.Mesh,
      mats: THREE.Material[],
      focos: THREE.Vector3[]
    ) => {
      let dmat = malla.customDepthMaterial as THREE.MeshDepthMaterial | null;
      if (!dmat) {
        const nueva = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
        });
        const uOpac = { value: 1 };
        const uN = { value: 0 };
        const uPos = {
          value: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3()),
        };
        nueva.userData.sombraLuces = { opac: uOpac, n: uN, pos: uPos };
        nueva.onBeforeCompile = (shader) => {
          shader.uniforms.sombraOpac = uOpac;
          shader.uniforms.sombraFocos = uN;
          shader.uniforms.sombraFocoPos = uPos;
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
uniform float sombraOpac;
uniform int sombraFocos;
uniform vec3 sombraFocoPos[8];`
            )
            .replace(
              '#include <clipping_planes_fragment>',
              `#include <clipping_planes_fragment>
	if ( sombraFocos > 0 ) {
		for ( int s = 0; s < sombraFocos; s ++ ) {
			if ( cameraPosition == sombraFocoPos[ s ] ) discard;
		}
	}
	if ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) > sombraOpac ) discard;`
            );
        };
        nueva.customProgramCacheKey = () =>
          `sombra-luces-${++contadorExclusiones}`;
        malla.customDepthMaterial = nueva;
        dmat = nueva;
      }
      const yaSombra = dmat.userData.sombraLuces as {
        opac: { value: number };
        n: { value: number };
        pos: { value: THREE.Vector3[] };
      };
      yaSombra.opac.value = Math.max(0, Math.min(1, mats[0]?.opacity ?? 1));
      yaSombra.n.value = focos.length;
      yaSombra.pos.value = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) => focos[i] ?? new THREE.Vector3()
      );
      // Muere con su pintura: colgado del userData del material
      // principal, disposeMaterial lo libera sin editar cada sitio.
      if (mats[0] && mats[0].userData.matSombra !== dmat) {
        (mats[0].userData as Record<string, unknown>).matSombra = dmat;
      }
    };
    for (const child of meshGroup.children) {
      const oid = child.userData.sceneObjectDuplicate
        ? (child.userData.sceneObjectId as string | undefined)
        : (meshGroup.userData.sceneObjectId as string | undefined);
      if (!oid) continue;
      const amb = !!lightConfig?.ambient.excluyeObjetos?.includes(oid);
      const focos: THREE.Vector3[] = [];
      for (const sp of lightConfig?.spotlights ?? []) {
        if (sp.excluyeObjetos?.includes(oid)) {
          focos.push(new THREE.Vector3(sp.position.x, sp.position.y, sp.position.z));
        }
      }
      child.traverse((item) => {
        const m = item as THREE.Mesh;
        if (!m.isMesh || !m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        // Sombra: peso según opacidad y focos que lo excluyen.
        aplicarSombra(m, mats, focos);
        if (!amb && focos.length === 0) {
          // Sin exclusiones: si el material quedó parcheado antes, dejarlo
          // neutro (la malla se reconstruye a menudo; al dejar el parche
          // con uniformes a cero no hace falta recompilar).
          for (const mat of mats) {
            const ya = (mat.userData?.excluyeLuces ?? undefined) as
              | { amb: { value: number }; focos: { value: THREE.Vector3[] } }
              | undefined;
            if (ya) aplicar(mat, false, []);
          }
          return;
        }
        const vistos = new Set<THREE.Material>();
        for (const mat of mats) {
          if (vistos.has(mat)) continue;
          vistos.add(mat);
          aplicar(mat as THREE.Material & { userData: Record<string, unknown> }, amb, focos);
        }
      });
    }
  }, [objects, lightConfig, mesh, configMesh, selectedObjectId]);

  // --- Sincronización de efectos por objeto ------------------------------
  // Crea, ajusta y libera un runtime de FX por objeto que tenga efectos
  // propios o una pista de efecto que lo apunte. El grupo del runtime se
  // engancha al grupo visual del objeto (duplicado, o la malla principal
  // si es el activo) para seguir su transform.
  const sincronizarFx = useCallback(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;
    const activoId = meshGroup.userData.sceneObjectId as string | undefined;
    const objetos = objectsRefFx.current ?? [];
    const pistas = effectTracksRef.current ?? [];
    const objetivos = new Set<string>();
    for (const obj of objetos) if (obj.efectos?.length) objetivos.add(obj.id);
    for (const tr of pistas) {
      if (tr.objectId) objetivos.add(tr.objectId);
      else if (activoId) objetivos.add(activoId);
      for (const id of tr.objectIds ?? []) objetivos.add(id);
    }
    // Runtimes que ya no hacen falta: fuera.
    for (const [id, rt] of [...fxObjetosRef.current.entries()]) {
      if (objetivos.has(id)) continue;
      fxObjetosRef.current.delete(id);
      disponerSistemasFx(rt);
      rt.grupo.parent?.remove(rt.grupo);
    }
    if (objetivos.size === 0) return;
    const hayPistaDe = (id: string, tipo: EffectType): boolean =>
      pistas.some(
        (tr) =>
          tr.effectType === tipo &&
          (tr.objectId === id ||
            tr.objectIds?.includes(id) ||
            (!tr.objectId && !tr.objectIds?.length && id === activoId))
      );
    for (const obj of objetos) {
      if (!objetivos.has(obj.id)) continue;
      const visual =
        obj.id === activoId
          ? meshGroup
          : meshGroup.children.find(
              (c) =>
                c.userData.sceneObjectDuplicate &&
                c.userData.sceneObjectId === obj.id
            ) ?? null;
      if (!visual) continue;
      let rt = fxObjetosRef.current.get(obj.id);
      if (!rt) {
        rt = crearRuntimeFxObjeto(obj.id, obj.mesh ?? null);
        fxObjetosRef.current.set(obj.id, rt);
      }
      if (rt.grupo.parent !== visual) {
        rt.grupo.parent?.remove(rt.grupo);
        visual.add(rt.grupo);
      }
      // Malla nueva: las cajas de lluvia/humo y el muestreo cambian.
      const malla = obj.mesh ?? null;
      if (rt.malla !== malla) {
        rt.malla = malla;
        rt.sampler = muestreadorDeMalla(malla);
        for (const tipo of ['rain', 'smoke'] as const) {
          if (!rt.estatico[tipo]) continue;
          const sys = tipo === 'rain' ? rt.rain : rt.smoke;
          if (sys) {
            rt.grupo.remove(sys.points);
            sys.points.geometry.dispose();
            (sys.points.material as THREE.Material)?.dispose();
            if (tipo === 'rain') rt.rain = null;
            else rt.smoke = null;
          }
        }
      }
      // Focos/estrellas serializados → runtime (reconstruye al deshacer).
      const listaEfectos = validarEfectos(obj.efectos) ?? [];
      const estatico: Partial<Record<EffectType, EfectoValores>> = {};
      const focosSer: RuntimeFxObjeto['focos'] = { fire: [], smoke: [], sparks: [] };
      const estrellasSer: { x: number; y: number; z: number; tamaño?: number }[] = [];
      for (const efecto of listaEfectos) {
        for (const f of efecto.focos ?? []) {
          const destino = focosSer[efecto.tipo as 'fire' | 'smoke' | 'sparks'];
          if (destino) destino.push(new THREE.Vector3(f.x, f.y, f.z));
        }
        if (efecto.tipo === 'stars') {
          for (const p of efecto.estrellas ?? []) {
            estrellasSer.push({ x: p.x, y: p.y, z: p.z, tamaño: p.tamaño });
          }
        }
        if (efecto.activo) estatico[efecto.tipo] = valoresEfecto(efecto);
      }
      rt.estatico = estatico;
      const firmaF = firmaDeFocos(focosSer);
      if (firmaF !== rt.firmaFocos) {
        rt.focos = focosSer;
        clearFxAnchors(rt.anchorGroup, rt.focos);
        for (const kind of ['fire', 'smoke', 'sparks'] as const) {
          for (const punto of rt.focos[kind]) {
            const marker = makeAnchorMarker(kind);
            marker.position.copy(punto);
            rt.anchorGroup.add(marker);
          }
        }
        rt.firmaFocos = firmaF;
      }
      const firmaE = firmaPuntos(estrellasSer);
      if (firmaE !== rt.firmaEstrellas) {
        rt.estrellas = estrellasSer;
        clearPlacedStars(rt.colocadas);
        for (const p of estrellasSer) {
          addPlacedStar(rt.colocadas, new THREE.Vector3(p.x, p.y, p.z), p.tamaño ?? 1);
        }
        rt.firmaEstrellas = firmaE;
      }
      // Sistemas estáticos: crear/ajustar los encendidos, quitar los que
      // ya ni están estáticos ni los anima una pista.
      for (const tipo of TIPOS_FX) {
        if (tipo === 'glow') continue;
        const valores = estatico[tipo];
        if (valores) {
          asegurarSistemaFx(rt, tipo, valores, true);
        } else if (!hayPistaDe(obj.id, tipo)) {
          const sys =
            tipo === 'rain'
              ? rt.rain
              : tipo === 'smoke'
                ? rt.smoke
                : tipo === 'fire'
                  ? rt.fire
                  : tipo === 'sparks'
                    ? rt.sparks
                    : rt.stars;
          if (sys) {
            const points = tipo === 'stars' ? null : (sys as { points: THREE.Points }).points;
            if (points) {
              rt.grupo.remove(points);
              points.geometry.dispose();
              (points.material as THREE.Material)?.dispose();
            }
            if (tipo === 'stars') {
              for (const s of (sys as { stars: { sprite: THREE.Sprite }[] }).stars) {
                s.sprite.material.dispose();
              }
              rt.grupo.remove((sys as { group: THREE.Group }).group);
            }
            if (tipo === 'rain') rt.rain = null;
            else if (tipo === 'smoke') rt.smoke = null;
            else if (tipo === 'fire') rt.fire = null;
            else if (tipo === 'sparks') rt.sparks = null;
            else rt.stars = null;
          }
        } else {
          // Solo pista: al parar la reproducción queda en silencio.
          silenciarSistemaFx(rt, tipo);
        }
      }
      // Glow estático o por pista.
      const valoresGlow = estatico.glow;
      if (valoresGlow) {
        asegurarGlowFx(rt, valoresGlow, true);
      } else if (!hayPistaDe(obj.id, 'glow')) {
        for (const shell of rt.glowShells) rt.grupo.remove(shell);
        rt.glowShells = [];
        rt.glowShellsFirma = '';
        rt.glowMaterial?.dispose();
        rt.glowMaterial = null;
      } else {
        for (const shell of rt.glowShells) shell.visible = false;
      }
      // Flags estáticos (las pistas los pisan durante la reproducción).
      rt.rainActivo = !!estatico.rain;
      rt.smokeActivo = !!estatico.smoke;
      rt.starsOn = !!estatico.stars;
      rt.starSize = estatico.stars?.starSize ?? 1;
    }
  }, [objects, selectedObjectId, mesh, effectTracks]);
  const sincronizarFxRef = useRef(sincronizarFx);
  sincronizarFxRef.current = sincronizarFx;
  useEffect(() => {
    sincronizarFx();
  }, [sincronizarFx]);
  // El bucle de animación y el editor de movimiento usan esta API.
  fxApiRef.current.runtimeDe = (id: string, crear = false): RuntimeFxObjeto | null => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return null;
    const activoId = meshGroup.userData.sceneObjectId as string | undefined;
    const visual =
      id === activoId
        ? meshGroup
        : meshGroup.children.find(
            (c) =>
              c.userData.sceneObjectDuplicate &&
              c.userData.sceneObjectId === id
          ) ?? null;
    if (!visual) return null;
    let rt = fxObjetosRef.current.get(id);
    if (!rt) {
      if (!crear) return null;
      const obj = objectsRefFx.current?.find((o) => o.id === id);
      rt = crearRuntimeFxObjeto(id, obj?.mesh ?? null);
      fxObjetosRef.current.set(id, rt);
    }
    if (rt.grupo.parent !== visual) {
      rt.grupo.parent?.remove(rt.grupo);
      visual.add(rt.grupo);
    }
    return rt;
  };
  fxApiRef.current.sincronizar = () => sincronizarFxRef.current();

    // --- Highlight for multi-selected objects: draw a wireframe box ---
    useEffect(() => {
     const meshGroup = meshGroupRef.current;
     if (!meshGroup) return;
     meshGroup.updateMatrixWorld();
     let highlightGroup = meshGroup.userData.multiSelectHighlight as THREE.Group | undefined;
     if (!highlightGroup) {
       highlightGroup = new THREE.Group();
       meshGroup.add(highlightGroup);
       meshGroup.userData.multiSelectHighlight = highlightGroup;
     }
      highlightGroup.clear();
      const selectedIds = selectedObjectIdsRef.current ?? [];
       if (selectedIds.length === 0) return;
      const cajaUnion = new THREE.Box3();
      const activoId = meshGroup.userData.sceneObjectId as string | undefined;
      const principal = meshGroup.children.find(
        (c) => !c.userData.sceneObjectDuplicate
      );
      if (principal && activoId && selectedIds.includes(activoId)) {
        cajaUnion.expandByObject(principal);
      }
       for (const child of meshGroup.children) {
        if (!child.userData.sceneObjectDuplicate) continue;
        if (!selectedIds.includes(child.userData.sceneObjectId)) continue;
        const box = new THREE.Box3().setFromObject(child);
        if (box.isEmpty()) continue;
        cajaUnion.union(box);
        const helper = new THREE.Box3Helper(box, 0x38bdf8);
        highlightGroup.add(helper);
      }
      // El gizmo multi-selección se centra en el conjunto al cambiar la
      // selección (el gizmo solo se re-deriva con el transform del activo).
      const giz = gizmoGroupRef.current;
      if (
        giz &&
        selectedIds.length > 1 &&
        !cajaUnion.isEmpty() &&
        !gizmoDragRef.current &&
        !selectionModeRef.current
      ) {
        giz.position.copy(cajaUnion.getCenter(new THREE.Vector3()));
      }
     }, [selectedObjectIds, objects?.length, forceObjectsUpdate]);
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
 

  // --- Modo colocación de estrellas: cursor de mira ---
  useEffect(() => {
    const dom = rendererRef.current?.domElement;
    if (dom) dom.style.cursor = placeTarget ? 'crosshair' : '';
  }, [placeTarget]);

  // Al cambiar la malla del objeto ACTIVO (edición de vértices, nuevo
  // texto...), sus focos y estrellas colocadas pierden su sitio: se quitan
  // de sus efectos (persistidos). Cambiar de objeto NO limpia nada: los
  // efectos de cada objeto son suyos.
  const fxMallaLimpiaRef = useRef<{ oid: string | null | undefined; mesh: Mesh | null }>({
    oid: null,
    mesh: null,
  });
  useEffect(() => {
    const oid = displayedObjectIdRef.current ?? selectedObjectId ?? null;
    const prev = fxMallaLimpiaRef.current;
    if (prev.oid !== oid) {
      // Cambio de objeto (o primer render): no limpiar nada ajeno.
      prev.oid = oid;
      prev.mesh = mesh;
      return;
    }
    if (prev.mesh === mesh) return;
    prev.mesh = mesh;
    if (!oid) return;
    const lista = objectsRefFx.current?.find((o) => o.id === oid)?.efectos;
    if (!lista?.length) return;
    const cambios: Record<string, EfectoObjeto[]> = {
      [oid]: lista.map((e) => ({ ...e, focos: [], estrellas: [] })),
    };
    onEfectosObjetosRef.current?.(cambios);
  }, [mesh, selectedObjectId]);

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
    // AZUL OSCURO (no celeste): el usuario lo pidió — usa el mismo azul de
    // las guías de selección para que se distinga sobre las texturas claras.
    const matNormal = new THREE.MeshBasicMaterial({ color: 0x1d4ed8 });
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

  // ---- Fondo (cielo) opcionalmente afectado por las luces ----------------
  // Factor de brillo del fondo según la luz total. Solo actúa si el usuario
  // lo activa (lightConfig.affectSky); si no, devuelve 1 (sin cambios).
  const computeSkyLightFactor = (): number => {
    const cfg = lightConfigRef.current;
    if (!cfg?.affectSky) return 1;
    let total = 0;
    if (cfg.ambient.enabled) total += cfg.ambient.intensity;
    for (const s of cfg.spotlights) {
      if (s.enabled) total += s.intensity * 0.15;
    }
    return Math.min(1, Math.max(0, total));
  };

  const applySkyLighting = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const factor = computeSkyLightFactor();
    const skybox = skyboxRef.current;
    if (skybox) {
      (skybox.material as THREE.MeshBasicMaterial).color.setScalar(factor);
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(skyBaseColorRef.current).multiplyScalar(factor);
    }
  };

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
      skybox.visible = !!skyboxImage && !flat2DRef.current;
      scene.background = null;
    } else {
      material.map = null;
      material.needsUpdate = true;
      // En ventanas 2D el fondo lo lleva el CSS del contenedor: sin
      // skybox y sin color de fondo escena (canvas transparente).
      skybox.visible = false;
      scene.background = flat2DRef.current
        ? null
        : skyBaseColorRef.current.clone();
    }
    applySkyLighting();
  }, [skyboxImage]);

   // Ground texture
  useEffect(() => {
    const ground = groundRef.current;
    if (!ground) return;
     const material = ground.material as THREE.MeshPhysicalMaterial;
    // Ventanas 2D: el suelo lleva el MeshBasicMaterial del modo plano
    // (aplicarModoPlano). Con él SOLO pintura plana (map+color): ni
    // envMap ni bumpMap — el shader de basic no los compila
    // (envmap_fragment/ENV_WORLDPOS usa el `normal` que el fragmento de
    // basic no declara) y refreshUniformsCommon revienta buscando sus
    // uniformes («Cannot set properties of undefined»). El remontaje al
    // volver a '3d' restaura el material físico y su envMap.
    if (material instanceof THREE.MeshBasicMaterial) {
      if (groundTextureParams) {
        material.map = null;
        material.color.set(groundTextureParams.color);
        material.needsUpdate = true;
      } else if (groundTexture) {
        const loader = new THREE.TextureLoader();
        loader.load(groundTexture, (texture) => {
          const repeatY = groundTextureRepeatY ?? groundTextureRepeat;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          texture.repeat.set(groundTextureRepeat, repeatY);
          material.map = texture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        });
      } else {
        material.map = null;
        material.color.set(0x1a1a2e);
        material.needsUpdate = true;
      }
      return;
    }
    if (groundTextureParams) {
      // Textura creada: material PURO, idéntico a la vista previa — el PNG
      // del mosaico no se usa ni como mapa ni como relieve.
      material.map = null;
      material.bumpMap = null;
      material.bumpScale = 0;
      material.color.set(groundTextureParams.color);
      limpiarExtrasCreados(material);
      aplicarMaterialCreado(material, groundTextureParams);
      if (envCreadaRef.current) material.envMap = envCreadaRef.current;
      material.needsUpdate = true;
    } else if (groundTexture) {
      const loader = new THREE.TextureLoader();
      loader.load(groundTexture, (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        // Repetición por eje: horizontal (X) y vertical (Y) — la Y copia la
        // X salvo que se haya fijado una propia. La MISMA textura genera el
        // relieve del suelo (bumpScale = groundTextureRelief * factor).
        const repeatY = groundTextureRepeatY ?? groundTextureRepeat;
        texture.repeat.set(groundTextureRepeat, repeatY);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        material.map = texture;
        material.bumpMap = texture;
        material.bumpScale = groundTextureRelief * FACTOR_RELIEVE_BUMP;
        material.color.set(0xffffff);
        // El material persiste entre texturas: limpiar los efectos de una
        // textura creada anterior (transmisión, sheen…) antes de aplicar.
        limpiarExtrasCreados(material);
        applyGroundTextureFinish(material, groundTextureFinish);
        // La textura creada manda sobre el acabado: mismo material que la
        // vista previa (transmisión, metalidad, brillo…), con su entorno
        // brillante.
        if (groundTextureParams) {
          aplicarMaterialCreado(material, groundTextureParams);
          if (envCreadaRef.current) material.envMap = envCreadaRef.current;
        }
        material.needsUpdate = true;
      });
    } else {
      material.map = null;
      material.bumpMap = null;
      material.bumpScale = 0;
      material.color.set(0x1a1a2e);
      material.roughness = 0.9;
      material.metalness = 0.0;
      material.envMapIntensity = 0;
      material.envMap = null;
      material.needsUpdate = true;
      limpiarExtrasCreados(material);
    }
    }, [groundTexture, groundTextureRepeat, groundTextureRepeatY, groundTextureFinish, groundTextureRelief, groundTextureParams]);

  const applyGroundTextureFinish = (material: THREE.MeshPhysicalMaterial, finish: string) => {
    material.envMap = cubeRenderTargetRef.current?.texture ?? null;
    material.envMapIntensity = finish === 'mirror' ? 1.5 : 0;
    material.needsUpdate = true;
    switch (finish) {
      case 'glossy':
        material.roughness = 0.1;
        material.metalness = 0.0;
        break;
      case 'metallic':
        material.roughness = 0.1;
        material.metalness = 0.3;
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

    useEffect(() => {
      if (exportMp4Trigger && exportMp4Trigger > exportTriggerRef.current) {
        exportTriggerRef.current = exportMp4Trigger;
        startMp4ExportRef.current?.();
      }
    }, [exportMp4Trigger]);

    useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (lightConfig) {
      // Modo personalizado: aplicar configuración de luces.
      // La intensidad del ambiente la decide el usuario (puede llegar a 0).
      if (ambientLightRef.current) {
        ambientLightRef.current.color.setHex(lightConfig.ambient.color);
        // La intensidad se respeta tal cual (puede llegar a 0): antes se
        // forzaba un mínimo de 0.45 y, al bajar las luces personalizadas
        // al mínimo, la escena nunca oscurecía del todo.
        ambientLightRef.current.intensity = lightConfig.ambient.enabled
          ? lightConfig.ambient.intensity
          : 0;
        ambientLightRef.current.visible = true;
      }
      // En modo personalizado la iluminación la marcan el ambiente y los
      // focos, así que se anula la luz de entorno (IBL) genérica. Los
      // reflejos de espejo siguen intactos porque usan su propio envMap
      // (scene.environmentIntensity solo afecta a materiales sin envMap).
      scene.environmentIntensity = 0;
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
      lightConfig.spotlights.forEach((sp, idx) => {
        if (!sp.enabled) return;
        const spotlight = new THREE.SpotLight(
          sp.color,
          sp.intensity,
          undefined,
          sp.angle,
          sp.penumbra
        );
        spotlight.decay = 0; // no distance attenuation - light visible at all distances
        spotlight.position.set(sp.position.x, sp.position.y, sp.position.z);
        // Apunta al modelo o al objeto vinculado (siguiéndolo si se mueve).
        const spotTarget = resolveSpotTarget(sp, objectsRef.current);
        spotlight.target.position.set(spotTarget.x, spotTarget.y, spotTarget.z);
        // Recordar a qué entrada del config pertenece esta luz para poder
        // re-apuntarla cada frame hacia su objeto objetivo.
        spotlight.userData.spotlightIdx = idx;
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
      });
    } else {
      const preset = LIGHT_PRESETS[lightPreset] ?? LIGHT_PRESETS[0];
      scene.environmentIntensity = 1;
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

    // El fondo (cielo) sigue a las luces si el usuario lo activa.
    applySkyLighting();

    // Rebuild light helpers for whichever config is active
    buildLightHelpersRef.current?.(lightConfig ?? null);
  }, [lightPreset, lightConfig]);

   useEffect(() => {
     const gridGroup = gridGroupRef.current;
    // Ventanas 2D: la rejilla del suelo se ve de canto (una línea suelta);
    // en su lugar están los CUADROS (flatGridRef, geometría ⇒ escalan con
    // el zoom). La rejilla normal solo vive en la ventana '3d'.
    const camera = cameraRef.current;
    const flat = flat2DRef.current && camera !== null;
    if (gridGroup) gridGroup.visible = !flat && gridValue;
    const fg = flatGridRef.current;
    if (!flat || !fg) return;
    if (!camera) {
      fg.visible = false;
      return;
    }
    fg.visible = gridValue;
    const fb = flatBaseRef.current;
    if (!gridValue || !(camera instanceof THREE.OrthographicCamera)) {
      if (fb) fb.visible = false;
      return;
    }
    const dir = camera.getWorldDirection(new THREE.Vector3());
    // Orientación: plano ⟂ a la mirada. Superior/inferior → plano X-Z
    // (el natural del GridHelper); frente/espalda → plano X-Y (girado
    // 90° en X); costados → plano Z-Y (girado 90° en Z). La vista
    // vertical se comprueba PRIMERO: en cenital dir.x ≈ dir.z ≈ 0 y una
    // comparación entre ambos daría falso positivo (rejilla de canto).
    let eje: 'x' | 'y' | 'z';
    if (
      Math.abs(dir.y) >= Math.abs(dir.x) &&
      Math.abs(dir.y) >= Math.abs(dir.z)
    ) {
      fg.rotation.set(0, 0, 0);
      eje = 'y';
    } else if (Math.abs(dir.z) >= Math.abs(dir.x)) {
      fg.rotation.set(Math.PI / 2, 0, 0);
      eje = 'z';
    } else {
      fg.rotation.set(0, 0, Math.PI / 2);
      eje = 'x';
    }
    // SIN LÍMITE: la retícula cubre SIEMPRE la vista. Centro = target de
    // la órbita (sigue el pan) ajustado a la retícula (celda de 0.25,
    // la misma de la rejilla del suelo) — al ajustarlo a la retícula los
    // cuadros quedan pegados a las mismas posiciones del mundo aunque
    // la rejilla se desplace; solo se RECONSTRUYE cuando hay que crecer.
    const controls = controlsRef.current;
    const centroVista = controls
      ? controls.target.clone()
      : new THREE.Vector3();
    const CELLA = 0.25;
    const ajusta = (v: number) => Math.round(v / CELLA) * CELLA;
    // Coordenadas EN PLANO del centro de la vista, ajustadas a la
    // retícula: eje 'z' → plano X-Y, 'x' → plano Z-Y, 'y' → plano X-Z.
    const px =
      eje === 'z'
        ? ajusta(centroVista.x)
        : ajusta(centroVista.y);
    const py =
      eje === 'z'
        ? ajusta(centroVista.y)
        : ajusta(centroVista.z);
    // Radio visible (semidiagonal del frustum orto) + margen.
    const radio =
      Math.hypot((camera.right - camera.left) / 2, (camera.top - camera.bottom) / 2) + 0.6;
    // Detrás del modelo a lo largo de la vista (el centro de su caja
    // más media profundidad + margen): las líneas no tapan nunca.
    const box = new THREE.Box3();
    for (const v of mesh.vertices) {
      box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
    }
    if (!box.isEmpty()) {
      const meshGroup = meshGroupRef.current;
      if (meshGroup) {
        meshGroup.updateWorldMatrix(true, false);
        box.applyMatrix4(meshGroup.matrixWorld);
      }
    }
    const centroM = box.isEmpty()
      ? centroVista
      : box.getCenter(new THREE.Vector3());
    const mitad = box.isEmpty()
      ? new THREE.Vector3(radio, radio, radio)
      : box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const profundo =
      Math.abs(dir.x) * mitad.x +
      Math.abs(dir.y) * mitad.y +
      Math.abs(dir.z) * mitad.z;
    const pos = new THREE.Vector3();
    if (eje === 'z') {
      pos.set(px, py, centroM.z + dir.z * (profundo + 0.03));
    } else if (eje === 'x') {
      pos.set(centroM.x + dir.x * (profundo + 0.03), px, py);
    } else {
      pos.set(px, centroM.y + dir.y * (profundo + 0.03), py);
    }
    // Crecer SOLO si la vista ya no cabe: si cabe, basta mover la
    // rejilla (el desplazamiento en plano es múltiplo de la celda, así
    // que la retícula sigue pegada al mundo).
    const lado = (fg.userData as { lado?: number }).lado ?? 0;
    const necesita = radio * 2;
    if (lado < necesita) {
      const escena = sceneRef.current;
      if (!escena) return;
      const ladoNuevo = Math.ceil(necesita / 4) * 4; // múltiplo de 2 unidades, con aire
      const nuevo = new THREE.GridHelper(
        ladoNuevo,
        Math.round(ladoNuevo / CELLA),
        0x8fb0cc,
        0x44506a
      );
      (nuevo.material as THREE.LineBasicMaterial).opacity = 0.3;
      (nuevo.material as THREE.LineBasicMaterial).transparent = true;
      nuevo.raycast = () => {};
      nuevo.userData = { lado: ladoNuevo };
      nuevo.rotation.copy(fg.rotation);
      nuevo.position.copy(pos);
      escena.add(nuevo);
      fg.geometry.dispose();
      (fg.material as THREE.Material).dispose?.();
      escena.remove(fg);
      flatGridRef.current = nuevo;
    } else {
      fg.position.copy(pos);
    }
    // Línea de BASE: solo frente/espalda/costados (en superior/inferior
    // el suelo se ve como superficie, no como línea). Franja horizontal
    // al nivel de la rejilla (y = -1.05), siguiendo la vista (sin
    // límite) y a la misma profundidad que los cuadros.
    const Y_BASE = -1.05;
    if (fb) {
      fb.visible = eje !== 'y';
      if (fb.visible) {
        // Costados: la franja larga (eje X local) va a lo largo de Z.
        fb.rotation.set(0, eje === 'x' ? Math.PI / 2 : 0, 0);
        fb.scale.set(radio * 2 + 1, 1, 1);
        if (eje === 'z') {
          fb.position.set(centroVista.x, Y_BASE, pos.z);
        } else {
          fb.position.set(pos.x, Y_BASE, centroVista.z);
        }
      }
    }
   }, [gridValue, transform, mesh.vertices, camera3D]);

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
  // se ajusta al del objeto (esferas de radio de la malla). Con una
  // cámara-objeto activa no hay malla (su cuerpo es un grupo): se ve
  // igual, con un tamaño fijo razonable.
   useEffect(() => {
     const g = gizmoGroupRef.current;
     if (!g) return;
     const esCamara =
       (objectsRef.current ?? []).find(
         (o) => o.id === selectedObjectIdRef.current
       )?.kind === 'camera';
    // Fija la escala base del gizmo multiplicada por la escala del
    // offset (modo configuracion): asi el manipulador se puede escalar.
    const applyScale = (base: number) => {
      gizmoBaseScaleRef.current = base;
      const off = gizmoOffsetRef.current;
      g.scale.set(base * off.sx, base * off.sy, base * off.sz);
    };
    // Los objetos congelados no se pueden seleccionar ni manipular:
    // aunque queden seleccionados (v. el desplegable de la escena),
    // el manipulador no aparece para ellos.
    const congelado =
      (objectsRef.current ?? []).find(
        (o) => o.id === selectedObjectIdRef.current
      )?.frozen === true;
    // En modo de sub-selección el gizmo de objetos NO interviene (sus
    // gestos se los lleva la selección): se esconde y solo queda el gizmo
    // de la sub-selección.
    g.visible =
      showGizmo &&
      !(faceSelectMode ?? false) &&
      !congelado &&
      (mesh.vertices.length > 0 || esCamara);
     // Filtra las asas del manipulador según los modos activos: si el
     // usuario desactivó 'move', 'rotate' o 'scale', esas asas desaparecen.
      const activeModes = gizmoModes ?? ['move', 'rotate', 'scale'];
      // En ventanas 2D (orto) el eje que apunta a la cámara se retira:
      // solo queda el aro de rotación de ESE eje (gira en plano de
      // pantalla; única rotación que respeta la proyección) y se ocultan
      // las asas de mover/escalar de ese eje (un gesto en profundidad no
      // se ve en orto y su drag muere sin avisar).
      let flatAxis: GizmoAxis | undefined;
      if (flat2DRef.current && cameraRef.current) {
        const dir = cameraRef.current.getWorldDirection(new THREE.Vector3());
        flatAxis =
          Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z)
            ? 'x'
            : Math.abs(dir.y) >= Math.abs(dir.z)
              ? 'y'
              : 'z';
      }
      for (const h of gizmoHandlesRef.current) {
        const ud = h.userData as {
          mode: string;
          axis?: GizmoAxis;
          originalColor?: number;
        };
        // ud.mode también trae 'uniform-scale'/'planar-scale' (los modos
        // internos de GizmoDrag), así que se compara como string y el
        // cast a GizmoMode solo entra al mirar activeModes.
        const m = ud.mode;
        const porModo =
          m === 'uniform-scale' || m === 'planar-scale'
            ? activeModes.includes('scale')
            : activeModes.includes(m as GizmoMode);
        const enabled =
          (flatAxis === undefined
            ? porModo
            : m === 'rotate'
              ? porModo && ud.axis === flatAxis
              : m === 'planar-scale'
                ? porModo && ud.axis === flatAxis // plano de pantalla: solo top/bottom
                : m === 'uniform-scale'
                  ? porModo // cubo blanco: escala los 3 ejes, seguro en 2D
                  : porModo && ud.axis !== flatAxis) &&
          // Checkbox «Círculos»: apaga TODOS los aros de rotación (los
          // que sobrevivan al filtro del eje de cámara) en una sola
          // casilla, para el gizmo normal.
          (m === 'rotate' ? showRotate : true);
        h.visible = enabled;
        const mat = h.material as THREE.MeshBasicMaterial;
        if (!mat.color) continue;
        if (gizmoColorOverride !== undefined) {
          mat.color.setHex(gizmoColorOverride);
        } else if (ud.originalColor !== undefined) {
          mat.color.setHex(ud.originalColor);
        }
      }
     if (mesh.vertices.length === 0) {
      if (esCamara) applyScale(1);
      return;
    }
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
    applyScale(Math.min(Math.max(r * 0.9 * objectScale, 0.35), 8));
   }, [showGizmo, showRotate, mesh.vertices, transform, gizmoModes, gizmoColorOverride, gizmoOffset, flat2D, objects, faceSelectMode]);

  // Color de las asas del gizmo de la SUB-selección: gris en su modo
  // configuración (como el gizmo de objetos) y colores por eje el resto.
  // Las asas «hit» (userData sin originalColor) son invisibles: fuera.
  useEffect(() => {
    for (const h of selectionGizmoHandlesRef.current) {
      const ud = h.userData as { originalColor?: number };
      const mat = h.material as THREE.MeshBasicMaterial;
      if (!mat || !mat.color || ud.originalColor === undefined) continue;
      mat.color.setHex(
        selGizmoColorOverride !== undefined ? selGizmoColorOverride : ud.originalColor
      );
    }
  }, [selGizmoColorOverride, faceSelectMode]);

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
    // El gizmo de la sub-selección y el resaltado por hover también son
    // ayudas de edición: fuera de la imagen.
    const selectionGizmoGroup = selectionGizmoGroupRef.current;
    const hoverOverlayCap = faceHoverOverlayRef.current;
    const prevSelectionGizmoVisible = selectionGizmoGroup?.visible ?? false;
    const prevHoverOverlayVisible = hoverOverlayCap?.visible ?? false;
    if (selectionGizmoGroup) selectionGizmoGroup.visible = false;
    if (hoverOverlayCap) hoverOverlayCap.visible = false;
    // Los focos (cono, aros y bola de dirección) y su gizmo también son
    // ayudas de edición: fuera de la imagen capturada.
    const lightHelpersGroup = lightHelpersGroupRef.current;
    const lightGizmoGroup = lightGizmoGroupRef.current;
    const prevLightHelpersVisible = lightHelpersGroup?.visible ?? false;
    const prevLightGizmoVisible = lightGizmoGroup?.visible ?? false;
    if (lightHelpersGroup) lightHelpersGroup.visible = false;
    if (lightGizmoGroup) lightGizmoGroup.visible = false;
    // Resto de ayudas de edición que tampoco deben salir en la imagen: el
    // recorrido de la cámara (su asa amarilla y su bola de foco), el del
    // objeto, el resaltado de caras, los marcadores de FX y la ayuda de
    // proyección de textura.
    const cameraObjectPath = cameraObjectPathRef.current;
    const objectMotionPath = objectMotionPathRef.current;
    const faceSelectionOverlay = faceSelectionOverlayRef.current;
    const faceGuide = faceGuideRef.current;
    const textureHelperGroup = textureHelperGroupRef.current;
    const textureHelperGizmoGroup = textureHelperGizmoGroupRef.current;
    const latheAxis = latheAxisRef.current;
    const prevCameraObjectPathVisible = cameraObjectPath?.group.visible ?? false;
    const prevObjectMotionPathVisible = objectMotionPath?.group.visible ?? false;
    const prevFaceSelectionOverlayVisible = faceSelectionOverlay?.visible ?? false;
    const prevFaceGuideVisible = faceGuide?.visible ?? false;
    // Marcadores de focos de FX: ayudas de edición, fuera de la imagen.
    const anchorsFx = [...fxObjetosRef.current.values()].map((rt) => rt.anchorGroup);
    const prevAnchorsFxVisible = anchorsFx.map((g) => g.visible);
    const prevTextureHelperVisible = textureHelperGroup?.visible ?? false;
    const prevTextureHelperGizmoVisible = textureHelperGizmoGroup?.visible ?? false;
    const prevLatheAxisVisible = latheAxis?.visible ?? false;
    if (cameraObjectPath) cameraObjectPath.group.visible = false;
    if (objectMotionPath) objectMotionPath.group.visible = false;
    if (faceSelectionOverlay) faceSelectionOverlay.visible = false;
    if (faceGuide) faceGuide.visible = false;
    for (const g of anchorsFx) g.visible = false;
    if (textureHelperGroup) textureHelperGroup.visible = false;
    if (textureHelperGizmoGroup) textureHelperGizmoGroup.visible = false;
    if (latheAxis) latheAxis.visible = false;

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
    // geometría suavizada temporal para que el brillo siga el contorno.
    // Usa el material del runtime del objeto activo (si tiene brillo).
    const activoRt = selectedObjectIdRef.current
      ? fxObjetosRef.current.get(selectedObjectIdRef.current)
      : undefined;
    let tempGlow: THREE.Object3D[] = [];
    if (
      doSmooth &&
      activoRt?.glowMaterial &&
      tempObjects[0] instanceof THREE.Mesh
    ) {
      const shell = new THREE.Mesh(
        (tempObjects[0] as THREE.Mesh).geometry,
        activoRt.glowMaterial
      );
      shell.scale.setScalar(1.1);
      tempGlow = [shell];
      (tempObjects[0] as THREE.Mesh).add(shell);
    }

    // El scene.background pinta un color opaco sobre el canvas y anula
    // la transparencia del PNG; se quita solo durante la captura.
    const prevBackground = scene.background;
    scene.background = null;

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');

    scene.background = prevBackground;

    // El shell temporal comparte el material del runtime: se quita ANTES
    // de disponer los temporales para no disponerlo por error.
    if (tempGlow.length > 0 && tempObjects[0]) {
      tempObjects[0].remove(tempGlow[0]);
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
    if (lightHelpersGroup) lightHelpersGroup.visible = prevLightHelpersVisible;
    if (lightGizmoGroup) lightGizmoGroup.visible = prevLightGizmoVisible;
    if (cameraObjectPath) cameraObjectPath.group.visible = prevCameraObjectPathVisible;
    if (objectMotionPath) objectMotionPath.group.visible = prevObjectMotionPathVisible;
    if (faceSelectionOverlay) faceSelectionOverlay.visible = prevFaceSelectionOverlayVisible;
    if (faceGuide) faceGuide.visible = prevFaceGuideVisible;
    anchorsFx.forEach((g, i) => {
      g.visible = prevAnchorsFxVisible[i];
    });
    if (textureHelperGroup) textureHelperGroup.visible = prevTextureHelperVisible;
    if (textureHelperGizmoGroup)
      textureHelperGizmoGroup.visible = prevTextureHelperGizmoVisible;
    if (latheAxis) latheAxis.visible = prevLatheAxisVisible;

    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'texto-3d.png';
    link.click();
   }, [smoothCapture, wireframe]);

  const resetCamera = useCallback(() => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;

    const camConfig = camera3D;
    const baseDistance = 5.5;

    if (camConfig) {
      const isFrontView =
        Math.abs(camConfig.rotationY) < 0.01 && Math.abs(camConfig.rotationX) < 0.01;
      const isTopView =
        Math.abs(camConfig.rotationY) < 0.01 &&
        Math.abs(camConfig.rotationX - Math.PI / 2) < 0.01;
      const isSideView =
        Math.abs(camConfig.rotationY - Math.PI / 2) < 0.01 &&
        Math.abs(camConfig.rotationX) < 0.01;
      const isSideLeftView =
        Math.abs(camConfig.rotationY + Math.PI / 2) < 0.01 &&
        Math.abs(camConfig.rotationX) < 0.01;
      const isBackView =
        Math.abs(Math.abs(camConfig.rotationY) - Math.PI) < 0.01 &&
        Math.abs(camConfig.rotationX) < 0.01;
      const isBottomView =
        Math.abs(camConfig.rotationY) < 0.01 &&
        Math.abs(camConfig.rotationX + Math.PI / 2) < 0.01;

      if (isFrontView) {
        cam.position.set(camConfig.offsetX, camConfig.offsetY, baseDistance);
        ctrl.target.set(camConfig.offsetX, camConfig.offsetY, 0);
      } else if (isTopView) {
        cam.position.set(camConfig.offsetX, baseDistance, camConfig.offsetY);
        ctrl.target.set(camConfig.offsetX, 0, camConfig.offsetY);
      } else if (isSideView) {
        cam.position.set(baseDistance, camConfig.offsetY, camConfig.offsetX);
        ctrl.target.set(0, camConfig.offsetY, camConfig.offsetX);
      } else if (isSideLeftView) {
        cam.position.set(-baseDistance, camConfig.offsetY, camConfig.offsetX);
        ctrl.target.set(0, camConfig.offsetY, camConfig.offsetX);
      } else if (isBackView) {
        cam.position.set(camConfig.offsetX, camConfig.offsetY, -baseDistance);
        ctrl.target.set(camConfig.offsetX, camConfig.offsetY, 0);
      } else if (isBottomView) {
        cam.position.set(camConfig.offsetX, -baseDistance, camConfig.offsetY);
        ctrl.target.set(camConfig.offsetX, 0, camConfig.offsetY);
      } else {
        cam.position.set(3, 2.5, 4);
        ctrl.target.set(0, 0, 0);
      }
    } else {
      cam.position.set(3, 2.5, 4);
      ctrl.target.set(0, 0, 0);
    }

    ctrl.update();

    const onCamChange = onCameraChangeRef.current;
    if (onCamChange) {
      onCamChange(poseACamera3D(cam.position, ctrl.target, baseDistance));
    }
  }, [camera3D]);

  /**
   * Centrar de nuevo la escena: el pivote de órbita vuelve al origen (el
   * centro de la rejilla) y la cámara se coloca a la distancia por defecto
   * por la misma dirección en la que miraba. Lo contrario de lo que pasa
   * al encuadrar objetos muy grandes: si el pivote queda lejos, cualquier
   * giro se convierte en una órbita enorme y la rejilla se pierde de vista.
   */
  const centrarEscena = useCallback(() => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const baseDistance = 5.5;
    // Dirección actual de mirada (del pivote viejo hacia la cámara),
    // conservada: solo se cambia dónde está el pivote y a qué distancia.
    const dir = cam.position.clone().sub(ctrl.target).normalize();
    if (!Number.isFinite(dir.x + dir.y + dir.z) || dir.lengthSq() < 1e-9) {
      dir.set(0.6, 0.45, 0.73).normalize();
    }
    ctrl.target.set(0, 0, 0);
    cam.position.set(dir.x * baseDistance, dir.y * baseDistance, dir.z * baseDistance);
    ctrl.update();

    const onCamChange = onCameraChangeRef.current;
    if (onCamChange) {
      onCamChange(poseACamera3D(cam.position, ctrl.target, baseDistance));
    }
  }, []);

  // ── Encuadrar (Frente/Superior/Costado/3D) ───────────────────────────────
  // El padre incrementa `frameToken` con el botón del menú de la ventana.
  // Calcula la caja envolvente de lo que se ve (la figura y los objetos de la
  // escena) y recoloca la cámara de esta ventana para que todo entre completo,
  // conservando su orientación actual.
  const frameTokenRef = useRef<number>(frameToken ?? 0);
  useEffect(() => {
    const token = frameToken ?? 0;
    if (token === 0 || token === frameTokenRef.current) return;
    frameTokenRef.current = token;

    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;

    const mg = meshGroupRef.current;
    const box = new THREE.Box3();
    if (mg) {
      mg.updateWorldMatrix(true, true);
      const main = findMainMesh(mg);
      if (main) box.expandByObject(main);
      for (const child of mg.children) {
        if (child.userData && child.userData.sceneObjectDuplicate) {
          box.expandByObject(child);
        }
      }
    }
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2));
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const rotX = camera3D?.rotationX ?? 0;
    const rotY = camera3D?.rotationY ?? 0;
    const isTop = Math.abs(rotY) < 0.01 && Math.abs(rotX - Math.PI / 2) < 0.01;
    const isBottom =
      Math.abs(rotY) < 0.01 && Math.abs(rotX + Math.PI / 2) < 0.01;
    const isSide =
      (Math.abs(rotY - Math.PI / 2) < 0.01 ||
        Math.abs(rotY + Math.PI / 2) < 0.01) &&
      Math.abs(rotX) < 0.01;

    // Cámara ORTO (modo 2D): el zoom ES el frustum. La altura necesaria
    // cubre las extensiones visibles de ESTA vista (frente: X·Y, superior:
    // X·Z, costado: Z·Y) más un margen; el ancho depende del aspecto.
    if (cam instanceof THREE.OrthographicCamera) {
      let extU: number, extV: number;
      if (isTop || isBottom) {
        extU = size.x;
        extV = size.z;
      } else if (isSide) {
        extU = size.z;
        extV = size.y;
      } else {
        extU = size.x;
        extV = size.y;
      }
      const dom = ctrl.domElement as HTMLElement | null;
      const aspecto =
        dom && dom.clientHeight > 0 ? dom.clientWidth / dom.clientHeight : 1;
      const hNecesaria = (Math.max(extV, extU / aspecto) / 2) * 1.2;
      const zoomOrto = Math.max(
        0.1,
        Math.min(5, ALTURA_BASE_PLANO / Math.max(hNecesaria, 0.0001))
      );
      let offsetX = center.x;
      let offsetY = center.y;
      if (isTop || isBottom) {
        offsetX = center.x;
        offsetY = center.z;
      } else if (isSide) {
        offsetX = center.z;
        offsetY = center.y;
      }
      const onCamChange = onCameraChangeRef.current;
      if (onCamChange) {
        onCamChange({ zoom: zoomOrto, offsetX, offsetY, rotationX: rotX, rotationY: rotY });
      }
      return;
    }

    const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
    const fov = (cam.fov * Math.PI) / 180;
    const fitDist = (radius / Math.max(Math.sin(fov / 2), 0.05)) * 1.2;
    const baseDistance = 5.5;
    const zoom = Math.max(0.1, Math.min(5, baseDistance / Math.max(fitDist, 0.0001)));

    let offsetX = center.x;
    let offsetY = center.y;
    if (isTop || isBottom) {
      offsetX = center.x;
      offsetY = center.z;
    } else if (isSide) {
      offsetX = center.z;
      offsetY = center.y;
    }

    const onCamChange = onCameraChangeRef.current;
    if (onCamChange) {
      onCamChange({ zoom, offsetX, offsetY, rotationX: rotX, rotationY: rotY });
    }
  }, [frameToken, camera3D]);

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
          {objectName !== undefined && (
            <input
              type="text"
              value={objectName}
              onChange={(e) => onObjectNameChange?.(e.target.value)}
              placeholder="Nombre del objeto"
              className="w-32 px-1.5 py-0.5 text-[10px] rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              title="Nombre del objeto"
            />
          )}
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
          <label
            className="flex items-center gap-1 px-1 cursor-pointer select-none"
            title="Círculos de rotación del gizmo: desmárcalo para ocultar SOLO los aros (quedan las flechas de mover y los puntos de escala). Vale para el gizmo del objeto y para el de la ayuda de textura"
          >
            <input
              type="checkbox"
              checked={showRotate}
              onChange={(e) => setShowRotate(e.target.checked)}
              className="w-3 h-3 accent-green-500 cursor-pointer"
            />
            <span className="text-[10px] font-medium text-muted-foreground">
              Círculos
            </span>
          </label>
          <ToggleButton
            active={wireframe}
            onClick={() => setWireframe(!wireframe)}
            title="Vista de alambre (segmentos)"
          >
            <Spline className="w-3.5 h-3.5" />
</ToggleButton>
          <ToggleButton
             active={gridValue}
             onClick={toggleGrid}
            title="Rejilla"
          >
            <Grid3x3 className="w-3.5 h-3.5" />
          </ToggleButton>
          {/* Tamaño de la base de trabajo: solo en 3D libre; en las
              ventanas 2D la rejilla es del lienzo (CSS) y este control
              no se usa. */}
          {!flat2D && (
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
          )}
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
          <ToggleButton onClick={centrarEscena} title="Centrar escena: vuelve a poner el eje central de la rejilla como pivote de la órbita (útil si los giros de cámara se han vuelto enormes tras trabajar con objetos muy grandes)">
            <Crosshair className="w-3.5 h-3.5" />
          </ToggleButton>
            {objects && objects.length > 0 && (
              <ToggleButton
                active={selectionMode}
                onClick={() => onSelectionModeChangeRef.current?.(!selectionMode)}
                title="Seleccionar múltiples objetos (arrastra en la ventana)"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
              </ToggleButton>
            )}
            {mesh && mesh.vertices.length > 0 && (
              <>
                <ToggleButton
                  active={faceSelectMode}
                  onClick={() => onFaceSelectionModeChangeRef.current?.(!faceSelectMode)}
                  title="Seleccionar caras, vértices o segmentos de la figura activa"
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                </ToggleButton>
                {faceSelectMode && (
                  <>
                    <select
                      value={faceSelectionTarget ?? 'cara'}
                      onChange={(e) => onFaceSelectionTargetChangeRef.current?.(e.target.value as any)}
                      title="Qué seleccionar: caras, vértices o segmentos"
                      className="px-1.5 py-0.5 text-xs bg-white/10 rounded border border-white/20 text-white"
                    >
                      <option value="cara">Cara</option>
                      <option value="vertice">Vértice</option>
                      <option value="segmento">Segmento</option>
                    </select>
                    <select
                      value={faceSelectionTool}
                      onChange={(e) => onFaceSelectionToolChangeRef.current?.(e.target.value as any)}
                      title="Rectángulo, círculo y polígono solo tocan lo COMPLETAMENTE dentro. Polígono: clic por cada vértice, ciérralo con un clic cerca del primer punto (clic derecho cancela). Directo: el clic elige el elemento bajo el cursor (lo fijan los botones Polígono/Aristas/Puntos)"
                      className="px-1.5 py-0.5 text-xs bg-white/10 rounded border border-white/20 text-white"
                    >
                      <option value="rectangle">Rectángulo</option>
                      <option value="circle">Círculo</option>
                      <option value="line">Línea</option>
                      <option value="poligono">Polígono</option>
                      <option value="directo">Directo (clic)</option>
                    </select>
                  </>
                )}
              </>
            )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Efectos visuales"
                className="p-1.5 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-white/5 flex items-center gap-1"
              >
                <Menu className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">FX</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[200px]">
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('glow')}
                onCheckedChange={() => toggleEfectoObjetos('glow')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-300" />
                  <span className="text-xs">Brillo neón</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('sparks')}
                onCheckedChange={() => toggleEfectoObjetos('sparks')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Sparkle className="w-4 h-4 text-cyan-300" />
                  <span className="text-xs">Chispas</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('fire')}
                onCheckedChange={() => toggleEfectoObjetos('fire')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-300" />
                  <span className="text-xs">Llamas</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('rain')}
                onCheckedChange={() => toggleEfectoObjetos('rain')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CloudRain className="w-4 h-4 text-blue-300" />
                  <span className="text-xs">Lluvia</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('smoke')}
                onCheckedChange={() => toggleEfectoObjetos('smoke')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-gray-400" />
                  <span className="text-xs">Humo</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={estadoEfectoSel('stars')}
                onCheckedChange={() => toggleEfectoObjetos('stars')}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-300" />
                  <span className="text-xs">Estrellas</span>
                </div>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={placeTarget !== null}
                onCheckedChange={() =>
                  setPlaceTarget((prev) => (prev ? null : 'fire'))
                }
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Pin className="w-4 h-4 text-purple-300" />
                  <span className="text-xs">Colocar efecto (clic en el objeto)</span>
                </div>
              </DropdownMenuCheckboxItem>
              {placeTarget !== null && (
                <div className="px-2 py-1.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    {PLACE_TARGETS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPlaceTarget(opt.value)}
                        className={
                          'flex-1 rounded border px-1 py-0.5 text-[10px] transition-colors ' +
                          (placeTarget === opt.value
                            ? 'border-purple-400 bg-purple-500/20 text-white'
                            : 'border-gray-700 text-gray-400 hover:bg-gray-800')
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] leading-tight text-gray-500">
                    Clic en un objeto para añadir un foco de {PLACE_TARGET_LABEL[placeTarget]}.
                    Clic sobre un foco existente para quitarlo.
                  </span>
                  <button
                    type="button"
                    onClick={() => limpiarPuntosObjetos(idsFx())}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-800"
                  >
                    Borrar todos los puntos
                  </button>
                </div>
              )}
              {(estadoEfectoSel('stars') !== false || placeTarget === 'stars') && (
                <div className="px-2 py-1.5 flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-300" />
                  <Slider
                    min={0.3}
                    max={3}
                    step={0.1}
                    value={[starSize]}
                    onValueChange={([v]) => {
                      setStarSize(v);
                      editarValoresEfectoSel('stars', { starSize: v });
                    }}
                    className="flex-1 h-4"
                  />
                </div>
              )}
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem
                onSelect={() => setShowFxConfigModal(true)}
                className="hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-300" />
                  <span className="text-xs">Configuración de FX</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      {showFxConfigModal && (
        <FxConfigEditor
          isOpen={showFxConfigModal}
          onClose={() => setShowFxConfigModal(false)}
          seleccion={efectosDe(idsFx())}
          onValores={editarValoresEfectoSel}
        />
      )}
      <div
        ref={mountRef}
        data-testid="viewer-container"
        className="relative flex-1 min-h-0"
        style={{
          // Ventanas 2D: mismo gradiente azul oscuro que el lienzo; los
          // CUADROS los dibuja la escena (GridHelper en el plano de la
          // vista), así escalan con el zoom y el botón Rejilla los rige.
          background:
            'radial-gradient(ellipse at 50% 40%, hsl(224 45% 16%) 0%, hsl(224 50% 7%) 80%)',
        }}
      >
        {grabacionActiva && (
          <div
            className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[10px] font-semibold text-red-300 pointer-events-none"
            data-testid="rec-indicator"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            REC
            {activeCamera?.keyframes.length
              ? activeCamera.keyframes.length
              : null}
          </div>
        )}
      </div>
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
  /** Solo fuego: fracción de vida por partícula (afina el tamaño en shader). */
  vidaA?: Float32Array;
  /** Solo fuego: uniforme del estilo (0 partículas ↔ 1 llama real). */
  uniformesEstilo?: { uEstilo: { value: number } };
  /** Solo fuego: centro de la malla (convergencia de la pluma). */
  origen?: THREE.Vector3;
};

type RainSystem = {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  box: { min: THREE.Vector3; max: THREE.Vector3 };
  speed: number;
};

type SmokeSystem = {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  velocities: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  origin: THREE.Vector3;
  color: THREE.Color;
  riseSpeed: number;
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
  /** Tamaño relativo serializado de esta estrella (1 = por defecto). */
  tamaño: number;
};

type PlacedStarSystem = {
  group: THREE.Group;
  stars: PlacedStar[];
};

function addPlacedStar(
  sys: PlacedStarSystem,
  pos: THREE.Vector3,
  tamaño: number
): void {
    const material = new THREE.SpriteMaterial({
      map: getStarTexture(),
      transparent: true,
      // Opacidad visible: las colocadas no tienen fade propio (solo latido
      // de escala en el bucle); con 0 quedaban invisibles.
      opacity: 0.95,
    // Oclusión como el resto de FX. polygonOffset evita que se corte
    // contra la propia superficie donde está colocada la estrella.
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
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
  sprite.scale.setScalar(rawScale * tamaño);
  sys.group.add(sprite);
  sys.stars.push({
    sprite,
    phase: Math.random() * Math.PI * 2,
    rawScale,
    tamaño,
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

function createParticleSystem(
  count: number,
  size: number,
  opciones?: { depthTest?: boolean }
): ParticleSystem {
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
    // Por defecto van siempre por delante del texto; se puede pedir
    // oclusión (depthTest) para que un objeto delante tape al efecto.
    depthTest: opciones?.depthTest ?? false,
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

/**
 * Sistema de fuego: como createParticleSystem pero con el parche de
 * material que morfa la partícula con el estilo (0 = punto suelto de
 * tamaño fijo, 1 = pluma de llama que se afina con la edad). Cada
 * sistema lleva su propio uniforme para que cada objeto tenga su valor.
 */
function crearSistemaFuego(count: number, size: number): ParticleSystem {
  // El fuego respeta la oclusión: un objeto delante lo tape (depthTest).
  const sys = createParticleSystem(count, size, { depthTest: true });
  const vidaA = new Float32Array(count);
  sys.points.geometry.setAttribute('aVida', new THREE.BufferAttribute(vidaA, 1));
  const uniformesEstilo = { uEstilo: { value: 0 } };
  const mat = sys.points.material as THREE.PointsMaterial;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEstilo = uniformesEstilo.uEstilo;
    // El attribute/uniform entran por <common>; el tamaño del punto pasa a
    // depender de la vida: al nacer grande, afina conforme sube (punta).
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aVida;\nuniform float uEstilo;'
      )
      .replace(
        'gl_PointSize = size;',
        'gl_PointSize = size * mix(1.0, 0.4 + 0.8 * aVida, uEstilo);'
      );
  };
  return {
    ...sys,
    vidaA,
    uniformesEstilo,
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

/**
 * Sistema de partículas de lluvia.
 * Partículas que caen desde un punto elevado sobre el texto con trazo azul
 * tenue y brillo sutil, simulando gotas de lluvia.
 */
function createRainSystem(
  box: { min: THREE.Vector3; max: THREE.Vector3 },
  count: number,
  speed: number
): RainSystem {
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const material = new THREE.PointsMaterial({
    size: 0.032,
    map: getSoftDotTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 999;
  const velocities = new Float32Array(count * 3);
  const spread = box.max.clone().sub(box.min);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = box.min.x + Math.random() * spread.x;
    const y = box.max.y + Math.random() * 0.6;
    const z = box.min.z + Math.random() * spread.z;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    velocities[o] = (Math.random() - 0.5) * 0.02;
    velocities[o + 1] = -(speed * 0.4 + Math.random() * speed * 0.3);
    velocities[o + 2] = (Math.random() - 0.5) * 0.02;
  }
  geometry.attributes.position.needsUpdate = true;
  (geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  return { points, positions, velocities, box, speed };
}

/** Actualiza las gotas de lluvia: caen y se regeneran al pasar del bounds. */
function updateRain(sys: RainSystem, dt: number): void {
  const count = sys.velocities.length / 3;
  const min = sys.box.min;
  const max = sys.box.max;
  const fallSpeed = sys.speed * 0.4;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    sys.positions[o] += sys.velocities[o] * dt;
    sys.positions[o + 1] += sys.velocities[o + 1] * dt;
    sys.positions[o + 2] += sys.velocities[o + 2] * dt;
    if (sys.positions[o + 1] < min.y - 0.3) {
      const spread = max.clone().sub(min);
      sys.positions[o] = min.x + Math.random() * spread.x;
      sys.positions[o + 1] = max.y + Math.random() * 0.6;
      sys.positions[o + 2] = min.z + Math.random() * spread.z;
      sys.velocities[o + 1] = -(fallSpeed + Math.random() * 0.3);
    }
    const t = Math.min(1, -sys.positions[o + 1] / (max.y - min.y + 1));
    const c = 0.5 + t * 0.5;
    sys.points.geometry.attributes.color.setXYZ(i, c * 0.45, c * 0.55, c);
  }
  sys.points.geometry.attributes.position.needsUpdate = true;
  (sys.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

/**
 * Sistema de partículas de humo.
 * Partículas que nacen en una fuente (base del texto) y ascienden con
 * dispersión lateral, atenuándose con la edad para simular nube de humo.
 */
function createSmokeSystem(origin: THREE.Vector3, count: number, size: number, color: string, riseSpeed: number, intensity: number): SmokeSystem {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: getSoftDotTexture(),
    transparent: true,
    // El humo respeta la oclusión: un objeto delante lo tapa (depthTest).
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 999;
  const velocities = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const maxLife = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    life[i] = 0;
  }
  return { points, positions, colors, velocities, life, maxLife, origin, color: new THREE.Color(color), riseSpeed };
}

/** Actualiza las partículas de humo: ascienden, se dispersan y se desvanecen. */
function updateSmoke(
  sys: SmokeSystem,
  dt: number,
  randomPoint?: () => THREE.Vector3 | null
): void {
  const count = sys.life.length;
  const baseT = 0.42 * sys.riseSpeed * 0.5;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (sys.life[i] <= 0) {
      const r = (Math.random() * Math.PI) * 2;
      const rad = Math.random() * 0.12;
      const origin = randomPoint ? randomPoint() ?? sys.origin : sys.origin;
      sys.positions[o] = origin.x + Math.cos(r) * rad;
      sys.positions[o + 1] = origin.y;
      sys.positions[o + 2] = origin.z + Math.sin(r) * rad;
      sys.velocities[o] = (Math.random() - 0.5) * 0.04;
      sys.velocities[o + 1] = 0.12 * sys.riseSpeed + Math.random() * 0.18 * sys.riseSpeed;
      sys.velocities[o + 2] = (Math.random() - 0.5) * 0.04;
      sys.maxLife[i] = 1.2 + Math.random() * 1.2;
      sys.life[i] = sys.maxLife[i];
    } else {
      sys.life[i] -= dt;
      sys.positions[o] += sys.velocities[o] * dt;
      sys.positions[o + 1] += sys.velocities[o + 1] * dt;
      sys.positions[o + 2] += sys.velocities[o + 2] * dt;
      sys.velocities[o] += (Math.random() - 0.5) * 0.03 * dt;
      // expansión lateral creciente con la altura
      const expansion = 0.01 * dt * sys.riseSpeed;
      sys.velocities[o] += (Math.random() - 0.5) * expansion;
      sys.velocities[o + 2] += (Math.random() - 0.5) * expansion;
    }
    const t = Math.max(sys.life[i], 0) / (sys.maxLife[i] || 1);
    const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 0.9;
    const c = sys.color;
    sys.colors[o] = c.r * fade;
    sys.colors[o + 1] = c.g * fade;
    sys.colors[o + 2] = c.b * fade;
  }
  sys.points.geometry.attributes.position.needsUpdate = true;
  (sys.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
}

/** Fuego: llamas que nacen en el texto y suben temblando. Color amarillo→naranja→rojo.
 *  `estilo` (0..1, fireEstilo del objeto) morfe la llama: 0 = partículas sueltas
 *  que deambulan con bruma larga; 1 = pluma coherente que converge, sube rápido,
 *  vive poco y se afina (punta) con color más caliente. Con `converge` (sin
 *  focos) el centro de la pluma es el promedio vivo de los puntos de nacimiento
 *  (EMA): no dependemos de la caja de la malla, cuyas coords no siempre son
 *  las del grupo de partículas. */
function updateFire(
  sys: ParticleSystem,
  dt: number,
  randomPoint: () => THREE.Vector3 | null,
  estilo = 0,
  converge = false
): void {
  const count = sys.life.length;
  const s = Math.min(Math.max(estilo, 0), 1);
  const cohesion = 1 - 0.85 * s; // menos dispersión lateral al subir el estilo
  const vidaA = sys.vidaA;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (sys.life[i] <= 0) {
      const p = randomPoint();
      if (!p) continue;
      // Nace justo en la superficie (sin hundirse dentro: con la oclusión
      // activa una llama nacida dentro del objeto se vería oculta al nacer).
      sys.positions[o] = p.x;
      sys.positions[o + 1] = p.y;
      sys.positions[o + 2] = p.z;
      if (converge && s > 0) {
        if (!sys.origen) {
          sys.origen = new THREE.Vector3(p.x, p.y, p.z);
        } else {
          // EMA del centro de nacimiento (señal estable, sin salto por
          // muestras raras): corrige el centro en ~20 nacimientos.
          sys.origen.x += (p.x - sys.origen.x) * 0.05;
          sys.origen.z += (p.z - sys.origen.z) * 0.05;
        }
        // El nacimiento se concentra hacia el eje de la pluma.
        sys.positions[o] += (sys.origen.x - sys.positions[o]) * s * 0.55;
        sys.positions[o + 2] += (sys.origen.z - sys.positions[o + 2]) * s * 0.55;
      }
      sys.velocities[o] = (Math.random() - 0.5) * 0.12 * cohesion;
      sys.velocities[o + 1] = 0.5 + Math.random() * 0.6 + s * (0.45 + Math.random() * 0.35);
      sys.velocities[o + 2] = (Math.random() - 0.5) * 0.12 * cohesion;
      sys.maxLife[i] = Math.max(0.3, 0.7 + Math.random() * 1.1 - s * (0.2 + Math.random() * 0.55));
      sys.life[i] = sys.maxLife[i];
      if (vidaA) vidaA[i] = 1;
    } else {
      sys.life[i] -= dt;
      sys.positions[o] += sys.velocities[o] * dt;
      sys.positions[o + 1] += sys.velocities[o + 1] * dt;
      sys.positions[o + 2] += sys.velocities[o + 2] * dt;
      sys.velocities[o] += (Math.random() - 0.5) * 0.5 * dt * cohesion;
      if (converge && s > 0 && sys.origen) {
        // La pluma se cierra hacia su eje mientras sube.
        sys.velocities[o] += (sys.origen.x - sys.positions[o]) * 1.6 * s * dt;
        sys.velocities[o + 2] += (sys.origen.z - sys.positions[o + 2]) * 1.6 * s * dt;
      }
    }
    const t = Math.max(sys.life[i], 0) / (sys.maxLife[i] || 1);
    // Amarillo al nacer → naranja → rojo apagado; con la pluma el núcleo
    // nace más caliente (más blanco-amarillo) y las puntas van a rojo.
    sys.colors[o] = t + s * 0.12 * t;
    sys.colors[o + 1] = t * t * (0.55 + s * 0.3);
    sys.colors[o + 2] = t * t * t * (0.06 + s * 0.24);
    if (vidaA) vidaA[i] = t;
  }
  (sys.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (sys.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  if (vidaA) {
    const attr = sys.points.geometry.attributes.aVida as THREE.BufferAttribute | undefined;
    if (attr) attr.needsUpdate = true;
  }
}

function createStarSystem(): StarSystem {
  const group = new THREE.Group();
  const stars: StarGlint[] = [];
  // Más estrellas para un cielo de fondo más denso y dinámico
  const count = 24;
  for (let i = 0; i < count; i++) {
    const material = new THREE.SpriteMaterial({
      map: getStarTexture(),
      transparent: true,
      depthWrite: false,
      // Las estrellas también las tapa un objeto delante (depthTest).
      // polygonOffset las alza una pizca en profundidad para que, al nacer
      // pegadas a la superficie del objeto, no se corten contra ella propia.
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      blending: THREE.AdditiveBlending,
      opacity: 0,
      rotation: Math.random() * Math.PI,
    });
    // Mayoría blancas; algunas con matiz frío o cálido
    const hue = Math.random();
    if (hue < 0.66) material.color.setHex(0xffffff);
    else if (hue < 0.83) material.color.setHex(0x9fe8ff);
    else material.color.setHex(0xffe3b0);
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    sprite.scale.setScalar(0);
    group.add(sprite);
    stars.push({
      sprite,
      state: 'wait',
      timer: Math.random() * 1.8,
      duration: 1,
      baseScale: 0.2,
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
          star.timer = 0.4;
          continue;
        }
        star.sprite.position.copy(p);
        star.duration = 0.5 + Math.random() * 0.9;
        star.timer = star.duration;
        star.baseScale = (0.14 + Math.random() * 0.28) * starSize;
        star.sprite.material.rotation = Math.random() * Math.PI;
        star.state = 'live';
      }
    } else {
      const t = 1 - star.timer / star.duration;
      // Pulso suave en crecimiento y desvanecimiento
      const s = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
      star.sprite.scale.setScalar(star.baseScale * s);
      // Fade de material: brillo al medio, transparente al inicio/final
      const m = star.sprite.material as THREE.SpriteMaterial;
      const fade = 0.5 + 0.5 * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
      m.opacity = fade;
      if (star.timer <= 0) {
        star.sprite.scale.setScalar(0);
        star.state = 'wait';
        star.timer = 0.2 + Math.random() * 1.5;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Focos de efecto seleccionables con el ratón (fuego/humo/chispas).   */
/* ------------------------------------------------------------------ */

const PLACE_TARGETS: {
  value: 'fire' | 'smoke' | 'sparks' | 'stars';
  label: string;
}[] = [
  { value: 'fire', label: 'Fuego' },
  { value: 'smoke', label: 'Humo' },
  { value: 'sparks', label: 'Chispas' },
  { value: 'stars', label: 'Estrellas' },
];

const PLACE_TARGET_LABEL: Record<
  'fire' | 'smoke' | 'sparks' | 'stars',
  string
> = {
  fire: 'fuego',
  smoke: 'humo',
  sparks: 'chispas',
  stars: 'estrellas',
};

const ANCHOR_COLORS: Record<'fire' | 'smoke' | 'sparks', number> = {
  fire: 0xff7a1a,
  smoke: 0xb8c2cc,
  sparks: 0x66d9ff,
};

let anchorMarkerTextureCache: THREE.Texture | null = null;

/** Textura de marcador: anillo con punto central (se ve sobre el objeto). */
function getAnchorMarkerTexture(): THREE.Texture {
  if (anchorMarkerTextureCache) return anchorMarkerTextureCache;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 20, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(32, 32, 5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  anchorMarkerTextureCache = tex;
  return tex;
}

/** Sprite-marcador de un foco de efecto, coloreado según el caso. */
function makeAnchorMarker(kind: 'fire' | 'smoke' | 'sparks'): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: getAnchorMarkerTexture(),
    color: ANCHOR_COLORS[kind],
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 998;
  sprite.scale.setScalar(0.14);
  sprite.userData.kind = kind;
  return sprite;
}

/** Vacía los focos de efecto y sus marcadores. */
function clearFxAnchors(
  group: THREE.Group | null,
  anchors: { fire: THREE.Vector3[]; smoke: THREE.Vector3[]; sparks: THREE.Vector3[] }
): void {
  anchors.fire.length = 0;
  anchors.smoke.length = 0;
  anchors.sparks.length = 0;
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    const sp = child as THREE.Sprite;
    sp.material?.dispose?.();
  }
}

// ============================================================
// Efectos por objeto: runtime + sincronización
// ============================================================

const TIPOS_FX: EffectType[] = ['rain', 'smoke', 'stars', 'fire', 'sparks', 'glow'];

/**
 * Runtime de FX de UN objeto: los sistemas de partículas, los focos
 * colocados, las estrellas colocadas y los shells del halo viven en un
 * grupo hijo del grupo visual del objeto (duplicado o malla principal),
 * así el efecto sigue al objeto sin matemática extra.
 */
type RuntimeFxObjeto = {
  objectId: string;
  /** Grupo FX (userData.esGrupoFx = true), hijo del grupo visual del objeto. */
  grupo: THREE.Group;
  /** Marcadores de los focos colocados (hijo del grupo FX). */
  anchorGroup: THREE.Group;
  /** Focos por tipo, en coordenadas locales del grupo FX. */
  focos: { fire: THREE.Vector3[]; smoke: THREE.Vector3[]; sparks: THREE.Vector3[] };
  rain: RainSystem | null;
  smoke: SmokeSystem | null;
  fire: ParticleSystem | null;
  sparks: ParticleSystem | null;
  stars: StarSystem | null;
  /** Estrellas colocadas con clic (persistentes por objeto). */
  colocadas: PlacedStarSystem;
  /** Copia local de las estrellas serializadas (para quitar al clic). */
  estrellas: { x: number; y: number; z: number; tamaño?: number }[];
  /** Shells del halo de neón + material propio (uniformes por objeto). */
  glowShells: THREE.Mesh[];
  glowShellsFirma: string;
  glowMaterial: THREE.ShaderMaterial | null;
  /** Luz cálida del fuego (hija del grupo FX). */
  luz: THREE.PointLight | null;
  /** Firmas de los focos/estrellas serializados (reconstruir al deshacer). */
  firmaFocos: string;
  firmaEstrellas: string;
  /** Malla del objeto (para cajas de lluvia/humo y muestreo). */
  malla: Mesh | null;
  /** Muestreador de superficie de la malla del objeto. */
  sampler: () => THREE.Vector3 | null;
  /** Valores estáticos resueltos por tipo (dictados por obj.efectos). */
  estatico: Partial<Record<EffectType, EfectoValores>>;
  /** Flags de emisión (las pistas de efecto los apagan/encienden). */
  rainActivo: boolean;
  smokeActivo: boolean;
  starsOn: boolean;
  /** Tamaño de estrella estático (1 si el objeto no tiene el efecto). */
  starSize: number;
  /** Conteos actuales (para recrear sistemas cuando cambia count). */
  counts: { rain: number; fire: number; sparks: number };
};

/** Firma estable de una lista de focos runtime. */
function firmaDeFocos(focos: {
  fire: THREE.Vector3[];
  smoke: THREE.Vector3[];
  sparks: THREE.Vector3[];
}): string {
  return (
    ['fire', 'smoke', 'sparks'] as const
  )
    .map((k) => firmaPuntos(focos[k]))
    .join('#');
}

/** Firma estable de una lista de puntos serializados. */
function firmaPuntos(
  puntos: { x: number; y: number; z: number; tamaño?: number }[] | undefined
): string {
  if (!puntos || puntos.length === 0) return '';
  return puntos
    .map((p) =>
      p.tamaño !== undefined
        ? `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${p.tamaño}`
        : `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`
    )
    .join('|');
}

/** Punto aleatorio de la superficie de una malla (emisor de partículas). */
/** Factor del relieve de textura: mucho más marcado que antes (era 0.5). */
const FACTOR_RELIEVE_BUMP = 15;

/**
 * Textura dedicada SOLO al relieve (bump): si la malla trae
 * `bumpTexture`, se carga como bumpMap del material en espacio lineal
 * (el bump se lee crudo; SRGB lo aplastaría) y la textura normal queda
 * solo con el color. Intensidad según `textureRelief`.
 */
function aplicarTexturaRelieve(
  material: THREE.MeshPhysicalMaterial,
  mesh: {
    bumpTexture?: string;
    bumpTextureRepeat?: number;
    bumpTextureRepeatY?: number;
    textureRelief?: number;
    textureRepeat?: number;
    textureRepeatY?: number;
  },
  repeat: number,
  repeatY?: number
): void {
  if (!mesh.bumpTexture) return;
  // Su propia repetición si la tiene; si no, la de la textura normal.
  // El eje Y del relieve copia el de la TEXTURA salvo que el relieve tenga
  // repetición horizontal propia (entonces su Y copia su X) o un Y propio.
  const repiteX = mesh.bumpTextureRepeat ?? repeat;
  const repiteY =
    mesh.bumpTextureRepeatY ??
    (mesh.bumpTextureRepeat != null ? repiteX : repeatY ?? repeat);
  new THREE.TextureLoader().load(
    mesh.bumpTexture,
    (t) => {
      t.anisotropy = 4;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      // Repetición INDEPENDIENTE por eje: horizontal (X) y vertical (Y).
      t.repeat.set(repiteX, repiteY);
      material.bumpMap = t;
      material.bumpScale = (mesh.textureRelief ?? 0) * FACTOR_RELIEVE_BUMP;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      // Sin la textura de relieve el objeto queda liso: no hay nada que hacer.
    }
  );
}

function muestreadorDeMalla(malla: Mesh | null): () => THREE.Vector3 | null {
  return () => {
    if (!malla || malla.vertices.length === 0) return null;
    if (malla.texture) {
      // Modo "vista plana": muestrea el rectángulo del panel
      const v = malla.vertices;
      const x = v[0].x + Math.random() * (v[1].x - v[0].x);
      const y = v[0].y + Math.random() * (v[3].y - v[0].y);
      return new THREE.Vector3(x, y, 0);
    }
    const v = malla.vertices[(Math.random() * malla.vertices.length) | 0];
    return new THREE.Vector3(v.x, v.y, v.z);
  };
}

/** Caja expandida para la lluvia y origen del humo (base-centro). */
function cajaDeMalla(
  malla: Mesh | null
): { box: THREE.Box3; origin: THREE.Vector3 } | null {
  if (!malla || malla.vertices.length === 0) return null;
  const box = new THREE.Box3();
  for (const v of malla.vertices) box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
  const min = box.min.clone();
  const center = new THREE.Vector3();
  box.getCenter(center);
  const origin = new THREE.Vector3(center.x, min.y, center.z);
  const pad = box.getSize(new THREE.Vector3()).multiplyScalar(0.15);
  box.min.sub(pad);
  box.max.add(pad);
  box.max.y += 0.3;
  return { box, origin };
}

function crearRuntimeFxObjeto(objectId: string, malla: Mesh | null): RuntimeFxObjeto {
  const grupo = new THREE.Group();
  grupo.userData.esGrupoFx = true;
  const anchorGroup = new THREE.Group();
  anchorGroup.userData.esGrupoFx = true;
  grupo.add(anchorGroup);
  const colocadas: PlacedStarSystem = { group: new THREE.Group(), stars: [] };
  colocadas.group.userData.esGrupoFx = true;
  grupo.add(colocadas.group);
  const luz = new THREE.PointLight(0xff8040, 0, 6, 1.6);
  luz.position.set(0, 0.2, 1.4);
  grupo.add(luz);
  return {
    objectId,
    grupo,
    anchorGroup,
    focos: { fire: [], smoke: [], sparks: [] },
    rain: null,
    smoke: null,
    fire: null,
    sparks: null,
    stars: null,
    colocadas,
    estrellas: [],
    glowShells: [],
    glowShellsFirma: '',
    glowMaterial: null,
    luz,
    firmaFocos: '',
    firmaEstrellas: '',
    malla,
    sampler: muestreadorDeMalla(malla),
    estatico: {},
    rainActivo: false,
    smokeActivo: false,
    starsOn: false,
    starSize: 1,
    counts: { rain: 0, fire: 0, sparks: 0 },
  };
}

/** Libera TODOS los recursos THREE del runtime (sin tocar la geometría
 *  compartida de los shells: vive en las mallas del objeto). */
function disponerSistemasFx(rt: RuntimeFxObjeto): void {
  for (const sys of [rt.rain, rt.smoke, rt.fire, rt.sparks]) {
    if (!sys) continue;
    rt.grupo.remove(sys.points);
    sys.points.geometry.dispose();
    (sys.points.material as THREE.Material)?.dispose();
  }
  rt.rain = null;
  rt.smoke = null;
  rt.fire = null;
  rt.sparks = null;
  if (rt.stars) {
    for (const s of rt.stars.stars) s.sprite.material.dispose();
    rt.grupo.remove(rt.stars.group);
    rt.stars = null;
  }
  if (rt.colocadas) {
    clearPlacedStars(rt.colocadas);
    rt.grupo.remove(rt.colocadas.group);
  }
  clearFxAnchors(rt.anchorGroup, rt.focos);
  for (const shell of rt.glowShells) rt.grupo.remove(shell);
  rt.glowShells = [];
  rt.glowShellsFirma = '';
  rt.glowMaterial?.dispose();
  rt.glowMaterial = null;
  rt.focos = { fire: [], smoke: [], sparks: [] };
  rt.estrellas = [];
  rt.estatico = {};
  rt.counts = { rain: 0, fire: 0, sparks: 0 };
}

/** Añade un foco de efecto con su marcador visible al runtime. */
function anadirFocoObjeto(
  rt: RuntimeFxObjeto,
  kind: 'fire' | 'smoke' | 'sparks',
  local: THREE.Vector3
): void {
  const marker = makeAnchorMarker(kind);
  marker.position.copy(local);
  rt.anchorGroup.add(marker);
  rt.focos[kind].push(local.clone());
}

/** Quita el foco del efecto dado más cercano al rayo (en espacio local). */
function quitarFocoObjeto(
  rt: RuntimeFxObjeto,
  kind: 'fire' | 'smoke' | 'sparks',
  localRay: THREE.Ray
): boolean {
  const list = rt.focos[kind];
  let best = -1;
  let bestDist = 0.09;
  for (let i = 0; i < list.length; i++) {
    const d = localRay.distanceToPoint(list[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return false;
  const [punto] = list.splice(best, 1);
  const marcador = rt.anchorGroup.children.find(
    (c) =>
      c.userData.kind === kind &&
      c.position.distanceToSquared(punto) < 1e-8
  );
  if (marcador) {
    rt.anchorGroup.remove(marcador);
    (marcador as THREE.Sprite).material?.dispose?.();
  }
  return true;
}

/**
 * Crea (o ajusta) el sistema de partículas de un tipo con los valores
 * dados. Recrea el sistema cuando cambia `count`; los demás parámetros
 * se ajustan en el sitio. `activo` controla la visibilidad.
 */
function asegurarSistemaFx(
  rt: RuntimeFxObjeto,
  tipo: EffectType,
  valores: EfectoValores,
  activo: boolean
): void {
  const grupo = rt.grupo;
  switch (tipo) {
    case 'sparks': {
      const count = valores.sparksCount ?? DEFAULT_FX_CONFIG.sparksCount;
      const size = valores.sparksSize ?? DEFAULT_FX_CONFIG.sparksSize;
      if (rt.sparks && rt.sparks.life.length !== count) {
        grupo.remove(rt.sparks.points);
        rt.sparks.points.geometry.dispose();
        (rt.sparks.points.material as THREE.Material)?.dispose();
        rt.sparks = null;
      }
      if (!rt.sparks) {
        // Las chispas también respetan la oclusión (depthTest): nacen dentro
        // del objeto y se ven al saltar fuera, sin atravesar lo que delante haya.
        rt.sparks = createParticleSystem(count, size, { depthTest: true });
        grupo.add(rt.sparks.points);
      } else {
        const mat = rt.sparks.points.material as THREE.PointsMaterial;
        if (mat.size !== size) {
          mat.size = size;
          mat.needsUpdate = true;
        }
      }
      rt.sparks.points.visible = activo;
      rt.counts.sparks = count;
      break;
    }
    case 'fire': {
      const count = valores.fireCount ?? DEFAULT_FX_CONFIG.fireCount;
      const size = valores.fireSize ?? DEFAULT_FX_CONFIG.fireSize;
      const estilo = valores.fireEstilo ?? DEFAULT_FX_CONFIG.fireEstilo;
      if (rt.fire && rt.fire.life.length !== count) {
        grupo.remove(rt.fire.points);
        rt.fire.points.geometry.dispose();
        (rt.fire.points.material as THREE.Material)?.dispose();
        rt.fire = null;
      }
      if (!rt.fire) {
        rt.fire = crearSistemaFuego(count, size);
        grupo.add(rt.fire.points);
      } else {
        const mat = rt.fire.points.material as THREE.PointsMaterial;
        if (mat.size !== size) {
          mat.size = size;
          mat.needsUpdate = true;
        }
      }
      if (rt.fire.uniformesEstilo) {
        rt.fire.uniformesEstilo.uEstilo.value = Math.min(Math.max(estilo, 0), 1);
      }
      rt.fire.points.visible = activo;
      rt.counts.fire = count;
      break;
    }
    case 'rain': {
      if (!rt.malla || rt.malla.vertices.length === 0) break;
      const count = valores.rainCount ?? DEFAULT_FX_CONFIG.rainCount;
      const speed = valores.rainSpeed ?? DEFAULT_FX_CONFIG.rainSpeed;
      if (rt.rain && (rt.rain.velocities.length / 3 !== count)) {
        grupo.remove(rt.rain.points);
        rt.rain.points.geometry.dispose();
        (rt.rain.points.material as THREE.Material)?.dispose();
        rt.rain = null;
      }
      if (!rt.rain) {
        const caja = cajaDeMalla(rt.malla);
        if (!caja) break;
        rt.rain = createRainSystem(caja.box, count, speed);
        grupo.add(rt.rain.points);
      } else {
        rt.rain.speed = speed;
      }
      rt.rain.points.visible = activo;
      rt.counts.rain = count;
      break;
    }
    case 'smoke': {
      if (!rt.malla || rt.malla.vertices.length === 0) break;
      const count = valores.smokeCount ?? DEFAULT_FX_CONFIG.smokeCount;
      const size = valores.smokeSize ?? DEFAULT_FX_CONFIG.smokeSize;
      const color = valores.smokeColor ?? DEFAULT_FX_CONFIG.smokeColor;
      const riseSpeed = valores.smokeRiseSpeed ?? DEFAULT_FX_CONFIG.smokeRiseSpeed;
      if (rt.smoke && (rt.smoke.life.length !== count)) {
        grupo.remove(rt.smoke.points);
        rt.smoke.points.geometry.dispose();
        (rt.smoke.points.material as THREE.Material)?.dispose();
        rt.smoke = null;
      }
      if (!rt.smoke) {
        const caja = cajaDeMalla(rt.malla);
        if (!caja) break;
        rt.smoke = createSmokeSystem(caja.origin, count, size, color, riseSpeed, valores.fireIntensity ?? DEFAULT_FX_CONFIG.fireIntensity);
        grupo.add(rt.smoke.points);
      } else {
        const mat = rt.smoke.points.material as THREE.PointsMaterial;
        if (mat.size !== size) {
          mat.size = size;
          mat.needsUpdate = true;
        }
        rt.smoke.riseSpeed = riseSpeed;
        rt.smoke.color.set(color);
      }
      rt.smoke.points.visible = activo;
      break;
    }
    case 'stars': {
      if (!rt.stars) {
        rt.stars = createStarSystem();
        grupo.add(rt.stars.group);
      }
      rt.stars.group.visible = activo;
      break;
    }
    case 'glow': {
      asegurarGlowFx(rt, valores, activo);
      break;
    }
  }
}

/** Crea o ajusta el halo de neón del runtime (shells + uniformes). */
function asegurarGlowFx(
  rt: RuntimeFxObjeto,
  valores: EfectoValores,
  activo: boolean
): void {
  if (!rt.glowMaterial) {
    // La copia clona los uniformes: cada objeto tiene color/intensidad propios.
    rt.glowMaterial = getGlowMaterial().clone();
  }
  const mat = rt.glowMaterial;
  if (typeof valores.glowColor === 'string') {
    mat.uniforms.uColor.value = new THREE.Color(valores.glowColor);
  }
  if (typeof valores.glowIntensity === 'number') {
    mat.uniforms.uIntensity.value = valores.glowIntensity;
  }
  mat.uniformsNeedUpdate = true;
  // Shells: copias ampliadas de las mallas del grupo visual del objeto.
  // En el objeto activo la figura son mallas hijas directas de la malla
  // principal; en un duplicado la figura vive DENTRO de un visual anidado
  // (grupo que las encierra), así que se recorre ese visual — sin bajarlo
  // el neón solo salía en el objeto seleccionado.
  const padre = rt.grupo.parent;
  const firmas: string[] = [];
  const fuentes: THREE.Mesh[] = [];
  if (padre) {
    const esDuplicado = !!padre.userData?.sceneObjectDuplicate;
    for (const child of padre.children) {
      if (child === rt.grupo) continue;
      if (child instanceof THREE.Mesh) {
        if (child.userData?.isGlowShell) continue;
        fuentes.push(child);
        firmas.push(child.geometry.uuid);
        continue;
      }
      // Solo el visual PROPIO (transplantes de su figura, plugin, etc.):
      // al activo no se bajan los duplicados de los demás objetos (no son
      // su figura) ni los grupos de gizmo/efectos.
      if (!esDuplicado || !(child instanceof THREE.Group)) continue;
      child.traverse((item) => {
        if (item instanceof THREE.Mesh && !item.userData?.isGlowShell) {
          fuentes.push(item);
          firmas.push(item.geometry.uuid);
        }
      });
    }
  }
  const firma = firmas.join('|');
  if (firma !== rt.glowShellsFirma) {
    for (const shell of rt.glowShells) rt.grupo.remove(shell);
    rt.glowShells = [];
    for (const fuente of fuentes) {
      const shell = new THREE.Mesh(fuente.geometry, mat);
      shell.scale.setScalar(1.1);
      shell.userData.isGlowShell = true;
      rt.grupo.add(shell);
      rt.glowShells.push(shell);
    }
    rt.glowShellsFirma = firma;
  }
  for (const shell of rt.glowShells) shell.visible = activo;
}

/** Pone un sistema en silencio (sin disponerlo): lo usan las pistas. */
function silenciarSistemaFx(rt: RuntimeFxObjeto, tipo: EffectType): void {
  switch (tipo) {
    case 'rain':
      if (rt.rain) rt.rain.points.visible = false;
      rt.rainActivo = false;
      break;
    case 'smoke':
      if (rt.smoke) rt.smoke.points.visible = false;
      rt.smokeActivo = false;
      break;
    case 'stars':
      if (rt.stars) rt.stars.group.visible = false;
      rt.starsOn = false;
      break;
    case 'fire':
      if (rt.fire) rt.fire.points.visible = false;
      break;
    case 'sparks':
      if (rt.sparks) rt.sparks.points.visible = false;
      break;
    case 'glow':
      for (const shell of rt.glowShells) shell.visible = false;
      break;
  }
}

/** Dispara el sistema de un tipo con los valores por defecto (pistas). */
function dispararSistemaFx(
  rt: RuntimeFxObjeto,
  tipo: EffectType,
  valores: EfectoValores,
  activo: boolean
): void {
  const base = { ...VALORES_DEFECTO_EFECTO[tipo], ...valores };
  asegurarSistemaFx(rt, tipo, base, activo);
}

/**
 * Aplica los valores evaluados de una pista de efecto al runtime de UN
 * objeto. Generaliza el antiguo applyEffectOverrides (que solo tocaba
 * los singletons del objeto activo).
 */
function aplicarOverrideEfectoObjeto(
  rt: RuntimeFxObjeto,
  tipo: EffectType,
  values: Partial<Record<EffectProperty, number | string | boolean>>
): void {
  if (values.enabled === false) {
    silenciarSistemaFx(rt, tipo);
    return;
  }
  // Asegura el sistema (las pistas pueden activar efectos que el objeto
  // no tiene de forma estática) y aplica los overrides concretos.
  const base = { ...VALORES_DEFECTO_EFECTO[tipo], ...(rt.estatico[tipo] ?? {}) };
  asegurarSistemaFx(rt, tipo, base, true);
  switch (tipo) {
    case 'rain':
      rt.rainActivo = true;
      if (rt.rain) {
        if (typeof values.speed === 'number') rt.rain.speed = values.speed;
        if (
          typeof values.count === 'number' &&
          values.count !== rt.counts.rain
        ) {
          const anterior = rt.rain;
          rt.rain = createRainSystem(anterior.box, values.count, anterior.speed);
          rt.grupo.remove(anterior.points);
          anterior.points.geometry.dispose();
          (anterior.points.material as THREE.Material)?.dispose();
          rt.rain.points.visible = true;
          rt.counts.rain = values.count;
        }
      }
      break;
    case 'smoke':
      rt.smokeActivo = true;
      if (rt.smoke) {
        if (typeof values.riseSpeed === 'number') rt.smoke.riseSpeed = values.riseSpeed;
        if (typeof values.size === 'number') {
          (rt.smoke.points.material as THREE.PointsMaterial).size = values.size;
          (rt.smoke.points.material as THREE.PointsMaterial).needsUpdate = true;
        }
        if (typeof values.color === 'string') rt.smoke.color.set(values.color);
      }
      break;
    case 'stars':
      rt.starsOn = true;
      if (rt.stars) {
        rt.stars.group.visible = true;
        if (typeof values.starSize === 'number') rt.starSize = values.starSize;
      }
      break;
    case 'fire':
      if (rt.fire) {
        if (typeof values.intensity === 'number' && values.intensity <= 0) {
          rt.fire.points.visible = false;
        }
        if (typeof values.size === 'number') {
          (rt.fire.points.material as THREE.PointsMaterial).size = values.size;
          (rt.fire.points.material as THREE.PointsMaterial).needsUpdate = true;
        }
        if (
          typeof values.count === 'number' &&
          values.count !== rt.counts.fire
        ) {
          const anterior = rt.fire;
          const size = (anterior.points.material as THREE.PointsMaterial).size;
          rt.fire = crearSistemaFuego(values.count, size);
          // Conserva el estilo y el centro de convergencia del anterior.
          if (anterior.uniformesEstilo && rt.fire.uniformesEstilo) {
            rt.fire.uniformesEstilo.uEstilo.value =
              anterior.uniformesEstilo.uEstilo.value;
          }
          if (anterior.origen) rt.fire.origen = anterior.origen.clone();
          rt.grupo.remove(anterior.points);
          anterior.points.geometry.dispose();
          (anterior.points.material as THREE.Material)?.dispose();
          rt.fire.points.visible = true;
          rt.counts.fire = values.count;
        }
      }
      break;
    case 'sparks':
      if (rt.sparks) {
        if (typeof values.size === 'number') {
          (rt.sparks.points.material as THREE.PointsMaterial).size = values.size;
          (rt.sparks.points.material as THREE.PointsMaterial).needsUpdate = true;
        }
        if (
          typeof values.count === 'number' &&
          values.count !== rt.counts.sparks
        ) {
          const anterior = rt.sparks;
          const size = (anterior.points.material as THREE.PointsMaterial).size;
          rt.sparks = createParticleSystem(values.count, size, { depthTest: true });
          rt.grupo.remove(anterior.points);
          anterior.points.geometry.dispose();
          (anterior.points.material as THREE.Material)?.dispose();
          rt.sparks.points.visible = true;
          rt.counts.sparks = values.count;
        }
      }
      break;
    case 'glow': {
      if (!rt.glowMaterial) rt.glowMaterial = getGlowMaterial().clone();
      const mat = rt.glowMaterial;
      if (typeof values.glowColor === 'string') {
        mat.uniforms.uColor.value = new THREE.Color(values.glowColor);
      }
      if (typeof values.glowIntensity === 'number') {
        mat.uniforms.uIntensity.value = values.glowIntensity;
      }
      mat.uniformsNeedUpdate = true;
      for (const shell of rt.glowShells) shell.visible = true;
      break;
    }
  }
}

/** Emisor de partículas del runtime: focos colocados o superficie. */
function emisorDeFoco(
  rt: RuntimeFxObjeto,
  kind: 'fire' | 'smoke' | 'sparks'
): () => THREE.Vector3 | null {
  const list = rt.focos[kind];
  if (list.length > 0) {
    return () => list[(Math.random() * list.length) | 0];
  }
  return rt.sampler;
}
