'use client';

import type { FC } from 'react';
import Viewer3D, { type ObjectTransform } from '@/components/viewer-3d';
import { PanelButtons } from '@/components/editor/Editor3D';
import { useI18n } from '@/lib/i18n';
import type { AnimationTrack, CameraKeyframe, Vec3 } from '@/lib/animation';

interface ViewerPanelProps {
  viewName: 'front' | 'top' | 'side' | '3d';
  label: string;
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
         smoothShading={viewerSmooth}
         exportMp4Trigger={exportMp4Trigger}
         onExportProgress={onExportProgress}
         onExportComplete={onExportComplete}
       />
       {viewName !== '3d' && (
         <div className="absolute bottom-2 left-2 flex items-center gap-2 pointer-events-none z-10">
           <div className="flex items-center gap-0.5 text-xs text-green-400 font-mono">
             <span>→</span>
             <span>{viewName === 'front' ? 'X' : viewName === 'side' ? 'Z' : 'X'}</span>
           </div>
           <div className="flex items-center gap-0.5 text-xs text-pink-400 font-mono">
             <span>↑</span>
             <span>{viewName === 'front' || viewName === 'side' ? 'Y' : 'Z'}</span>
           </div>
         </div>
       )}
     </div>
   </div>
  );
};
