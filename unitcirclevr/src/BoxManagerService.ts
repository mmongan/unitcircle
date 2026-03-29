import * as BABYLON from '@babylonjs/core';
import type { GraphNode } from './types';
import { SceneConfig } from './SceneConfig';
import { getDirectoryPath, getParentDirectoryPath, normalizePath, toProjectRelativePath } from './PathUtils';

export class BoxManagerService {
  private scene: BABYLON.Scene;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  public renderFileBoxes(params: {
    fileNodeIds: Map<string, Set<string>>;
    fileBoxMeshes: Map<string, BABYLON.Mesh>;
    sceneRoot: BABYLON.TransformNode;
    getFileColor: (fileName: string) => BABYLON.Color3;
    onCreateFileBoxLabel: (file: string, fileBox: BABYLON.Mesh) => void;
  }): void {
    const { fileNodeIds, fileBoxMeshes, sceneRoot, getFileColor, onCreateFileBoxLabel } = params;

    for (const file of fileNodeIds.keys()) {
      if (file === 'external') {
        continue;
      }

      if (fileNodeIds.get(file)?.size === 0) {
        continue;
      }

      const boxSize = 20.0;
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `filebox_${file}`,
        { size: 1 },
        this.scene,
      );

      boxMesh.scaling = new BABYLON.Vector3(boxSize, boxSize, boxSize);

      const fileColor = getFileColor(file);
      const material = new BABYLON.StandardMaterial(`fileboxmat_${file}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(
        fileColor.r * 0.85,
        fileColor.g * 0.85,
        fileColor.b * 0.85,
      );
      material.emissiveColor = new BABYLON.Color3(
        fileColor.r * 0.42,
        fileColor.g * 0.42,
        fileColor.b * 0.42,
      );
      material.specularColor = new BABYLON.Color3(1, 1, 1);
      material.specularPower = 128;
      material.backFaceCulling = true;
      material.alpha = 0.18;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.needDepthPrePass = true;
      material.disableDepthWrite = true;
      material.indexOfRefraction = 1.5;
      material.wireframe = false;

      boxMesh.material = material;
      boxMesh.enableEdgesRendering();
      boxMesh.edgesColor = new BABYLON.Color4(
        Math.min(1, fileColor.r * 0.82 + 0.28),
        Math.min(1, fileColor.g * 0.82 + 0.28),
        Math.min(1, fileColor.b * 0.82 + 0.28),
        1.0,
      );
      boxMesh.edgesWidth = SceneConfig.FILE_BOX_EDGE_WIDTH;
      boxMesh.parent = sceneRoot;
      boxMesh.position = BABYLON.Vector3.Zero();

      fileBoxMeshes.set(file, boxMesh);

      const originalEmissive = material.emissiveColor.clone();
      boxMesh.actionManager = new BABYLON.ActionManager(this.scene);
      boxMesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
          material.emissiveColor = new BABYLON.Color3(
            fileColor.r * 0.68,
            fileColor.g * 0.68,
            fileColor.b * 0.68,
          );
        }),
      );
      boxMesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
          material.emissiveColor = originalEmissive.clone();
        }),
      );

      onCreateFileBoxLabel(file, boxMesh);
    }
  }

  public renderDirectoryBoxes(params: {
    fileBoxMeshes: Map<string, BABYLON.Mesh>;
    directoryBoxMeshes: Map<string, BABYLON.Mesh>;
    directoryBoxLabels: Map<string, BABYLON.Mesh>;
    directoryLabelLookup: Map<string, BABYLON.Mesh>;
    sceneRoot: BABYLON.TransformNode;
    getFileColor: (fileName: string) => BABYLON.Color3;
    onCreateDirectoryBoxLabel: (directoryPath: string, directoryBox: BABYLON.Mesh) => void;
  }): void {
    const {
      fileBoxMeshes,
      directoryBoxMeshes,
      directoryBoxLabels,
      directoryLabelLookup,
      sceneRoot,
      getFileColor,
      onCreateDirectoryBoxLabel,
    } = params;

    for (const mesh of directoryBoxMeshes.values()) {
      mesh.dispose();
    }
    directoryBoxMeshes.clear();

    for (const label of directoryBoxLabels.values()) {
      label.dispose();
    }
    directoryBoxLabels.clear();
    directoryLabelLookup.clear();

    if (!SceneConfig.SHOW_DIRECTORY_CAGE) {
      return;
    }

    const filePaths = Array.from(fileBoxMeshes.keys())
      .filter((f) => f !== 'external')
      .map((f) => toProjectRelativePath(f));

    const directories = new Set<string>();
    for (const filePath of filePaths) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        directories.add(parts.slice(0, i).join('/'));
      }
    }

    if (directories.size === 0) {
      return;
    }

    for (const dir of directories) {
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `dirbox_${dir}`,
        { size: 1 },
        this.scene,
      );

      const dirColor = getFileColor(dir);
      const material = new BABYLON.StandardMaterial(`dirboxmat_${dir}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(dirColor.r * 0.5, dirColor.g * 0.5, dirColor.b * 0.5);
      material.emissiveColor = new BABYLON.Color3(dirColor.r * 0.2, dirColor.g * 0.2, dirColor.b * 0.2);
      material.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
      material.specularPower = 64;
      material.backFaceCulling = true;
      material.alpha = 0.08;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.needDepthPrePass = true;

      boxMesh.material = material;
      boxMesh.enableEdgesRendering();
      boxMesh.edgesColor = new BABYLON.Color4(
        Math.min(1, dirColor.r * 0.75 + 0.2),
        Math.min(1, dirColor.g * 0.75 + 0.2),
        Math.min(1, dirColor.b * 0.75 + 0.2),
        1.0,
      );
      boxMesh.edgesWidth = Math.max(2, SceneConfig.FILE_BOX_EDGE_WIDTH - 1);
      boxMesh.parent = sceneRoot;
      boxMesh.isPickable = true;
      boxMesh.scaling = new BABYLON.Vector3(1, 1, 1);
      boxMesh.position = BABYLON.Vector3.Zero();

      directoryBoxMeshes.set(dir, boxMesh);
    }

    const sortedDirs = Array.from(directories).sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      return depthB - depthA;
    });

    const directoryPadding = 10.0;
    for (const dir of sortedDirs) {
      const dirMesh = directoryBoxMeshes.get(dir);
      if (!dirMesh) {
        continue;
      }

      const childMeshes: BABYLON.Mesh[] = [];

      for (const [filePath, fileMesh] of fileBoxMeshes.entries()) {
        if (filePath === 'external') {
          continue;
        }
        const fileDir = getDirectoryPath(filePath);
        if (normalizePath(fileDir) === dir) {
          childMeshes.push(fileMesh);
        }
      }

      for (const [childDir, childMesh] of directoryBoxMeshes.entries()) {
        if (childDir === dir) {
          continue;
        }
        if (getParentDirectoryPath(childDir) === dir) {
          childMeshes.push(childMesh);
        }
      }

      if (childMeshes.length === 0) {
        continue;
      }

      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;

      for (const child of childMeshes) {
        child.computeWorldMatrix(true);
        const bounds = child.getBoundingInfo().boundingBox;
        minX = Math.min(minX, bounds.minimumWorld.x);
        minY = Math.min(minY, bounds.minimumWorld.y);
        minZ = Math.min(minZ, bounds.minimumWorld.z);
        maxX = Math.max(maxX, bounds.maximumWorld.x);
        maxY = Math.max(maxY, bounds.maximumWorld.y);
        maxZ = Math.max(maxZ, bounds.maximumWorld.z);
      }

      minX -= directoryPadding;
      minY -= directoryPadding;
      minZ -= directoryPadding;
      maxX += directoryPadding;
      maxY += directoryPadding;
      maxZ += directoryPadding;

      dirMesh.scaling = new BABYLON.Vector3(
        Math.max(1, maxX - minX),
        Math.max(1, maxY - minY),
        Math.max(1, maxZ - minZ),
      );
      dirMesh.position = new BABYLON.Vector3(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5,
      );

      onCreateDirectoryBoxLabel(dir, dirMesh);
    }
  }

  public autosizeFileBoxes(params: {
    fileBoxMeshes: Map<string, BABYLON.Mesh>;
    updateFileBoxLabelTransform: (label: BABYLON.Mesh, fileBox: BABYLON.Mesh) => void;
    applyChildScaleCompensation: (child: BABYLON.Mesh, fileBox: BABYLON.Mesh) => void;
  }): void {
    const { fileBoxMeshes, updateFileBoxLabelTransform, applyChildScaleCompensation } = params;

    const nodeWorldSize = Math.max(3.0, SceneConfig.FUNCTION_BOX_SIZE);

    for (const fileBox of fileBoxMeshes.values()) {
      const children = fileBox.getChildren().filter(
        (c) => !c.name?.startsWith('filelabel_') && (c as BABYLON.Mesh).getBoundingInfo,
      ) as BABYLON.Mesh[];

      if (children.length === 0) {
        const minSize = nodeWorldSize * 8;
        fileBox.scaling = new BABYLON.Vector3(minSize, minSize, minSize);
        continue;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      for (const child of children) {
        minX = Math.min(minX, child.position.x);
        maxX = Math.max(maxX, child.position.x);
        minY = Math.min(minY, child.position.y);
        maxY = Math.max(maxY, child.position.y);
        minZ = Math.min(minZ, child.position.z);
        maxZ = Math.max(maxZ, child.position.z);
      }

      if (!Number.isFinite(minX)) {
        continue;
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      for (const child of children) {
        child.position.x -= cx;
        child.position.y -= cy;
        child.position.z -= cz;
      }

      const currentScaleX = fileBox.scaling.x;
      const currentScaleY = fileBox.scaling.y;
      const currentScaleZ = fileBox.scaling.z;
      let maxLocalExtentX = 0;
      let maxLocalExtentY = 0;
      let maxLocalExtentZ = 0;
      for (const child of children) {
        maxLocalExtentX = Math.max(maxLocalExtentX, Math.abs(child.position.x));
        maxLocalExtentY = Math.max(maxLocalExtentY, Math.abs(child.position.y));
        maxLocalExtentZ = Math.max(maxLocalExtentZ, Math.abs(child.position.z));
      }

      const functionCount = children.filter((child) => {
        const node = (child as any).nodeData as GraphNode | undefined;
        return node?.type === 'function'
          || node?.type === 'class'
          || node?.type === 'interface'
          || node?.type === 'type-alias'
          || node?.type === 'enum'
          || node?.type === 'namespace';
      }).length;
      const densityBoost = functionCount > 1
        ? Math.min(2.0, 1.0 + (Math.log2(functionCount) * 0.20))
        : 1.0;

      const axisPadding = nodeWorldSize * 8 * densityBoost;
      const minAxisSize = nodeWorldSize * 8 * densityBoost;
      const desiredScaleX = Math.max(minAxisSize, (maxLocalExtentX * currentScaleX + axisPadding) * 2);
      const desiredScaleY = Math.max(minAxisSize, (maxLocalExtentY * currentScaleY + axisPadding) * 2);
      const desiredScaleZ = Math.max(minAxisSize, (maxLocalExtentZ * currentScaleZ + axisPadding) * 2);

      for (const child of children) {
        if (desiredScaleX !== currentScaleX) {
          child.position.x *= currentScaleX / desiredScaleX;
        }
        if (desiredScaleY !== currentScaleY) {
          child.position.y *= currentScaleY / desiredScaleY;
        }
        if (desiredScaleZ !== currentScaleZ) {
          child.position.z *= currentScaleZ / desiredScaleZ;
        }
      }

      fileBox.scaling = new BABYLON.Vector3(desiredScaleX, desiredScaleY, desiredScaleZ);

      for (const child of fileBox.getChildren()) {
        const mesh = child as BABYLON.Mesh;
        if (mesh.name?.startsWith('filelabel_')) {
          updateFileBoxLabelTransform(mesh, fileBox);
          continue;
        }
        applyChildScaleCompensation(mesh, fileBox);
      }
    }
  }
}
