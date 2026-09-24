'use client';

import { useState, useRef, useEffect, type FC } from 'react';
import { createPortal } from 'react-dom';
import Viewer3D, { type ObjectTransform, type GizmoMode } from '@/components/viewer-3d';
import { PanelButtons } from '@/components/editor/Editor3D';
import { useI18n } from '@/lib/i18n';
import type {
  AnimationTrack,
  CameraKeyframe,
  Vec3,
   TransformTrack,
   PluginParamTrack,
   EffectTrack,
} from '@/lib/animation';

/** Vista que puede mostrar una ventana (incluye los dos costados). */
export type PanelViewKind = 'front' | 'back' | 'top' | 'bottom' | 'side' | 'sideLeft' | '3d';
/** Ventana física del área de trabajo (su posición en la rejilla 2x2). */
export type PanelSlot = 'front' | 'top' | 'side' | '3d';

interface ViewerPanelProps {
  viewName: PanelSlot;
  label: string;
  /** Vista que muestra ESTA ventana (puede diferir de su posición). */
  viewKind?: PanelViewKind;
  /** Cambia la vista que muestra esta ventana. */
  onViewKindChange?: (v: PanelViewKind) => void;
  /** Encuadra los objetos solo en esta ventana. */
  onFrameWindow?: () => void;
  /** Encuadra los objetos en las cuatro ventanas. */
  onFrameAll?: () => void;
  /** Abre el modal de diseño de ventanas del área de trabajo. */
  onOpenLayout?: () => void;
  /** Al cambiar, el visor encuadra (ajusta zoom/centro) lo que se ve. */
  frameToken?: number;
  editingState: boolean;
  onSetEditing: (v: boolean) => void;
  onActiveView: () => void;
  activeView: string | null;
  viewerMesh: any;
  visibleSceneObjects: any[];
  configObjectId: string | null;
  triMesh: any;
  smoothShadingValue: boolean;
  textureProjection: any;
    selectedObjectId: string | null;
    sceneObjects: any[];
    handleObjectSelect: (id: string | null) => void;
    selectedObjectIds?: string[];
    onSelectionChange?: (ids: string[]) => void;
    selectionMode?: boolean;
    onSelectionModeChange?: (active: boolean) => void;
    faceSelectMode?: boolean;
    faceSelectionTool?: 'rectangle' | 'circle' | 'line';
    faceSelectionTarget?: 'cara' | 'vertice' | 'segmento';
    faceSelectVisibleOnly?: boolean;
    wireframeOffSignal?: number;
    selectedFaceIds?: number[];
    onFaceSelectionChange?: (faceIds: number[]) => void;
    selectedVertexIds?: number[];
    onVertexSelectionChange?: (vertexIds: number[]) => void;
    selectedEdgeIds?: string[];
    onEdgeSelectionChange?: (edgeIds: string[]) => void;
    onFaceSelectionModeChange?: (active: boolean) => void;
    onFaceSelectionToolChange?: (tool: 'rectangle' | 'circle' | 'line') => void;
    onFaceSelectionTargetChange?: (target: 'cara' | 'vertice' | 'segmento') => void;
    onMultiObjectTransform?: (transforms: { id: string; transform: ObjectTransform }[]) => void;
    objectName?: string;
    onObjectNameChange?: (name: string) => void;
   showGizmo: boolean;
   gizmoModes?: GizmoMode[];
   gizmoInteractive?: boolean;
   gizmoColorOverride?: number;
   /** Offset del gizmo respecto al objeto (solo el manipulador). */
   gizmoOffset?: ObjectTransform;
   /** Notifica al padre del nuevo offset del gizmo (modo configuración). */
   onGizmoOffsetChange?: (t: ObjectTransform) => void;
   handleObjectTransform: (transform: any) => void;
   handleVerticesChange: (vertices: any) => void;
   showLatheAxis: boolean;
   viewerProjection: any;
   textureHelper: any;
   textureHelperTransform: any;
    textureRepeat?: number;
    textureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
    textureRelief?: number;
   setTextureHelperTransform: (transform: any) => void;
   lightConfig: any;
   showLightHelpers: boolean;
   showGround: boolean;
   showGrid: boolean;
   setShowGrid: (show: boolean) => void;
   fxConfig: any;
   setFxConfig: (fn: (prev: any) => any) => void;
   setLightConfig: (cfg: any) => void;
   panelCameras: Record<string, any>;
   groundTexture?: string | null;
   groundTextureRepeat?: number;
   groundTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
  objectTextureFinish?: 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';
   skyboxImage?: string | null;
   /** Objeto cortador en modo boolean preview: se muestra transparente */
   booleanToolObjectId?: string | null;
   forceUpdate?: number;
   handleCameraChange: (view: any, cam: any) => void;
  animationTracks?: AnimationTrack[];
  animationTime?: number;
  onAnimationComplete?: (trackId: string) => void;
   /** Pistas de transformada del editor de movimiento (segundos). */
   transformTracks?: TransformTrack[];
   /** Pistas de parámetros de plugin del editor de movimiento. */
   pluginTracks?: PluginParamTrack[];
   /** Pistas de efectos visuales del editor de movimiento. */
   effectTracks?: EffectTrack[];
  /** Malla base congelada por objectId para las pistas de plugin. */
  pluginBaseMeshes?: Record<string, unknown>;
  /** Reproducción o scrub del editor de movimiento activo: el visor aplica override. */
  motionPlaying?: boolean;
  /** Recorrido editable del objeto seleccionado visible en el visor. */
  showMotionPath?: boolean;
  /** Mueve la posición de un fotograma del recorrido del objeto. */
  onMotionKeyframeMove?: (index: number, pos: Vec3) => void;
  viewerSmooth: boolean;
  pan3D: (view: any, dx: number, dy: number) => void;
  zoom3D: (view: any, f: number) => void;
  orbit3D: (view: any, dir: any, angle: number) => void;
    /** Cámara-objeto que maneja la vista de cámara / exportación MP4 */
    activeCamera?: { id: string; keyframes: CameraKeyframe[]; fov: number } | null;
    /** Cámara de exportación MP4 (primera con ≥2 fotogramas) */
    exportCamera?: { id: string; keyframes: CameraKeyframe[]; fov: number } | null;
    /** Cámaras-objeto de la escena para el selector de la ventana */
    camarasObjeto?: { id: string; n: number; etiqueta: string; nombre?: string }[];
    /** Cámara-objeto activa en ESTA ventana (id; null = vista libre) */
    camaraObjetoId?: string | null;
    /** Cambia la cámara activa de esta ventana */
    onCamaraObjetoChange?: (id: string | null) => void;
    /** Modo grabación activo en ESTA ventana */
    grabacionActiva?: boolean;
    /** Enciende/apaga el modo grabación de esta ventana */
    onGrabacionToggle?: () => void;
    /** Captura de fotograma al soltar un arrastre de la vista grabando */
    onGrabacionCaptura?: (pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number }) => void;
    /** Cámara-objeto en grabación (global): soltar el gizmo sobre ella captura un kf */
    grabacionCamaraId?: string | null;
    /** Cámara-objeto en edición (foco del fotograma activo) */
    cameraEditor?: {
      objectId: string;
      keyframeIndex: number | null;
      focus: Vec3 | null;
      keyframes: CameraKeyframe[];
      fov: number;
    };
    /** Mueve la posición de un fotograma del recorrido (asa cian) */
    onCameraKeyframeMove?: (index: number, pos: Vec3) => void;
    /** Mueve el foco del fotograma seleccionado (asa naranja) */
    onCameraTargetMove?: (pos: Vec3) => void;
    /** Orbita el foco alrededor del cuerpo al ROTAR la cámara con el gizmo */
    onCameraTargetOrbit?: (target: Vec3) => void;
    exportMp4Trigger?: number;
   onExportProgress?: (percent: number) => void;
   onExportComplete?: (result: { success: boolean; outputPath?: string; error?: string }) => void;
}

export const ViewerPanel: FC<ViewerPanelProps> = ({  viewName,
  label,
  viewKind,
  onViewKindChange,
  onFrameWindow,
  onFrameAll,
  onOpenLayout,
  frameToken,
  editingState,
  onSetEditing,
  onActiveView,
  activeView,
  viewerMesh,
  visibleSceneObjects,
  configObjectId,
  triMesh,
  smoothShadingValue,
  textureProjection,
    selectedObjectId,
    sceneObjects,
    handleObjectSelect,
    selectedObjectIds,
    onSelectionChange,
    selectionMode,
    onSelectionModeChange,
    faceSelectMode,
    faceSelectionTool,
    faceSelectionTarget,
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
    onMultiObjectTransform,
    objectName,
    onObjectNameChange,
   showGizmo,
   gizmoModes,
   gizmoInteractive,
   gizmoColorOverride,
   gizmoOffset,
   onGizmoOffsetChange,
   handleObjectTransform,
  handleVerticesChange,
  showLatheAxis,
   viewerProjection,
   textureHelper,
   textureHelperTransform,
    textureRepeat,
    textureFinish,
    textureRelief,
  setTextureHelperTransform,
  lightConfig,
  showLightHelpers,
  showGround,
    groundTexture,
    groundTextureRepeat,
    groundTextureFinish,
   objectTextureFinish,
   skyboxImage,
   booleanToolObjectId,
   forceUpdate,
   showGrid,
  setShowGrid,
  fxConfig,
  setFxConfig,
  setLightConfig,
  panelCameras,
  handleCameraChange,
  animationTracks,
  animationTime,
  onAnimationComplete,
   transformTracks,
   pluginTracks,
   effectTracks,
  pluginBaseMeshes,
  motionPlaying,
   showMotionPath,
  onMotionKeyframeMove,
  viewerSmooth,
  pan3D,
  zoom3D,
   orbit3D,
    activeCamera,
    exportCamera,
    camarasObjeto,
    camaraObjetoId,
    onCamaraObjetoChange,
    grabacionActiva,
    onGrabacionToggle,
    onGrabacionCaptura,
    grabacionCamaraId,
    cameraEditor,
    onCameraKeyframeMove,
    onCameraTargetMove,
    onCameraTargetOrbit,
    exportMp4Trigger,
    onExportProgress,
    onExportComplete,
}) => {
  const { t } = useI18n();
  const vk: PanelViewKind = viewKind ?? viewName;
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuPos, setViewMenuPos] = useState<{ top: number; left: number } | null>(null);
  const viewMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const viewMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const toggleViewMenu = () => {
    setViewMenuOpen((open) => {
      if (!open) {
        const rect = viewMenuBtnRef.current?.getBoundingClientRect();
        if (rect) setViewMenuPos({ top: rect.bottom + 4, left: rect.left });
      }
      return !open;
    });
  };
  useEffect(() => {
    if (!viewMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Clic dentro del panel (portal) o en el propio botón: no cerrar aquí.
      if (viewMenuPanelRef.current?.contains(target)) return;
      if (viewMenuBtnRef.current?.contains(target)) return;
      setViewMenuOpen(false);
    };
    const close = () => setViewMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [viewMenuOpen]);
  const VISTA_LABELS: Record<PanelViewKind, string> = {
    front: t('editor3D.views.front'),
    back: t('editor3D.views.back'),
    top: t('editor3D.views.top'),
    bottom: t('editor3D.views.bottom'),
    side: t('editor3D.views.sideRight'),
    sideLeft: t('editor3D.views.sideLeft'),
    '3d': t('editor3D.panelLabels.threeDFree'),
  };
  return (
  <div
    onClick={onActiveView}
    className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-colors ${
      activeView === viewName
        ? 'border-green-500'
        : 'border-white/10'
    }`}
  >
    <div className="flex items-center justify-between gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-green-300 shrink-0">
          {label}
        </span>
        <div className="shrink-0">
          <button
            ref={viewMenuBtnRef}
            data-testid={`view-menu-${viewName}`}
            onClick={toggleViewMenu}
            title={t('editor3D.panelViewTitle')}
            className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-foreground/90 hover:bg-white/10 cursor-pointer"
          >
            <span>{VISTA_LABELS[vk]}</span>
            <span className="text-[8px] leading-none">▼</span>
          </button>
        </div>
        {viewMenuOpen &&
          viewMenuPos &&
          createPortal(
            <div
              ref={viewMenuPanelRef}
              style={{
                position: 'fixed',
                top: viewMenuPos.top,
                left: viewMenuPos.left,
                zIndex: 9999,
              }}
              className="min-w-[190px] rounded-md border border-white/15 bg-gray-900/95 backdrop-blur shadow-lg py-1"
            >
              {(['front', 'back', 'side', 'sideLeft', 'top', 'bottom', '3d'] as const).map((v) => (
                <button
                  key={v}
                  data-testid={`view-opt-${viewName}-${v}`}
                  onClick={() => {
                    onViewKindChange?.(v);
                    setViewMenuOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3 ${
                    vk === v ? 'text-green-300' : 'text-foreground/90'
                  }`}
                >
                  <span>{VISTA_LABELS[v]}</span>
                  {vk === v && <span>✓</span>}
                </button>
              ))}
              <div className="my-1 h-px bg-white/10" />
              <button
                data-testid={`frame-window-${viewName}`}
                onClick={() => {
                  onFrameWindow?.();
                  setViewMenuOpen(false);
                }}
                className="w-full text-left px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer text-foreground/90"
              >
                ⤡ {t('editor3D.panelFrameThis')}
              </button>
              <button
                data-testid={`frame-all-${viewName}`}
                onClick={() => {
                  onFrameAll?.();
                  setViewMenuOpen(false);
                }}
                className="w-full text-left px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer text-foreground/90"
              >
                ⛶ {t('editor3D.panelFrameAll')}
              </button>
              <div className="my-1 h-px bg-white/10" />
              <button
                data-testid={`layout-window-${viewName}`}
                onClick={() => {
                  onOpenLayout?.();
                  setViewMenuOpen(false);
                }}
                className="w-full text-left px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer text-foreground/90"
              >
                ▦ {t('editor3D.panelLayout')}
              </button>
            </div>,
            document.body
          )}
        {camarasObjeto && camarasObjeto.length > 0 && (
          <select
            value={camaraObjetoId ?? ''}
            onChange={(e) => onCamaraObjetoChange?.(e.target.value || null)}
            title={t('editor3D.panelCameraSelect')}
            data-testid={`camera-select-${viewName}`}
            className="px-1 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] text-foreground max-w-[120px] cursor-pointer"
          >
            <option value="">{t('editor3D.noCamera')}</option>
            {camarasObjeto.map((c) => (
              <option key={c.id} value={c.id}>
                {c.etiqueta}{c.nombre && c.nombre !== c.etiqueta ? ` · ${c.nombre}` : ''}
              </option>
            ))}
          </select>
        )}
        {camaraObjetoId && (
          <button
            onClick={() => onGrabacionToggle?.()}
            title={grabacionActiva ? t('editor3D.recStop') : t('editor3D.rec')}
            data-testid={`rec-btn-${viewName}`}
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 cursor-pointer border ${
              grabacionActiva
                ? 'bg-red-500/25 border-red-500/60 text-red-200'
                : 'bg-black/40 border-white/10 text-foreground/80 hover:text-red-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                grabacionActiva ? 'bg-red-500 animate-pulse' : 'bg-foreground/40'
              }`}
            />
            REC
          </button>
        )}
      </div>
      <PanelButtons
        onPan={(dx: number, dy: number) => pan3D(viewName, dx * 0.02, dy * 0.02)}
        onZoom={(f: number) => zoom3D(viewName, f)}
        onRotateLeft={() => orbit3D(viewName, 'left', -15)}
        onRotateRight={() => orbit3D(viewName, 'left', 15)}
        onEdit={() => onSetEditing(!editingState)}
        showRotate
        isEditing={editingState}
        viewName={viewName}
      />
    </div>
     <div className="flex-1 min-h-0">
       <Viewer3D
         key={`${viewName}-${editingState}`}
         mesh={viewerMesh}
         objects={visibleSceneObjects}
         configObjectId={configObjectId}
         configMesh={triMesh}
         configSmooth={smoothShadingValue}
         configProjection={textureProjection}
          selectedObjectId={selectedObjectId ?? undefined}
          onObjectSelect={handleObjectSelect}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={onSelectionChange}
           selectionMode={selectionMode}
           onSelectionModeChange={onSelectionModeChange}
           faceSelectMode={faceSelectMode}
           faceSelectionTool={faceSelectionTool}
           faceSelectionTarget={faceSelectionTarget}
           faceSelectVisibleOnly={faceSelectVisibleOnly}
           wireframeOffSignal={wireframeOffSignal}
           selectedFaceIds={selectedFaceIds}
           onFaceSelectionChange={onFaceSelectionChange}
           selectedVertexIds={selectedVertexIds}
           onVertexSelectionChange={onVertexSelectionChange}
           selectedEdgeIds={selectedEdgeIds}
           onEdgeSelectionChange={onEdgeSelectionChange}
           onFaceSelectionModeChange={onFaceSelectionModeChange}
           onFaceSelectionToolChange={onFaceSelectionToolChange}
           onFaceSelectionTargetChange={onFaceSelectionTargetChange}
          onMultiObjectTransform={onMultiObjectTransform}
           objectName={objectName}
           onObjectNameChange={onObjectNameChange}
            gizmo={showGizmo}
            gizmoModes={gizmoModes}
            gizmoInteractive={gizmoInteractive}
            gizmoColorOverride={gizmoColorOverride}
            gizmoOffset={gizmoOffset}
            onGizmoOffsetChange={onGizmoOffsetChange}
           booleanToolObjectId={booleanToolObjectId}
           forceObjectsUpdate={forceUpdate}
          objectTransform={
           sceneObjects.find((o) => o.id === selectedObjectId)?.transform
         }
         onObjectTransform={handleObjectTransform}
         onVerticesChange={handleVerticesChange}
         showVerticesDefault={false}
         showLatheAxis={showLatheAxis}
         textureProjection={viewerProjection}
         textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          onTextureHelperTransform={setTextureHelperTransform}
          textureRepeat={textureRepeat}
          configFinish={textureFinish}
          configRelief={textureRelief}
         lightConfig={lightConfig}
         showLightHelpers={showLightHelpers}
         showGround={showGround}
          groundTexture={groundTexture}
           groundTextureRepeat={groundTextureRepeat}
           groundTextureFinish={groundTextureFinish}
          objectTextureFinish={objectTextureFinish}
         skyboxImage={skyboxImage}
         showGrid={showGrid}
         onShowGridChange={setShowGrid}
         fxConfig={fxConfig}
         onFxChange={(fx) => setFxConfig((prev) => ({ ...prev, ...fx }))}
         onLightConfigChange={setLightConfig}
         camera3D={panelCameras[viewName]}
         frameToken={frameToken}
         onCameraChange={(cam) => handleCameraChange(viewName, cam)}
         activeCamera={activeCamera}
         exportCamera={exportCamera}
         cameraEditor={cameraEditor}
         onCameraKeyframeMove={onCameraKeyframeMove}
         onCameraTargetMove={onCameraTargetMove}
         onCameraTargetOrbit={onCameraTargetOrbit}
         grabacionActiva={grabacionActiva}
         onGrabacionCaptura={onGrabacionCaptura}
         grabacionCamaraId={grabacionCamaraId}
         animationTracks={animationTracks}
         animationTime={animationTime}
         onAnimationComplete={onAnimationComplete}
         transformTracks={transformTracks}
          pluginTracks={pluginTracks}
          effectTracks={effectTracks}
         pluginBaseMeshes={pluginBaseMeshes}
          motionPlaying={motionPlaying}
         showMotionPath={showMotionPath}
         onMotionKeyframeMove={onMotionKeyframeMove}
         smoothShading={viewerSmooth}
         exportMp4Trigger={exportMp4Trigger}
         onExportProgress={onExportProgress}
         onExportComplete={onExportComplete}
       />
     </div>
   </div>
  );
};
