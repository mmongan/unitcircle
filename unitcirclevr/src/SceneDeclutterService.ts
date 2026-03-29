import * as BABYLON from '@babylonjs/core';
import type { GraphNode } from './types';
import { SceneConfig } from './SceneConfig';
import { getDirectoryPath, getParentDirectoryPath, toProjectRelativePath } from './PathUtils';
import type { MeshFactory } from './MeshFactory';

interface DeclutterFileBoxWorkItem {
  relativeFile: string;
  fileDirectory: string;
  box: BABYLON.Mesh;
}

interface DeclutterDirectoryBoxWorkItem {
  relativeDirectory: string;
  box: BABYLON.Mesh;
}

interface DeclutterNodeWorkItem {
  node: GraphNode;
  mesh: BABYLON.Mesh;
  relativeFile: string | null;
  fileDirectory: string;
}

interface DeclutterLabelWorkItem {
  relativePath: string;
  label: BABYLON.Mesh;
}

interface PendingDeclutterState {
  viewerInsideFile: boolean;
  focusedFile: string | null;
  focusedFileDirectory: string;
  focusedDirectories: Set<string>;
  fileBoxes: DeclutterFileBoxWorkItem[];
  directoryBoxes: DeclutterDirectoryBoxWorkItem[];
  nodes: DeclutterNodeWorkItem[];
  fileLabels: DeclutterLabelWorkItem[];
  directoryLabels: DeclutterLabelWorkItem[];
  fileBoxIndex: number;
  directoryBoxIndex: number;
  nodeIndex: number;
  fileLabelIndex: number;
  directoryLabelIndex: number;
}

export interface SceneDeclutterInput {
  scene: BABYLON.Scene;
  camera: BABYLON.UniversalCamera;
  meshFactory: MeshFactory;
  currentFunctionId: string | null;
  editorVisibleForNodeId: string | null;
  graphNodeMap: Map<string, GraphNode>;
  fileBoxMeshes: Map<string, BABYLON.Mesh>;
  directoryBoxMeshes: Map<string, BABYLON.Mesh>;
  nodeMeshMap: Map<string, BABYLON.Mesh>;
  fileBoxLabels: Map<string, BABYLON.Mesh>;
  directoryBoxLabels: Map<string, BABYLON.Mesh>;
  labelsVisible: boolean;
  setBreadcrumbAnchorInteractivity: (labelAnchor: BABYLON.Mesh, enabled: boolean) => void;
}

export class SceneDeclutterService {
  private lastDeclutterSignature: string | null = null;
  private pendingDeclutterState: PendingDeclutterState | null = null;
  private lastIdleViewerPosition: BABYLON.Vector3 | null = null;
  private lastIdleViewerForward: BABYLON.Vector3 | null = null;
  private lastIdleSelectedNodeId: string | null = null;
  private lastIdleLabelsVisible: boolean | null = null;
  private lastIdleCheckAtMs = 0;

  public apply(input: SceneDeclutterInput): void {
    // If there is queued declutter work, keep draining that batch before
    // recomputing the full visibility signature again.
    if (this.pendingDeclutterState) {
      this.processDeclutterBatch(input);
      return;
    }

    if (this.canSkipIdleDeclutter(input)) {
      return;
    }

    const viewerInsideFile = this.isViewerInsideAnyFileBox(input);
    const focusedFile = viewerInsideFile ? this.getFocusedFilePath(input) : null;
    const focusedDirectories = this.buildFocusedDirectoryChain(focusedFile);
    const signature = `${viewerInsideFile ? 'inside' : 'outside'}|${focusedFile ?? 'none'}|${Array.from(focusedDirectories).sort().join(',')}|${input.labelsVisible ? 'labels' : 'nolabels'}`;

    input.meshFactory.setDeclutterContext(focusedFile, focusedDirectories);

    if (signature !== this.lastDeclutterSignature) {
      this.lastDeclutterSignature = signature;
      this.pendingDeclutterState = this.createPendingDeclutterState(
        input,
        viewerInsideFile,
        focusedFile,
        focusedDirectories,
      );
      this.processDeclutterBatch(input);
    }
  }

  private canSkipIdleDeclutter(input: SceneDeclutterInput): boolean {
    const activeCamera = input.scene.activeCamera || input.camera;
    const viewerPosition = this.getViewerWorldPosition(input);
    const viewerForward = activeCamera.getForwardRay().direction;
    const selectedNodeId = input.editorVisibleForNodeId || input.currentFunctionId || null;
    const now = performance.now();

    if (
      this.lastIdleViewerPosition
      && this.lastIdleViewerForward
      && this.lastIdleLabelsVisible !== null
      && this.lastIdleSelectedNodeId === selectedNodeId
      && this.lastIdleLabelsVisible === input.labelsVisible
      && BABYLON.Vector3.Distance(this.lastIdleViewerPosition, viewerPosition) < 0.08
      && BABYLON.Vector3.Dot(this.lastIdleViewerForward, viewerForward) > 0.9996
      && (now - this.lastIdleCheckAtMs) < 120
    ) {
      return true;
    }

    this.lastIdleViewerPosition = viewerPosition.clone();
    this.lastIdleViewerForward = viewerForward.clone();
    this.lastIdleSelectedNodeId = selectedNodeId;
    this.lastIdleLabelsVisible = input.labelsVisible;
    this.lastIdleCheckAtMs = now;
    return false;
  }

  private getViewerWorldPosition(input: SceneDeclutterInput): BABYLON.Vector3 {
    const activeCamera = input.scene.activeCamera || input.camera;
    const activeGlobal = (activeCamera as any)?.globalPosition as BABYLON.Vector3 | undefined;
    if (activeGlobal && Number.isFinite(activeGlobal.x) && Number.isFinite(activeGlobal.y) && Number.isFinite(activeGlobal.z)) {
      return activeGlobal.clone();
    }
    return activeCamera.position.clone();
  }

  private getFocusedFilePath(input: SceneDeclutterInput): string | null {
    const selectedNodeId = input.editorVisibleForNodeId || input.currentFunctionId;
    if (selectedNodeId) {
      const selectedNode = input.graphNodeMap.get(selectedNodeId);
      if (selectedNode?.file) {
        return toProjectRelativePath(selectedNode.file);
      }
    }

    return null;
  }

  private buildFocusedDirectoryChain(filePath: string | null): Set<string> {
    const chain = new Set<string>();
    if (!filePath) {
      return chain;
    }

    let current = getDirectoryPath(filePath);
    chain.add(current);
    while (current) {
      current = getParentDirectoryPath(current);
      chain.add(current);
    }

    return chain;
  }

  private isViewerInsideAnyFileBox(input: SceneDeclutterInput): boolean {
    const viewerWorldPos = this.getViewerWorldPosition(input);
    for (const fileBox of input.fileBoxMeshes.values()) {
      fileBox.computeWorldMatrix(true);
      const bounds = fileBox.getBoundingInfo().boundingBox;
      if (bounds.intersectsPoint(viewerWorldPos)) {
        return true;
      }
    }
    return false;
  }

  private createPendingDeclutterState(
    input: SceneDeclutterInput,
    viewerInsideFile: boolean,
    focusedFile: string | null,
    focusedDirectories: Set<string>,
  ): PendingDeclutterState {
    const fileBoxes: DeclutterFileBoxWorkItem[] = [];
    for (const [file, box] of input.fileBoxMeshes.entries()) {
      const relativeFile = toProjectRelativePath(file);
      fileBoxes.push({
        relativeFile,
        fileDirectory: getDirectoryPath(relativeFile),
        box,
      });
    }

    const directoryBoxes: DeclutterDirectoryBoxWorkItem[] = [];
    for (const [directory, box] of input.directoryBoxMeshes.entries()) {
      directoryBoxes.push({
        relativeDirectory: toProjectRelativePath(directory),
        box,
      });
    }

    const nodes: DeclutterNodeWorkItem[] = [];
    for (const [nodeId, mesh] of input.nodeMeshMap.entries()) {
      const node = input.graphNodeMap.get(nodeId);
      if (!node) {
        continue;
      }

      const relativeFile = node.file ? toProjectRelativePath(node.file) : null;
      nodes.push({
        node,
        mesh,
        relativeFile,
        fileDirectory: relativeFile ? getDirectoryPath(relativeFile) : '',
      });
    }

    const fileLabels: DeclutterLabelWorkItem[] = [];
    for (const [file, label] of input.fileBoxLabels.entries()) {
      fileLabels.push({
        relativePath: toProjectRelativePath(file),
        label,
      });
    }

    const directoryLabels: DeclutterLabelWorkItem[] = [];
    for (const [directory, label] of input.directoryBoxLabels.entries()) {
      directoryLabels.push({
        relativePath: toProjectRelativePath(directory),
        label,
      });
    }

    return {
      viewerInsideFile,
      focusedFile,
      focusedFileDirectory: focusedFile ? getDirectoryPath(focusedFile) : '',
      focusedDirectories,
      fileBoxes,
      directoryBoxes,
      nodes,
      fileLabels,
      directoryLabels,
      fileBoxIndex: 0,
      directoryBoxIndex: 0,
      nodeIndex: 0,
      fileLabelIndex: 0,
      directoryLabelIndex: 0,
    };
  }

  private processDeclutterBatch(input: SceneDeclutterInput): void {
    const state = this.pendingDeclutterState;
    if (!state) {
      return;
    }

    let remainingMutations = SceneConfig.DECLUTTER_MUTATIONS_PER_FRAME;

    while (remainingMutations > 0) {
      if (state.fileBoxIndex < state.fileBoxes.length) {
        const item = state.fileBoxes[state.fileBoxIndex++];
        const material = item.box.material as BABYLON.StandardMaterial | null;

        if (!state.viewerInsideFile) {
          item.box.setEnabled(true);
          item.box.visibility = 1.0;
          if (material) {
            material.alpha = 0.18;
          }
        } else {
          const isFocused = state.focusedFile !== null && item.relativeFile === state.focusedFile;
          const isContext = state.focusedFile !== null && state.focusedDirectories.has(item.fileDirectory);

          item.box.visibility = isFocused
            ? SceneConfig.DECLUTTER_FOCUS_VISIBILITY
            : isContext
              ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
              : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY;

          if (material) {
            material.alpha = isFocused
              ? SceneConfig.DECLUTTER_ACTIVE_FILE_BOX_ALPHA
              : isContext
                ? SceneConfig.DECLUTTER_CONTEXT_FILE_BOX_ALPHA
                : SceneConfig.DECLUTTER_BACKGROUND_FILE_BOX_ALPHA;
          }
        }

        remainingMutations -= 1;
        continue;
      }

      if (state.directoryBoxIndex < state.directoryBoxes.length) {
        const item = state.directoryBoxes[state.directoryBoxIndex++];
        const material = item.box.material as BABYLON.StandardMaterial | null;

        if (!state.viewerInsideFile) {
          item.box.setEnabled(true);
          item.box.visibility = 1.0;
          if (material) {
            material.alpha = 0.08;
          }
        } else {
          const showBox = state.focusedFile === null || state.focusedDirectories.has(item.relativeDirectory);
          item.box.setEnabled(showBox);
          item.box.visibility = showBox
            ? (state.focusedFile !== null && item.relativeDirectory === state.focusedFileDirectory
              ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
              : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY)
            : SceneConfig.DECLUTTER_HIDDEN_VISIBILITY;

          if (material) {
            material.alpha = state.focusedFile !== null && item.relativeDirectory === state.focusedFileDirectory
              ? SceneConfig.DECLUTTER_ACTIVE_DIRECTORY_BOX_ALPHA
              : SceneConfig.DECLUTTER_CONTEXT_DIRECTORY_BOX_ALPHA;
          }
        }

        remainingMutations -= 1;
        continue;
      }

      if (state.nodeIndex < state.nodes.length) {
        const item = state.nodes[state.nodeIndex++];
        const material = item.mesh.material as BABYLON.StandardMaterial | null;

        if (!state.viewerInsideFile) {
          item.mesh.setEnabled(true);
          item.mesh.isVisible = true;
          item.mesh.visibility = 1.0;
          if (material) {
            material.alpha = 1.0;
            material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
          }
        } else {
          const isFocusedNode = state.focusedFile !== null && item.relativeFile === state.focusedFile;
          const isContextNode = state.focusedFile !== null && state.focusedDirectories.has(item.fileDirectory);
          const isFunctionNode = item.node.type === 'function'
            || item.node.type === 'class'
            || item.node.type === 'interface'
            || item.node.type === 'type-alias'
            || item.node.type === 'enum'
            || item.node.type === 'namespace';
          const isExternalOrVariable = item.node.type === 'external' || item.node.type === 'variable';
          const shouldHide = state.focusedFile !== null && isExternalOrVariable && !isFocusedNode;

          item.mesh.setEnabled(!shouldHide);
          item.mesh.isVisible = !shouldHide;
          item.mesh.visibility = shouldHide
            ? SceneConfig.DECLUTTER_HIDDEN_VISIBILITY
            : isFunctionNode
              ? 1.0
              : isFocusedNode
                ? SceneConfig.DECLUTTER_FOCUS_VISIBILITY
                : isContextNode
                  ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
                  : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY;

          if (material) {
            material.alpha = shouldHide
              ? 0.0
              : isFunctionNode
                ? 1.0
                : isFocusedNode
                  ? 1.0
                  : isContextNode
                    ? 0.88
                    : 0.42;
            material.transparencyMode = material.alpha >= 0.999
              ? BABYLON.Material.MATERIAL_OPAQUE
              : BABYLON.Material.MATERIAL_ALPHABLEND;
          }
        }

        remainingMutations -= 1;
        continue;
      }

      if (state.fileLabelIndex < state.fileLabels.length) {
        const item = state.fileLabels[state.fileLabelIndex++];
        const shouldShow = !state.viewerInsideFile
          ? input.labelsVisible
          : input.labelsVisible
            && (state.focusedFile === null
              || item.relativePath === state.focusedFile
              || state.focusedDirectories.has(getDirectoryPath(item.relativePath)));
        input.setBreadcrumbAnchorInteractivity(item.label, shouldShow);
        item.label.visibility = shouldShow ? 1 : 0;

        remainingMutations -= 1;
        continue;
      }

      if (state.directoryLabelIndex < state.directoryLabels.length) {
        const item = state.directoryLabels[state.directoryLabelIndex++];
        const shouldShow = !state.viewerInsideFile
          ? input.labelsVisible
          : input.labelsVisible && (state.focusedFile === null || state.focusedDirectories.has(item.relativePath));
        input.setBreadcrumbAnchorInteractivity(item.label, shouldShow);
        item.label.visibility = shouldShow ? 1 : 0;

        remainingMutations -= 1;
        continue;
      }

      break;
    }

    const isDone = state.fileBoxIndex >= state.fileBoxes.length
      && state.directoryBoxIndex >= state.directoryBoxes.length
      && state.nodeIndex >= state.nodes.length
      && state.fileLabelIndex >= state.fileLabels.length
      && state.directoryLabelIndex >= state.directoryLabels.length;

    if (isDone) {
      this.pendingDeclutterState = null;
    }
  }
}
