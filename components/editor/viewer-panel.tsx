'use client';

import type { FC } from 'react';
import Viewer3D from '@/components/viewer-3d';
import { PanelButtons } from '@/components/editor/Editor3D';
import type { AnimationTrack, Keyframe } from '@/lib/animation';

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
   showGizmo: boolean;
   handleObjectTransform: (transform: any) => void;
   handleVerticesChange: (vertices: any) => void;
   showLatheAxis: boolean;
   viewerProjection: any;
   textureHelper: any;
   textureHelperTransform: any;
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
  onCameraMove?: (cam: any) => void;
   showCameraPathGizmo?: boolean;
   showCameraPath?: boolean;
    cameraViewMode?: boolean;
    onCameraGizmoMove?: (keyframes: Keyframe[]) => void;
    selectedKeyframeIndex?: number;
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
  showGizmo,
  handleObjectTransform,
  handleVerticesChange,
  showLatheAxis,
  viewerProjection,
  textureHelper,
  textureHelperTransform,
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
   onCameraMove,
   showCameraPathGizmo,
    showCameraPath,
    cameraViewMode,
    onCameraGizmoMove,
    selectedKeyframeIndex,
    exportMp4Trigger,
    onExportProgress,
    onExportComplete,
}) => (
  <div
    onClick={onActiveView}
    className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-colors ${
      activeView === viewName
        ? 'border-green-500'
        : 'border-white/10'
    }`}
  >
    <div className="flex items-center justify-between px-2 py-1 bg-black/60 backdrop-blur-sm shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-green-300">
        {label}
      </span>
      <PanelButtons
        onPan={(dx: number, dy: number) => pan3D(viewName, dx * 0.02, dy * 0.02)}
        onZoom={(f: number) => zoom3D(viewName, f)}
        onRotateLeft={() => orbit3D(viewName, 'left', -15)}
        onRotateRight={() => orbit3D(viewName, 'left', 15)}
        onEdit={() => onSetEditing(!editingState)}
        showRotate
        isEditing={editingState}
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
         onCameraMove={onCameraMove}
        showCameraPathGizmo={showCameraPathGizmo}
        showCameraPath={showCameraPath}
        cameraViewMode={cameraViewMode}
        onCameraGizmoMove={onCameraGizmoMove}
        selectedKeyframeIndex={selectedKeyframeIndex}
        animationTracks={animationTracks}
        animationTime={animationTime}
        onAnimationComplete={onAnimationComplete}
        smoothShading={viewerSmooth}
        exportMp4Trigger={exportMp4Trigger}
        onExportProgress={onExportProgress}
        onExportComplete={onExportComplete}
      />
    </div>
  </div>
);
