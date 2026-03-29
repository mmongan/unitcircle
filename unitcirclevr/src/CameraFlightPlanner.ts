import * as BABYLON from '@babylonjs/core';

export interface CameraFlightPlanInput {
  targetWorldPos: BABYLON.Vector3;
  cameraPosition: BABYLON.Vector3;
  cameraTarget: BABYLON.Vector3;
  targetMesh?: BABYLON.AbstractMesh;
  labelStandoff?: number | false;
  faceNormal?: BABYLON.Vector3;
  activeFov?: number;
  fallbackFov: number;
  renderWidth: number;
  renderHeight: number;
  editorWorldWidthScale: number;
  editorWorldHeightScale: number;
}

/**
 * Compute the destination camera position for desktop fly-to interactions.
 * This is a pure planner so VRSceneManager can focus on orchestration.
 */
export function computeDesktopCameraDestination(input: CameraFlightPlanInput): BABYLON.Vector3 {
  const {
    targetWorldPos,
    cameraPosition,
    cameraTarget,
    targetMesh,
    labelStandoff = false,
    faceNormal,
    activeFov,
    fallbackFov,
    renderWidth,
    renderHeight,
    editorWorldWidthScale,
    editorWorldHeightScale,
  } = input;

  const currentDir = cameraTarget.subtract(cameraPosition).normalize();

  if (labelStandoff !== false) {
    // For labels: position camera a fixed distance in front of the label,
    // offset toward the camera so the text is readable.
    let toCamera = cameraPosition.subtract(targetWorldPos);
    if (!Number.isFinite(toCamera.length()) || toCamera.lengthSquared() < 0.000001) {
      toCamera = currentDir.scale(-1);
    }
    toCamera = toCamera.normalize();
    const labelRadius = targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
    const effectiveLabelStandoff = Math.max(
      labelStandoff as number,
      8,
      (labelRadius * 1.35) + 5,
    );
    return targetWorldPos.add(toCamera.scale(effectiveLabelStandoff));
  }

  if (faceNormal && faceNormal.lengthSquared() > 0.000001) {
    // Position camera orthogonally in front of the clicked face.
    const meshAny = targetMesh as any;
    const boxSize = typeof meshAny?.boxSize === 'number'
      ? meshAny.boxSize
      : Math.max(1.0, (targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);
    const panelOffset = (boxSize * 0.5) + Math.max(0.5, boxSize * 0.08);

    const fovY = Math.max(0.45, activeFov || fallbackFov || 0.8);
    const safeWidth = Math.max(1, renderWidth);
    const safeHeight = Math.max(1, renderHeight);
    const aspect = safeWidth / safeHeight;
    const fovX = 2 * Math.atan(Math.tan(fovY * 0.5) * aspect);

    // Editor plane is square in world units (scaled by box size).
    const panelWorldHeight = boxSize * editorWorldHeightScale;
    const panelWorldWidth = boxSize * editorWorldWidthScale;

    // Target fraction of viewport occupied by panel dimensions.
    const targetVerticalFill = 0.86;
    const targetHorizontalFill = 0.80;

    const distanceByHeight = (panelWorldHeight * 0.5) / Math.tan((fovY * targetVerticalFill) * 0.5);
    const distanceByWidth = (panelWorldWidth * 0.5) / Math.tan((fovX * targetHorizontalFill) * 0.5);
    const requiredPanelDistance = Math.max(distanceByHeight, distanceByWidth);

    // Keep a comfortable buffer from the panel surface.
    const desiredPanelGap = Math.max(4.0, requiredPanelDistance);

    const standoffDistance = panelOffset + desiredPanelGap;
    return targetWorldPos.add(faceNormal.normalize().scale(standoffDistance));
  }

  const radius = targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
  const standoffDistance = Math.max(2, radius + 1.5);
  return targetWorldPos.subtract(currentDir.scale(standoffDistance));
}
