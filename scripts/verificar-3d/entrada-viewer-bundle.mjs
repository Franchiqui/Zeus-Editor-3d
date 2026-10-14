// Punto de entrada del bundle del visor para los checks headless
// (paso35-transplante-check.mjs, uv-grupo-check.mjs, …).
export {
  DEFAULT_FX_CONFIG,
  IDENTITY_TRANSFORM,
  buildCameraObjectVisual,
  buildSnapshotObjectVisual,
  computeFaceCentroids,
  deriveMeshEdges,
  getEdgeGroup,
  getFaceGroup,
  getVertexGroup,
  isIdentityTransform,
  orientCameraBodyVisual,
  paramsSueloLocal,
  projectToScreen,
  resolveSpotTarget,
} from '@/components/viewer-3d';
export { meshToTriangles } from '@/lib/geometry';