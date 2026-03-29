import * as BABYLON from '@babylonjs/core';
import type { SceneState } from './SceneState';
import { toProjectRelativePath } from './PathUtils';

export class LabelManager {
  private scene: BABYLON.Scene;
  private sceneRoot: BABYLON.TransformNode;
  private engine: BABYLON.Engine;
  private state: SceneState;
  private isInXR: () => boolean;
  private getCameraFov: () => number;
  private lastScaleCameraPosition: BABYLON.Vector3 | null = null;
  private lastScaleCameraForward: BABYLON.Vector3 | null = null;
  private lastScaleRenderWidth = 0;
  private lastScaleRenderHeight = 0;
  private lastScaleFov = 0;
  private lastScaleUpdateAtMs = 0;

  constructor(
    scene: BABYLON.Scene,
    sceneRoot: BABYLON.TransformNode,
    engine: BABYLON.Engine,
    state: SceneState,
    isInXR: () => boolean,
    getCameraFov: () => number,
  ) {
    this.scene = scene;
    this.sceneRoot = sceneRoot;
    this.engine = engine;
    this.state = state;
    this.isInXR = isInXR;
    this.getCameraFov = getCameraFov;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  createFileBoxLabel(file: string, fileBox: BABYLON.Mesh): void {
    const fileMat = fileBox.material as BABYLON.StandardMaterial | null;
    const fileTint = fileMat?.diffuseColor ?? new BABYLON.Color3(0.2, 0.2, 0.2);
    const fileR = Math.max(0, Math.min(255, Math.floor(fileTint.r * 255)));
    const fileG = Math.max(0, Math.min(255, Math.floor(fileTint.g * 255)));
    const fileB = Math.max(0, Math.min(255, Math.floor(fileTint.b * 255)));

    const displayPath = toProjectRelativePath(file);
    const label = this.createBreadcrumbLabelAnchor(
      `filelabel_${file}`,
      this.buildBreadcrumbSegments('file', displayPath),
      `rgba(${fileR}, ${fileG}, ${fileB}, 0.84)`,
      'rgba(255, 255, 255, 0.92)',
      '#ffffff',
    );

    this.updateFileBoxLabelTransform(label, fileBox);
    this.state.fileBoxLabels.set(file, label);
    this.state.fileLabelLookup.set(displayPath, label);
  }

  updateFileBoxLabelTransform(label: BABYLON.Mesh, fileBox: BABYLON.Mesh): void {
    fileBox.computeWorldMatrix(true);
    const bounds = fileBox.getBoundingInfo().boundingBox;
    const worldPos = new BABYLON.Vector3(
      bounds.centerWorld.x,
      bounds.maximumWorld.y + 8.1,
      bounds.centerWorld.z,
    );
    this.sceneRoot.computeWorldMatrix(true);
    label.position = BABYLON.Vector3.TransformCoordinates(
      worldPos,
      BABYLON.Matrix.Invert(this.sceneRoot.getWorldMatrix()),
    );
  }

  createDirectoryBoxLabel(directoryPath: string, directoryBox: BABYLON.Mesh): void {
    const dirMat = directoryBox.material as BABYLON.StandardMaterial | null;
    const dirTint = dirMat?.diffuseColor ?? new BABYLON.Color3(0.10, 0.14, 0.18);
    const dirR = Math.max(0, Math.min(255, Math.floor(dirTint.r * 255)));
    const dirG = Math.max(0, Math.min(255, Math.floor(dirTint.g * 255)));
    const dirB = Math.max(0, Math.min(255, Math.floor(dirTint.b * 255)));

    const displayPath = toProjectRelativePath(directoryPath) || 'root';
    const label = this.createBreadcrumbLabelAnchor(
      `dirlabel_${directoryPath}`,
      this.buildBreadcrumbSegments('directory', displayPath),
      `rgba(${dirR}, ${dirG}, ${dirB}, 0.88)`,
      'rgba(128, 188, 255, 0.95)',
      '#f4fbff',
    );

    this.updateDirectoryBoxLabelTransform(label, directoryBox);
    this.state.directoryBoxLabels.set(directoryPath, label);
    this.state.directoryLabelLookup.set(displayPath, label);
  }

  updateDirectoryBoxLabelTransform(label: BABYLON.Mesh, directoryBox: BABYLON.Mesh): void {
    directoryBox.computeWorldMatrix(true);
    const bounds = directoryBox.getBoundingInfo().boundingBox;
    const worldPos = new BABYLON.Vector3(
      bounds.centerWorld.x,
      bounds.maximumWorld.y + 9.2,
      bounds.centerWorld.z,
    );
    this.sceneRoot.computeWorldMatrix(true);
    label.position = BABYLON.Vector3.TransformCoordinates(
      worldPos,
      BABYLON.Matrix.Invert(this.sceneRoot.getWorldMatrix()),
    );
  }

  refreshLabelTransformsIfScaleChanged(_force: boolean = false): void {
    for (const [file, label] of this.state.fileBoxLabels.entries()) {
      const fileBox = this.state.fileBoxMeshes.get(file);
      if (fileBox) this.updateFileBoxLabelTransform(label, fileBox);
    }
    for (const [dir, label] of this.state.directoryBoxLabels.entries()) {
      const dirBox = this.state.directoryBoxMeshes.get(dir);
      if (dirBox) this.updateDirectoryBoxLabelTransform(label, dirBox);
    }
  }

  updateLabelDistanceScaling(): void {
    if (!this.state.labelsVisible) return;
    if (this.state.fileBoxLabels.size === 0 && this.state.directoryBoxLabels.size === 0) return;

    const activeCamera = this.scene.activeCamera;
    if (!activeCamera) return;

    const activeGlobal = (activeCamera as any).globalPosition as BABYLON.Vector3 | undefined;
    const cameraWorldPos = (activeGlobal && Number.isFinite(activeGlobal.x))
      ? activeGlobal
      : activeCamera.position;

    const renderWidth = Math.max(1, this.engine.getRenderWidth());
    const renderHeight = Math.max(1, this.engine.getRenderHeight());
    const aspect = renderWidth / renderHeight;
    const verticalFov = Math.max(0.25, this.getCameraFov());
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * aspect);
    const cameraForward = activeCamera.getForwardRay().direction;
    const now = performance.now();

    if (this.lastScaleCameraPosition && this.lastScaleCameraForward) {
      const positionDelta = BABYLON.Vector3.Distance(this.lastScaleCameraPosition, cameraWorldPos);
      const rotationDot = BABYLON.Vector3.Dot(this.lastScaleCameraForward, cameraForward);
      const renderSizeUnchanged = this.lastScaleRenderWidth === renderWidth
        && this.lastScaleRenderHeight === renderHeight;
      const fovUnchanged = Math.abs(this.lastScaleFov - verticalFov) < 0.0001;
      const elapsed = now - this.lastScaleUpdateAtMs;
      if (
        positionDelta < 0.05
        && rotationDot > 0.9995
        && renderSizeUnchanged
        && fovUnchanged
        && elapsed < 150
      ) {
        return;
      }
    }

    const fallbackBaseLabelWidth = 36.0;
    const readableMinScale = this.isInXR() ? 1.25 : 1.05;
    const hardMinScale = 0.35;
    const nearDistanceThreshold = this.isInXR() ? 45 : 90;
    const minViewportFraction = this.isInXR() ? 0.27 : 0.20;
    const maxViewportFraction = this.isInXR() ? 0.16 : 0.13;
    const maxScale = this.isInXR() ? 2.1 : 1.8;

    const applyScale = (label: BABYLON.Mesh): void => {
      const hierarchyBounds = label.getHierarchyBoundingVectors(true);
      const hierarchyWidth = Math.abs(hierarchyBounds.max.x - hierarchyBounds.min.x);
      const currentScale = Math.max(0.0001, label.scaling.x);
      const baseLabelWidth = Number.isFinite(hierarchyWidth) && hierarchyWidth > 0.001
        ? hierarchyWidth / currentScale
        : fallbackBaseLabelWidth;

      const distance = BABYLON.Vector3.Distance(cameraWorldPos, label.getAbsolutePosition());
      const minAngularWidth = horizontalFov * minViewportFraction;
      const maxAngularWidth = horizontalFov * maxViewportFraction;
      const minWorldWidthAtDistance = 2 * Math.max(0.01, distance) * Math.tan(minAngularWidth * 0.5);
      const maxWorldWidthAtDistance = 2 * Math.max(0.01, distance) * Math.tan(maxAngularWidth * 0.5);
      const floorScale = minWorldWidthAtDistance / baseLabelWidth;
      const viewportCapScale = maxWorldWidthAtDistance / baseLabelWidth;
      const effectiveMinScale = distance < nearDistanceThreshold ? hardMinScale : readableMinScale;

      const desiredScale = Math.max(effectiveMinScale, floorScale);
      const scale = Math.max(hardMinScale, Math.min(maxScale, viewportCapScale, desiredScale));
      if (Math.abs(label.scaling.x - scale) > 0.001) {
        label.scaling.copyFromFloats(scale, scale, scale);
      }
    };

    this.state.labelScaleState.clear();
    for (const label of this.state.fileBoxLabels.values()) applyScale(label);
    for (const label of this.state.directoryBoxLabels.values()) applyScale(label);

    this.lastScaleCameraPosition = cameraWorldPos.clone();
    this.lastScaleCameraForward = cameraForward.clone();
    this.lastScaleRenderWidth = renderWidth;
    this.lastScaleRenderHeight = renderHeight;
    this.lastScaleFov = verticalFov;
    this.lastScaleUpdateAtMs = now;
  }

  setBreadcrumbAnchorInteractivity(labelAnchor: BABYLON.Mesh, enabled: boolean): void {
    labelAnchor.setEnabled(enabled);
    labelAnchor.isPickable = false;
    for (const child of labelAnchor.getChildMeshes(false)) {
      child.isPickable = enabled;
    }
  }

  setLabelsVisibility(visible: boolean): void {
    this.state.labelsVisible = visible;
    if (!this.state.labelsVisible) {
      this.clearBreadcrumbHoverState();
    }
    for (const label of this.state.fileBoxLabels.values()) {
      this.setBreadcrumbAnchorInteractivity(label, this.state.labelsVisible);
    }
    for (const label of this.state.directoryBoxLabels.values()) {
      this.setBreadcrumbAnchorInteractivity(label, this.state.labelsVisible);
    }
  }

  toggleLabelsVisibility(): void {
    this.setLabelsVisibility(!this.state.labelsVisible);
  }

  clearBreadcrumbHoverState(): void {
    if (this.state.hoveredBreadcrumbChip) {
      const mat = (this.state.hoveredBreadcrumbChip as BABYLON.Mesh).material as BABYLON.StandardMaterial | null;
      if (mat) mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      this.state.hoveredBreadcrumbChip.renderOutline = false;
      this.state.hoveredBreadcrumbChip = null;
    }
  }

  isBreadcrumbChipMesh(mesh: BABYLON.AbstractMesh): boolean {
    return (mesh as any).labelData !== undefined;
  }

  findExactNavigationLabelTarget(kind: 'file' | 'directory', path: string): BABYLON.Mesh | null {
    const normalized = toProjectRelativePath(path) || path;
    if (!normalized) {
      return kind === 'directory' ? (this.state.directoryLabelLookup.get('root') ?? null) : null;
    }

    if (kind === 'file') {
      const hit = this.state.fileLabelLookup.get(normalized);
      if (hit) return hit;
      for (const [filePath, label] of this.state.fileBoxLabels.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) return label;
      }
      return null;
    }

    const dirHit = this.state.directoryLabelLookup.get(normalized);
    if (dirHit) return dirHit;
    for (const [dirPath, label] of this.state.directoryBoxLabels.entries()) {
      if ((toProjectRelativePath(dirPath) || dirPath) === normalized) return label;
    }
    return null;
  }

  findNavigationLabelTarget(kind: 'file' | 'directory', path: string): BABYLON.Mesh | null {
    const normalized = toProjectRelativePath(path) || path;
    if (kind === 'file') {
      const hit = this.state.fileLabelLookup.get(normalized);
      if (hit) return hit;
      for (const [filePath, label] of this.state.fileBoxLabels.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) return label;
      }
      for (const [filePath, mesh] of this.state.fileBoxMeshes.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) return mesh;
      }
    }

    let currentPath = normalized;
    while (currentPath) {
      const dirHit = this.state.directoryLabelLookup.get(currentPath);
      if (dirHit) return dirHit;
      for (const [dirPath, label] of this.state.directoryBoxLabels.entries()) {
        if ((toProjectRelativePath(dirPath) || dirPath) === currentPath) return label;
      }
      for (const [dirPath, mesh] of this.state.directoryBoxMeshes.entries()) {
        if ((toProjectRelativePath(dirPath) || dirPath) === currentPath) return mesh;
      }
      const slashIndex = currentPath.lastIndexOf('/');
      currentPath = slashIndex >= 0 ? currentPath.slice(0, slashIndex) : '';
    }
    return null;
  }

  resolveBreadcrumbNavigationTarget(
    kind: 'file' | 'directory',
    path: string,
    fallbackMesh: BABYLON.AbstractMesh,
  ): BABYLON.AbstractMesh {
    const exactLabelTarget = this.findExactNavigationLabelTarget(kind, path);
    if (exactLabelTarget) return exactLabelTarget;

    const normalized = toProjectRelativePath(path) || path;
    if (kind === 'file') {
      for (const [filePath, mesh] of this.state.fileBoxMeshes.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) return mesh;
      }
    } else {
      for (const [dirPath, mesh] of this.state.directoryBoxMeshes.entries()) {
        if ((toProjectRelativePath(dirPath) || dirPath) === normalized) return mesh;
      }
    }

    return this.findNavigationLabelTarget(kind, path) ?? fallbackMesh;
  }

  buildBreadcrumbSegments(
    kind: 'file' | 'directory',
    fullPath: string,
  ): Array<{ text: string; kind: 'file' | 'directory'; path: string }> {
    const normalized = (fullPath || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const segments: Array<{ text: string; kind: 'file' | 'directory'; path: string }> = [];

    let runningPath = '';
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      runningPath = runningPath ? `${runningPath}/${part}` : part;
      const isLast = index === parts.length - 1;
      segments.push({
        text: part,
        kind: kind === 'file' && isLast ? 'file' : 'directory',
        path: runningPath,
      });
    }

    if (segments.length === 0) {
      segments.push({ text: kind === 'directory' ? 'root' : fullPath, kind, path: fullPath });
    }

    return segments;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private createLabelChip(
    name: string,
    text: string,
    fillStyle: string,
    strokeStyle: string,
    textStyle: string,
  ): { mesh: BABYLON.Mesh; width: number; height: number } {
    const fontSize = 440;
    const horizontalPadding = 220;
    const textureHeight = 720;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d') as CanvasRenderingContext2D;
    measureCtx.font = `bold ${fontSize}px monospace`;
    const textWidth = measureCtx.measureText(text).width;
    const textureWidth = Math.max(980, Math.ceil(textWidth + horizontalPadding * 2));

    const texture = new BABYLON.DynamicTexture(
      `${name}_texture`,
      { width: textureWidth, height: textureHeight },
      this.scene,
      false,
    );
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, textureWidth, textureHeight);
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, textureWidth, textureHeight);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, textureWidth - 16, textureHeight - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textStyle;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillText(text, textureWidth / 2, textureHeight / 2 + 2);
    texture.update();

    const worldHeight = 9.6;
    const worldWidth = Math.max(17.0, worldHeight * (textureWidth / textureHeight));
    const mesh = BABYLON.MeshBuilder.CreatePlane(
      name,
      { width: worldWidth, height: worldHeight },
      this.scene,
    );
    const material = new BABYLON.StandardMaterial(`${name}_material`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.depthFunction = BABYLON.Constants.ALWAYS;
    mesh.material = material;
    mesh.renderingGroupId = 3;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.outlineColor = new BABYLON.Color3(0.95, 0.98, 1.0);
    mesh.outlineWidth = 0.16;

    const baseScaling = mesh.scaling.clone();
    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        mesh.renderOutline = true;
        material.emissiveColor = new BABYLON.Color3(1.2, 1.2, 1.2);
        mesh.scaling = baseScaling.scale(1.08);
      }),
    );
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        mesh.renderOutline = false;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mesh.scaling = baseScaling.clone();
      }),
    );

    return { mesh, width: worldWidth, height: worldHeight };
  }

  private withAdjustedAlpha(style: string, alpha: number): string {
    const rgbaMatch = style.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i);
    if (!rgbaMatch) return style;
    const [, r, g, b] = rgbaMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private createBreadcrumbLabelAnchor(
    name: string,
    segments: Array<{ text: string; kind: 'file' | 'directory'; path: string }>,
    fillStyle: string,
    strokeStyle: string,
    textStyle: string,
  ): BABYLON.Mesh {
    const anchor = BABYLON.MeshBuilder.CreatePlane(
      `${name}_anchor`,
      { width: 1, height: 1 },
      this.scene,
    );
    anchor.visibility = 0;
    anchor.isPickable = false;
    anchor.parent = this.sceneRoot;
    anchor.scaling = new BABYLON.Vector3(1, 1, 1);
    anchor.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    anchor.renderingGroupId = 3;
    anchor.alwaysSelectAsActiveMesh = true;
    anchor.setEnabled(this.state.labelsVisible);

    const horizontalGap = 1.4;
    const verticalGap = 1.15;
    const maxRowWidth = 52;
    const rowHeight = 4.8;
    const rows: Array<Array<{ mesh: BABYLON.Mesh; width: number }>> = [];
    let currentRow: Array<{ mesh: BABYLON.Mesh; width: number }> = [];
    let currentRowWidth = 0;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const isCurrentSegment = index === segments.length - 1;
      const chipFill = this.withAdjustedAlpha(fillStyle, isCurrentSegment ? 0.96 : 0.56);
      const chipStroke = this.withAdjustedAlpha(strokeStyle, isCurrentSegment ? 1.0 : 0.72);
      const chipText = isCurrentSegment ? textStyle : 'rgba(232, 238, 244, 0.82)';
      const chip = this.createLabelChip(`${name}_chip_${index}`, segment.text, chipFill, chipStroke, chipText);
      chip.mesh.parent = anchor;
      chip.mesh.isPickable = this.state.labelsVisible;
      (chip.mesh as any).labelData = { kind: segment.kind, path: segment.path };

      const widthWithGap = currentRow.length === 0 ? chip.width : chip.width + horizontalGap;
      if (currentRow.length > 0 && currentRowWidth + widthWithGap > maxRowWidth) {
        rows.push(currentRow);
        currentRow = [];
        currentRowWidth = 0;
      }

      currentRow.push({ mesh: chip.mesh, width: chip.width });
      currentRowWidth += currentRow.length === 1 ? chip.width : chip.width + horizontalGap;
    }

    if (currentRow.length > 0) rows.push(currentRow);

    const totalHeight = rows.length * rowHeight + Math.max(0, rows.length - 1) * verticalGap;
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.reduce((sum, c, i) => sum + c.width + (i > 0 ? horizontalGap : 0), 0);
      let cursorX = -rowWidth * 0.5;
      const y = totalHeight * 0.5 - rowIndex * (rowHeight + verticalGap) - rowHeight * 0.5;
      row.forEach((chip) => {
        chip.mesh.position.x = cursorX + chip.width * 0.5;
        chip.mesh.position.y = y;
        chip.mesh.position.z = 0;
        cursorX += chip.width + horizontalGap;
      });
    });

    return anchor;
  }
}
