/**
 * Factory for creating and managing 3D mesh representations of code entities
 */
import * as BABYLON from '@babylonjs/core';
import type { GraphEdge, GraphNode } from './types';
import { SceneConfig } from './SceneConfig';
import { toProjectRelativePath } from './PathUtils';
import { createDefaultFunctionBoxFactory } from './FunctionBoxFactory';
import type { FunctionBoxCreator, FunctionBoxFactoryConfig } from './FunctionBoxContracts';

export interface MeshFactoryDependencies {
  functionBoxFactory?: FunctionBoxCreator;
  functionBoxConfig?: FunctionBoxFactoryConfig;
}

export class MeshFactory {
  private scene: BABYLON.Scene;
  private functionBoxFactory: FunctionBoxCreator;
  private edgesDirty = true;
  private sameFileEdgesStatic = false;
  private crossFileEdgesStatic = false;
  
  // Edge batching system to avoid RAF violations
  private static readonly EDGES_PER_FRAME = 40;  // Process this many edges per frame
  private edgeBatchUpdateIndex = 0;  // Track position in edge update cycle
  
  private nodeMeshes: Map<string, BABYLON.Mesh> = new Map();  // Track meshes for raycasting
  private nodeLabels: Map<string, BABYLON.Mesh> = new Map();  // Track node label planes for scaling
  private edgeTubes: Map<string, BABYLON.Mesh> = new Map();   // Simple tube storage
  private edgeArrows: Map<string, BABYLON.Mesh> = new Map();  // Arrowhead cones at target end
  private crossFileConduits: Map<string, BABYLON.Mesh> = new Map();
  private crossFileConduitJunctions: Map<string, { source: BABYLON.Mesh; target: BABYLON.Mesh }> = new Map();
  private crossFileConduitLinkBoxes: Map<string, { source: BABYLON.Mesh; target: BABYLON.Mesh }> = new Map();
  private crossFileConduitMetadata: Map<string, {
    sourceNodeId: string;
    targetNodeId: string;
    sourceFile: string;
    targetFile: string;
    edgeCount: number;
    sourceHubSlot: number;
    sourceHubSlotCount: number;
    targetHubSlot: number;
    targetHubSlotCount: number;
  }> = new Map();
  private edgeMetadata: Map<string, {
    from: string;
    to: string;
    fromFile: string | null;
    toFile: string | null;
    isCrossFile: boolean;
    isSelfLoop: boolean;
    bidirectionalOffsetSign: number;
    targetsExternalLibrary: boolean;
    crossFilePairKey: string | null;
  }> = new Map();
  private edgeMaterials: Set<BABYLON.StandardMaterial> = new Set();

  constructor(scene: BABYLON.Scene, dependencies: MeshFactoryDependencies = {}) {
    this.scene = scene;

    if (dependencies.functionBoxFactory) {
      this.functionBoxFactory = dependencies.functionBoxFactory;
      return;
    }

    const functionBoxConfig = dependencies.functionBoxConfig ?? this.createDefaultFunctionBoxConfig();
    this.functionBoxFactory = createDefaultFunctionBoxFactory(scene, functionBoxConfig);
  }

  private createDefaultFunctionBoxConfig(): FunctionBoxFactoryConfig {
    return {
      exportedFunctionBoxSize: SceneConfig.EXPORTED_FUNCTION_BOX_SIZE,
      internalFunctionBoxSize: SceneConfig.INTERNAL_FUNCTION_BOX_SIZE,
      functionBoxSize: SceneConfig.FUNCTION_BOX_SIZE,
      signatureTextureSize: SceneConfig.SIGNATURE_TEXTURE_SIZE,
      signatureFontFamily: SceneConfig.SIGNATURE_FONT_FAMILY,
    };
  }

  public setDeclutterContext(focusedFile: string | null, focusedDirectories: Iterable<string>): void {
    void focusedFile;
    void focusedDirectories;
  }

  public setSameFileEdgesStatic(staticMode: boolean): void {
    if (this.sameFileEdgesStatic === staticMode) {
      return;
    }
    this.sameFileEdgesStatic = staticMode;
    this.edgesDirty = true;
  }

  public setCrossFileEdgesStatic(staticMode: boolean): void {
    if (this.crossFileEdgesStatic === staticMode) {
      return;
    }
    this.crossFileEdgesStatic = staticMode;
    this.edgesDirty = true;
  }

  private getCrossFilePairKey(fileA: string, fileB: string): string {
    const a = toProjectRelativePath(fileA);
    const b = toProjectRelativePath(fileB);
    return a.localeCompare(b) <= 0 ? `${a}<->${b}` : `${b}<->${a}`;
  }

  private computeBoxHubPoint(boxMesh: BABYLON.Mesh, towardWorld: BABYLON.Vector3): BABYLON.Vector3 {
    const center = boxMesh.getAbsolutePosition().clone();
    const bounds = boxMesh.getBoundingInfo().boundingBox;
    const halfX = Math.max(2, (bounds.maximumWorld.x - bounds.minimumWorld.x) * 0.5);
    const halfY = Math.max(2, (bounds.maximumWorld.y - bounds.minimumWorld.y) * 0.5);
    const halfZ = Math.max(2, (bounds.maximumWorld.z - bounds.minimumWorld.z) * 0.5);

    const toTarget = towardWorld.subtract(center);
    const absX = Math.abs(toTarget.x);
    const absY = Math.abs(toTarget.y);
    const absZ = Math.abs(toTarget.z);
    const outward = 3.0;

    if (absX >= absY && absX >= absZ) {
      return new BABYLON.Vector3(
        center.x + (toTarget.x >= 0 ? 1 : -1) * (halfX + outward),
        center.y,
        center.z,
      );
    }

    if (absY >= absX && absY >= absZ) {
      return new BABYLON.Vector3(
        center.x,
        center.y + (toTarget.y >= 0 ? 1 : -1) * (halfY + outward),
        center.z,
      );
    }

    return new BABYLON.Vector3(
      center.x,
      center.y,
      center.z + (toTarget.z >= 0 ? 1 : -1) * (halfZ + outward),
    );
  }

  private computeMeshFacePointToward(mesh: BABYLON.Mesh, towardWorld: BABYLON.Vector3): BABYLON.Vector3 {
    const center = mesh.getAbsolutePosition().clone();
    const bounds = mesh.getBoundingInfo().boundingBox;
    const halfX = Math.max(0.1, (bounds.maximum.x - bounds.minimum.x) * 0.5);
    const halfY = Math.max(0.1, (bounds.maximum.y - bounds.minimum.y) * 0.5);
    const halfZ = Math.max(0.1, (bounds.maximum.z - bounds.minimum.z) * 0.5);
    const toTarget = towardWorld.subtract(center);
    const absX = Math.abs(toTarget.x);
    const absY = Math.abs(toTarget.y);
    const absZ = Math.abs(toTarget.z);

    if (absX >= absY && absX >= absZ) {
      return new BABYLON.Vector3(center.x + (toTarget.x >= 0 ? halfX : -halfX), center.y, center.z);
    }

    if (absY >= absX && absY >= absZ) {
      return new BABYLON.Vector3(center.x, center.y + (toTarget.y >= 0 ? halfY : -halfY), center.z);
    }

    return new BABYLON.Vector3(center.x, center.y, center.z + (toTarget.z >= 0 ? halfZ : -halfZ));
  }

  private computeCrossFileHubPointOffset(
    boxMesh: BABYLON.Mesh,
    towardWorld: BABYLON.Vector3,
    slotIndex: number,
    slotCount: number,
  ): BABYLON.Vector3 {
    if (slotCount <= 1) {
      return BABYLON.Vector3.Zero();
    }

    const center = boxMesh.getAbsolutePosition().clone();
    const normal = towardWorld.subtract(center);
    const normalLen = normal.length();
    if (normalLen < 0.0001) {
      return BABYLON.Vector3.Zero();
    }
    const n = normal.scale(1 / normalLen);

    const cross = (a: BABYLON.Vector3, b: BABYLON.Vector3) =>
      new BABYLON.Vector3(
        (a.y * b.z) - (a.z * b.y),
        (a.z * b.x) - (a.x * b.z),
        (a.x * b.y) - (a.y * b.x),
      );

    let tangentA = cross(n, new BABYLON.Vector3(0, 1, 0));
    if (tangentA.length() < 0.0001) {
      tangentA = cross(n, new BABYLON.Vector3(1, 0, 0));
    }
    const tangentALen = Math.max(0.0001, tangentA.length());
    tangentA = tangentA.scale(1 / tangentALen);

    let tangentB = cross(n, tangentA);
    const tangentBLen = Math.max(0.0001, tangentB.length());
    tangentB = tangentB.scale(1 / tangentBLen);

    const bounds = boxMesh.getBoundingInfo().boundingBox;
    const halfX = Math.max(1, (bounds.maximumWorld.x - bounds.minimumWorld.x) * 0.5);
    const halfY = Math.max(1, (bounds.maximumWorld.y - bounds.minimumWorld.y) * 0.5);
    const halfZ = Math.max(1, (bounds.maximumWorld.z - bounds.minimumWorld.z) * 0.5);
    const faceRadius = Math.max(1.0, Math.min(halfX, halfY, halfZ) * 0.35);

    const normalizedSlot = ((slotIndex % slotCount) + slotCount) % slotCount;
    const angle = (Math.PI * 2 * normalizedSlot) / slotCount;
    const offsetA = tangentA.scale(Math.cos(angle) * faceRadius);
    const offsetB = tangentB.scale(Math.sin(angle) * faceRadius);
    return offsetA.add(offsetB);
  }

  private computeCrossFileHubPoints(
    sourceParent: BABYLON.Mesh,
    targetParent: BABYLON.Mesh,
    sourceSlotIndex: number = 0,
    sourceSlotCount: number = 1,
    targetSlotIndex: number = 0,
    targetSlotCount: number = 1,
  ): {
    sourceHub: BABYLON.Vector3;
    targetHub: BABYLON.Vector3;
  } {
    const sourceCenter = sourceParent.getAbsolutePosition().clone();
    const targetCenter = targetParent.getAbsolutePosition().clone();
    const sourceBaseHub = this.computeBoxHubPoint(sourceParent, targetCenter);
    const targetBaseHub = this.computeBoxHubPoint(targetParent, sourceCenter);
    const sourceOffset = this.computeCrossFileHubPointOffset(
      sourceParent,
      targetCenter,
      sourceSlotIndex,
      sourceSlotCount,
    );
    const targetOffset = this.computeCrossFileHubPointOffset(
      targetParent,
      sourceCenter,
      targetSlotIndex,
      targetSlotCount,
    );

    return {
      sourceHub: sourceBaseHub.add(sourceOffset),
      targetHub: targetBaseHub.add(targetOffset),
    };
  }

  private isHubParentCandidate(node: BABYLON.Node | null | undefined): node is BABYLON.Mesh {
    if (!node) {
      return false;
    }

    const candidate = node as any;
    return typeof candidate.getBoundingInfo === 'function'
      && typeof candidate.getAbsolutePosition === 'function';
  }

  private findFileBoxAncestor(node: BABYLON.Node | null | undefined): BABYLON.Mesh | null {
    let current: BABYLON.Node | null | undefined = node;
    while (current) {
      const candidate = current as any;
      if (
        typeof candidate.name === 'string'
        && candidate.name.startsWith('filebox_')
        && this.isHubParentCandidate(current)
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private resolveCrossFileHubParents(
    sourceMesh: BABYLON.Mesh,
    targetMesh: BABYLON.Mesh,
  ): { sourceParent: BABYLON.Mesh; targetParent: BABYLON.Mesh } | null {
    const sourceFileBox = this.findFileBoxAncestor(sourceMesh);
    const targetFileBox = this.findFileBoxAncestor(targetMesh);

    const sourceParent = sourceFileBox
      ?? (this.isHubParentCandidate(sourceMesh.parent) ? sourceMesh.parent : null);
    const targetParent = targetFileBox
      ?? (this.isHubParentCandidate(targetMesh.parent) ? targetMesh.parent : null);

    if (!sourceParent || !targetParent || sourceParent === targetParent) {
      return null;
    }

    return { sourceParent, targetParent };
  }

  private assignCrossFileHubSlots(): void {
    const peersByFile = new Map<string, Set<string>>();
    for (const meta of this.crossFileConduitMetadata.values()) {
      if (!peersByFile.has(meta.sourceFile)) {
        peersByFile.set(meta.sourceFile, new Set<string>());
      }
      if (!peersByFile.has(meta.targetFile)) {
        peersByFile.set(meta.targetFile, new Set<string>());
      }
      peersByFile.get(meta.sourceFile)?.add(meta.targetFile);
      peersByFile.get(meta.targetFile)?.add(meta.sourceFile);
    }

    const orderedPeersByFile = new Map<string, string[]>();
    for (const [file, peers] of peersByFile.entries()) {
      orderedPeersByFile.set(file, Array.from(peers).sort((a, b) => a.localeCompare(b)));
    }

    for (const meta of this.crossFileConduitMetadata.values()) {
      const sourcePeers = orderedPeersByFile.get(meta.sourceFile) ?? [];
      const targetPeers = orderedPeersByFile.get(meta.targetFile) ?? [];
      const sourceSlot = sourcePeers.indexOf(meta.targetFile);
      const targetSlot = targetPeers.indexOf(meta.sourceFile);
      meta.sourceHubSlot = sourceSlot >= 0 ? sourceSlot : 0;
      meta.sourceHubSlotCount = Math.max(1, sourcePeers.length);
      meta.targetHubSlot = targetSlot >= 0 ? targetSlot : 0;
      meta.targetHubSlotCount = Math.max(1, targetPeers.length);
    }
  }

  private computeConduitRadius(edgeCount: number): number {
    const clampedCount = Math.max(1, edgeCount);
    const baseRadius = Math.max(0.16, SceneConfig.EDGE_RADIUS * 1.6);
    const perEdgeGain = SceneConfig.EDGE_RADIUS * 0.16;
    const maxRadius = SceneConfig.EDGE_RADIUS * 8.0;
    return Math.min(maxRadius, baseRadius + (perEdgeGain * clampedCount));
  }

  private computeConduitJunctionRadius(conduitRadius: number): number {
    return Math.max(conduitRadius * 1.55, 0.26);
  }

  private computeConduitJunctionHeight(conduitRadius: number): number {
    return Math.max(conduitRadius * 0.85, 0.14);
  }

  /**
   * Create a mesh for the given node based on its type
   */
  createNodeMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    fileColor: BABYLON.Color3 | null,
    indegree: number = 0,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    if (node.type === 'external') {
      this.createExternalModuleMesh(node, position, onNodeInteraction);
    } else if (node.type === 'class') {
      this.createClassMesh(node, position, fileColor, onNodeInteraction);
    } else if (node.type === 'variable') {
      this.createVariableMesh(node, position, onNodeInteraction);
    } else {
      this.createFunctionMesh(node, position, fileColor, indegree, onNodeInteraction);
    }
  }

  /**
   * Create a class node as an icosahedron-like mesh.
   */
  private createClassMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    fileColor: BABYLON.Color3 | null,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const diameter = Math.max(1.8, SceneConfig.INTERNAL_FUNCTION_BOX_SIZE * 0.82);
    const createIcoSphere = (BABYLON.MeshBuilder as any).CreateIcoSphere as
      | ((name: string, options: any, scene: BABYLON.Scene) => BABYLON.Mesh)
      | undefined;

    const classMesh = createIcoSphere
      ? createIcoSphere(`class_${node.id}`, { radius: diameter * 0.5, flat: true, subdivisions: 1 }, this.scene)
      : BABYLON.MeshBuilder.CreateSphere(
          `class_${node.id}`,
          { diameter, segments: 12 },
          this.scene,
        );

    classMesh.position = position;
    classMesh.isPickable = true;

    const material = new BABYLON.StandardMaterial(`classMat_${node.id}`, this.scene);
    const tint = fileColor ?? new BABYLON.Color3(0.42, 0.58, 0.90);
    material.diffuseColor = new BABYLON.Color3(
      Math.min(1, tint.r * 0.85 + 0.12),
      Math.min(1, tint.g * 0.85 + 0.12),
      Math.min(1, tint.b * 0.95 + 0.10),
    );
    material.emissiveColor = new BABYLON.Color3(
      Math.min(1, tint.r * 0.20 + 0.06),
      Math.min(1, tint.g * 0.20 + 0.06),
      Math.min(1, tint.b * 0.22 + 0.08),
    );
    material.specularColor = new BABYLON.Color3(0.45, 0.45, 0.52);
    material.specularPower = 44;
    material.alpha = 1.0;
    material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
    classMesh.material = material;

    this.nodeMeshes.set(node.id, classMesh);
    this.createLabel(node.name, classMesh as BABYLON.Mesh);
    onNodeInteraction(classMesh as BABYLON.Mesh, material, node);
  }

  /**
   * Create an external module pyramid mesh
   */
  private createExternalModuleMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const pyramid = BABYLON.MeshBuilder.CreateCylinder(
      `ext_${node.id}`,
      {
        height: SceneConfig.EXTERNAL_PYRAMID_HEIGHT,
        diameterTop: 0,
        diameterBottom: SceneConfig.EXTERNAL_PYRAMID_BASE,
        tessellation: 4,
      },
      this.scene
    );
    pyramid.position = position;
    pyramid.isPickable = true;

    const material = new BABYLON.StandardMaterial(`extMat_${node.id}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(0.90, 0.72, 0.18);
    material.emissiveColor = new BABYLON.Color3(0.40, 0.30, 0.06);
    material.specularColor = new BABYLON.Color3(1.0, 0.92, 0.54);
    material.specularPower = 80;
    material.alpha = 1.0;
    material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
    const labelTexture = this.createExternalPyramidLabelTexture(node.name, node.id);
    labelTexture.hasAlpha = false;
    labelTexture.uScale = -1;
    labelTexture.uOffset = 1;
    material.diffuseTexture = labelTexture;
    material.wireframe = false;
    pyramid.material = material;

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, pyramid);

    onNodeInteraction(pyramid as BABYLON.Mesh, material, node);
  }

  /**
   * Render module name directly on external pyramid faces (no billboard plane).
   */
  private createExternalPyramidLabelTexture(label: string, nodeId: string): BABYLON.DynamicTexture {
    const width = 2048;
    const height = 256;
    const texture = new BABYLON.DynamicTexture(
      `extLabelTexture_${nodeId}`,
      { width, height },
      this.scene,
      true,
    );

    texture.hasAlpha = false;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = 'rgb(216, 164, 36)';
    ctx.fillRect(0, 0, width, height);

    const maxLabelChars = 34;
    const cleanLabel = label.length > maxLabelChars
      ? `${label.slice(0, maxLabelChars - 1)}...`
      : label;

    ctx.font = '700 46px Consolas';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(40, 24, 2, 0.95)';
    ctx.fillStyle = 'rgba(255, 246, 214, 0.98)';

    // Draw a darker base strip so the label reads as sitting near the pyramid base.
    const stripTop = Math.floor(height * 0.70);
    ctx.fillStyle = 'rgba(110, 76, 16, 0.92)';
    ctx.fillRect(0, stripTop, width, height - stripTop);
    ctx.fillStyle = 'rgba(255, 246, 214, 0.98)';

    const faceCenters = [0.125, 0.375, 0.625, 0.875].map((u) => width * u);
    const y = Math.floor(height * 0.84);
    for (const x of faceCenters) {
      ctx.strokeText(cleanLabel, x, y);
      ctx.fillText(cleanLabel, x, y);
    }

    texture.update();
    return texture;
  }

  /**
   * Create a variable sphere mesh
   */
  private createVariableMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const sphere = BABYLON.MeshBuilder.CreateSphere(
      `var_${node.id}`,
      { diameter: SceneConfig.VARIABLE_SPHERE_DIAMETER },
      this.scene
    );
    sphere.position = position;
    sphere.isPickable = true;

    const material = new BABYLON.StandardMaterial(`varMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15);  // Subtle gray
    material.wireframe = false;
    sphere.material = material;

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, sphere);

    this.createLabel(node.name, sphere as BABYLON.Mesh);
    onNodeInteraction(sphere as BABYLON.Mesh, material, node);
  }

  /**
   * Create a function box mesh with signature texture
   */
  private createFunctionMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    fileColor: BABYLON.Color3 | null,
    _indegree: number = 0,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const { mesh: box, material } = this.functionBoxFactory.create(node, position, fileColor);

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, box);

    onNodeInteraction(box as BABYLON.Mesh, material, node);
  }

  /**
   * Create a billboard label above a mesh with improved readability
   */
  private createLabel(text: string, parentMesh: BABYLON.Mesh): void {
    const dynamicTexture = new BABYLON.DynamicTexture(
      `labelTexture_${parentMesh.id}`,
      SceneConfig.LABEL_TEXTURE_SIZE,
      this.scene
    );
    const ctx = dynamicTexture.getContext() as any;

    // Clear background
    ctx.clearRect(0, 0, SceneConfig.LABEL_TEXTURE_SIZE, SceneConfig.LABEL_TEXTURE_SIZE);
    
    // Dark rounded background with border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, SceneConfig.LABEL_TEXTURE_SIZE, SceneConfig.LABEL_TEXTURE_SIZE);
    
    // Subtle border
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.6)';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, SceneConfig.LABEL_TEXTURE_SIZE - 16, SceneConfig.LABEL_TEXTURE_SIZE - 16);

    // Bright cyan text for high visibility
    ctx.fillStyle = '#00ffff';
    ctx.font = `bold 80px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Text shadow for additional readability
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    // Wrap text if it's too long
    const displayText = this.truncateText(text, 24);
    ctx.fillText(displayText, SceneConfig.LABEL_TEXTURE_SIZE / 2, SceneConfig.LABEL_TEXTURE_SIZE / 2);

    dynamicTexture.update();

    // Create plane for label
    const labelPlane = BABYLON.MeshBuilder.CreatePlane(
      `label_${parentMesh.id}`,
      { width: SceneConfig.LABEL_WIDTH, height: SceneConfig.LABEL_HEIGHT },
      this.scene
    );
    // Position label offset from the mesh center
    labelPlane.position = SceneConfig.LABEL_OFFSET;
    // Parent to the node mesh so it moves with the node
    labelPlane.parent = parentMesh;
    labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const labelMaterial = new BABYLON.StandardMaterial(`labelMat_${parentMesh.id}`, this.scene);
    labelMaterial.emissiveTexture = dynamicTexture;
    labelMaterial.backFaceCulling = false;
    labelPlane.material = labelMaterial;

    // Track label for distance-based scaling
    this.nodeLabels.set(parentMesh.id, labelPlane);
  }

  public updateNodeLabelScaling(camera: BABYLON.Camera): void {
    if (!camera) return;

    const cameraPos = camera.position;
    
    for (const [parentId, labelPlane] of this.nodeLabels.entries()) {
      const parentMesh = this.nodeMeshes.get(parentId);
      if (!parentMesh || !labelPlane.parent) continue;

      // Calculate distance from camera to parent mesh (world position)
      const meshWorldPos = parentMesh.getAbsolutePosition();
      const distance = BABYLON.Vector3.Distance(cameraPos, meshWorldPos);

      // Scale labels based on distance: closer = smaller, farther = larger
      // Base scale at distance 10 is 1.0, scales up with distance
      const baseDistance = 10;
      const scaleFactor = Math.max(0.5, Math.min(3.0, distance / baseDistance));
      
      labelPlane.scaling.x = scaleFactor;
      labelPlane.scaling.y = scaleFactor;
    }
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }
    // Extract meaningful part (e.g., class name from "class:MyClass@file" or just the last segment)
    const parts = text.split(/[:\/@.]/);
    const filtered = parts.filter(p => p.length > 0 && !p.includes('file') && p !== 'class');
    const meaningful = filtered[filtered.length - 1] || text;
    
    if (meaningful.length <= maxChars) {
      return meaningful;
    }
    return meaningful.slice(0, maxChars - 2) + '...';
  }

  /**
   * Create edge (cylinder) meshes connecting nodes
   * Uses cylinders that can be reused and repositioned each frame for performance
   * Clears old edges before creating new ones
   */
  createEdges(
    edges: Array<{ from: string; to: string; kind?: GraphEdge['kind'] }>,
    _layoutNodes: Map<string, any>,  // Kept for API compatibility, actual positions from mesh.getAbsolutePosition()
    sceneRoot?: BABYLON.TransformNode,
    nodeExportedMap?: Map<string, boolean>,  // Map of node IDs to isExported status
    fileColorMap?: Map<string, BABYLON.Color3>, // Map of file paths to file box colors
    nodeFileMap?: Map<string, string>,
  ): void {
    this.edgesDirty = true;

    // Clear old edge meshes/materials first so repeated graph refreshes do not leak GPU resources.
    this.clearEdges();
    this.crossFileConduitMetadata.clear();

    // All edges are colored by their target file. We cache one material per (targetFile, isCrossFile)
    // pair so shared per-file materials are reused across edges.
    // Cross-file edges: full opacity, bright emissive, normal thickness.
    // Same-file edges: semi-transparent, dimmer emissive, thinner.
    // Exported-target edges: slightly brighter emissive to stand out.
    const edgeMaterialCache = new Map<string, BABYLON.StandardMaterial>();

    const getEdgeMaterial = (
      targetFileRaw: string,
      crossFile: boolean,
      exported: boolean,
      selfLoop: boolean,
      targetsExternalLibrary: boolean,
      edgeKind?: GraphEdge['kind'],
    ): BABYLON.StandardMaterial => {
      const targetFile = toProjectRelativePath(targetFileRaw);
      const key = `${targetFile}|${crossFile}|${exported}|${selfLoop}|${targetsExternalLibrary}|${edgeKind ?? 'call'}`;
      const cached = edgeMaterialCache.get(key);
      if (cached) return cached;

      const targetColor =
        fileColorMap?.get(targetFile) ??
        fileColorMap?.get(targetFileRaw) ??
        new BABYLON.Color3(0.5, 0.5, 0.5);
      const mat = new BABYLON.StandardMaterial(`edgeMat_${key}`, this.scene);

      if (edgeKind === 'import-cycle') {
        // Edges in an import cycle are highlighted with a warning red.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.36, 0.36);
        mat.diffuseColor = new BABYLON.Color3(0.76, 0.18, 0.18);
        mat.specularColor = new BABYLON.Color3(1.0, 0.78, 0.78);
        mat.specularPower = 44;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'import') {
        // Module import dependencies.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.74, 0.28);
        mat.diffuseColor = new BABYLON.Color3(0.74, 0.50, 0.16);
        mat.specularColor = new BABYLON.Color3(1.0, 0.90, 0.70);
        mat.specularPower = 34;
        mat.alpha = 0.95;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'export') {
        // Module exports to symbols.
        mat.emissiveColor = new BABYLON.Color3(0.26, 0.90, 0.86);
        mat.diffuseColor = new BABYLON.Color3(0.10, 0.56, 0.54);
        mat.specularColor = new BABYLON.Color3(0.76, 1.0, 0.96);
        mat.specularPower = 34;
        mat.alpha = 0.95;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'var-write') {
        // Function writes to global variable.
        mat.emissiveColor = new BABYLON.Color3(0.22, 0.90, 0.52);
        mat.diffuseColor = new BABYLON.Color3(0.08, 0.56, 0.30);
        mat.specularColor = new BABYLON.Color3(0.72, 1.0, 0.86);
        mat.specularPower = 40;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'var-read') {
        // Function reads from global variable.
        mat.emissiveColor = new BABYLON.Color3(0.24, 0.66, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.10, 0.34, 0.72);
        mat.specularColor = new BABYLON.Color3(0.76, 0.90, 1.0);
        mat.specularPower = 36;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'type-import') {
        // Type-only import — periwinkle blue, semi-transparent.
        mat.emissiveColor = new BABYLON.Color3(0.50, 0.60, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.24, 0.32, 0.72);
        mat.specularColor = new BABYLON.Color3(0.78, 0.84, 1.0);
        mat.specularPower = 32;
        mat.alpha = 0.88;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'type-export') {
        // Type-only export — mint/teal green, semi-transparent.
        mat.emissiveColor = new BABYLON.Color3(0.22, 0.86, 0.62);
        mat.diffuseColor = new BABYLON.Color3(0.08, 0.52, 0.36);
        mat.specularColor = new BABYLON.Color3(0.68, 1.0, 0.86);
        mat.specularPower = 32;
        mat.alpha = 0.88;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'extends') {
        // Class/interface inheritance — coral red, bold.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.40, 0.34);
        mat.diffuseColor = new BABYLON.Color3(0.76, 0.18, 0.12);
        mat.specularColor = new BABYLON.Color3(1.0, 0.80, 0.78);
        mat.specularPower = 44;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'implements') {
        // Interface implementation — violet/purple.
        mat.emissiveColor = new BABYLON.Color3(0.70, 0.36, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.40, 0.14, 0.72);
        mat.specularColor = new BABYLON.Color3(0.90, 0.78, 1.0);
        mat.specularPower = 40;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'type-ref') {
        // General type annotation reference — lavender, thin, translucent.
        mat.emissiveColor = new BABYLON.Color3(0.72, 0.52, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.38, 0.22, 0.72);
        mat.specularColor = new BABYLON.Color3(0.90, 0.82, 1.0);
        mat.specularPower = 28;
        mat.alpha = 0.78;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'type-constraint') {
        // Generic type parameter constraint — amber/gold.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.76, 0.20);
        mat.diffuseColor = new BABYLON.Color3(0.78, 0.52, 0.08);
        mat.specularColor = new BABYLON.Color3(1.0, 0.92, 0.62);
        mat.specularPower = 36;
        mat.alpha = 0.92;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'overload-of') {
        // Overload signature linked to implementation — steel blue, thin.
        mat.emissiveColor = new BABYLON.Color3(0.28, 0.58, 0.80);
        mat.diffuseColor = new BABYLON.Color3(0.10, 0.32, 0.58);
        mat.specularColor = new BABYLON.Color3(0.72, 0.88, 1.0);
        mat.specularPower = 30;
        mat.alpha = 0.82;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'enum-member-read') {
        // Enum member access — warm orange.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.54, 0.16);
        mat.diffuseColor = new BABYLON.Color3(0.80, 0.32, 0.04);
        mat.specularColor = new BABYLON.Color3(1.0, 0.84, 0.60);
        mat.specularPower = 40;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'module-augmentation') {
        // Ambient module augmentation — bright cyan.
        mat.emissiveColor = new BABYLON.Color3(0.20, 0.86, 0.96);
        mat.diffuseColor = new BABYLON.Color3(0.06, 0.52, 0.68);
        mat.specularColor = new BABYLON.Color3(0.68, 0.98, 1.0);
        mat.specularPower = 38;
        mat.alpha = 0.94;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (edgeKind === 'decorator') {
        // Decorator — fuchsia/magenta.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.26, 0.72);
        mat.diffuseColor = new BABYLON.Color3(0.76, 0.08, 0.46);
        mat.specularColor = new BABYLON.Color3(1.0, 0.74, 0.92);
        mat.specularPower = 44;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 'new-call') {
        // Constructor invocation via new — chartreuse/lime green.
        mat.emissiveColor = new BABYLON.Color3(0.54, 0.96, 0.24);
        mat.diffuseColor = new BABYLON.Color3(0.26, 0.66, 0.06);
        mat.specularColor = new BABYLON.Color3(0.80, 1.0, 0.68);
        mat.specularPower = 40;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (edgeKind === 're-export') {
        // Barrel re-export — sky blue, distinct from plain import.
        mat.emissiveColor = new BABYLON.Color3(0.26, 0.76, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.10, 0.48, 0.78);
        mat.specularColor = new BABYLON.Color3(0.72, 0.92, 1.0);
        mat.specularPower = 34;
        mat.alpha = 0.96;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      } else if (targetsExternalLibrary) {
        // External-library edges use a consistent gold/yellow style.
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.82, 0.20);
        mat.diffuseColor = new BABYLON.Color3(0.95, 0.70, 0.14);
        mat.specularColor = new BABYLON.Color3(1.0, 0.92, 0.56);
        mat.specularPower = 54;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (selfLoop) {
        // Recursive self-loop edges use a distinct high-contrast cool tint so they
        // can be identified quickly among dense regular edges.
        mat.emissiveColor = new BABYLON.Color3(0.28, 0.80, 1.0);
        mat.diffuseColor = new BABYLON.Color3(0.12, 0.42, 0.86);
        mat.specularColor = new BABYLON.Color3(0.72, 0.92, 1.0);
        mat.specularPower = 48;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else if (crossFile) {
        // Cross-file: vivid target-file color, fully opaque
        const boost = exported ? 0.15 : 0.0;
        mat.emissiveColor = new BABYLON.Color3(
          Math.min(1, targetColor.r * 0.85 + 0.15 + boost),
          Math.min(1, targetColor.g * 0.85 + 0.15 + boost),
          Math.min(1, targetColor.b * 0.85 + 0.15 + boost)
        );
        mat.diffuseColor = new BABYLON.Color3(
          Math.min(1, targetColor.r * 0.5 + 0.1),
          Math.min(1, targetColor.g * 0.5 + 0.1),
          Math.min(1, targetColor.b * 0.5 + 0.1)
        );
        mat.specularColor = new BABYLON.Color3(
          Math.min(1, targetColor.r * 0.5 + 0.5),
          Math.min(1, targetColor.g * 0.5 + 0.5),
          Math.min(1, targetColor.b * 0.5 + 0.5)
        );
        mat.specularPower = 32;
        mat.alpha = 1.0;
        mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      } else {
        // Same-file: keep target tint but make lines clearly readable at distance.
        mat.emissiveColor = new BABYLON.Color3(
          Math.min(1, targetColor.r * 0.85 + 0.16),
          Math.min(1, targetColor.g * 0.85 + 0.16),
          Math.min(1, targetColor.b * 0.85 + 0.16)
        );
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        mat.alpha = exported ? 1.0 : 0.9;
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      }
      mat.backFaceCulling = false;
      // Keep edges visually stable at range and in darker regions.
      mat.disableLighting = true;
      this.edgeMaterials.add(mat);
      edgeMaterialCache.set(key, mat);
      return mat;
    };

    // Create cylinder for each edge that will be repositioned each frame
    const edgeKeySet = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
    let edgeIndex = 0;
    for (const edge of edges) {
      // Note: We don't check layoutNodes because updateEdges() will use actual mesh positions
      // This allows edges to be created before node meshes are fully positioned

      // Extract file paths to determine if cross-file
      const fromFile = nodeFileMap?.get(edge.from) ?? this.extractFilePathFromNodeId(edge.from);
      const toFile = nodeFileMap?.get(edge.to) ?? this.extractFilePathFromNodeId(edge.to);
      const edgeKind = edge.kind ?? 'call';
      const isCrossFile = fromFile !== toFile;
      const isSelfLoop = edge.from === edge.to;
      const targetsExternalLibrary = edge.to.startsWith('ext:');
      const hasReverseEdge = !isSelfLoop && edgeKeySet.has(`${edge.to}->${edge.from}`);
      const bidirectionalOffsetSign = hasReverseEdge
        ? (edge.from.localeCompare(edge.to) <= 0 ? 1 : -1)
        : 0;

      // Check if the target node is an exported function
      const isExportedConnection = !!(nodeExportedMap && nodeExportedMap.get(edge.to));

      const targetFileRaw = toFile || 'unknown';
      const material = getEdgeMaterial(
        targetFileRaw,
        isCrossFile,
        isExportedConnection,
        isSelfLoop,
        targetsExternalLibrary,
        edgeKind,
      );

      // Cross-file edges are thicker; same-file edges are thinner.
      // Exported-target same-file edges use an intermediate thickness.
      const edgeDiameter = edgeKind === 'import-cycle'
        ? SceneConfig.EDGE_RADIUS * 2.4
        : edgeKind === 'import'
          ? SceneConfig.EDGE_RADIUS * 1.6
          : edgeKind === 'export'
            ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.8
        : edgeKind === 're-export'
          ? SceneConfig.EDGE_RADIUS * 1.4
        : edgeKind === 'type-import'
          ? SceneConfig.EDGE_RADIUS * 1.2
        : edgeKind === 'type-export'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.6
        : edgeKind === 'var-write'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 3.0
        : edgeKind === 'var-read'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.2
        : edgeKind === 'new-call'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.6
        : edgeKind === 'extends'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.4
        : edgeKind === 'implements'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.0
        : edgeKind === 'decorator'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.2
        : edgeKind === 'enum-member-read'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.8
        : edgeKind === 'module-augmentation'
          ? SceneConfig.EDGE_RADIUS * 1.3
        : edgeKind === 'type-ref'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.4
        : edgeKind === 'type-constraint'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.2
        : edgeKind === 'overload-of'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.0
        : isSelfLoop
          ? SceneConfig.EDGE_RADIUS * 1.6
          : isCrossFile
            ? SceneConfig.EDGE_RADIUS * 2
            : isExportedConnection
              ? SceneConfig.INTERNAL_EDGE_RADIUS * 4
              : SceneConfig.INTERNAL_EDGE_RADIUS * 2;
      // All edges are now created as tubes with updatable paths to support collision avoidance
      // Initial path is a straight line (will be updated in updateEdges())
      const initialPath = [
        BABYLON.Vector3.Zero(),
        new BABYLON.Vector3(0, 1, 0),
      ];
      const tubeRadius = isSelfLoop
        ? Math.max(0.06, edgeDiameter * 0.45)
        : Math.max(0.06, edgeDiameter * 0.5);
      
      const cylinder = BABYLON.MeshBuilder.CreateTube(`edge_${edgeIndex}`, {
        path: initialPath,
        radius: tubeRadius,
        updatable: true,
      }, this.scene);
      
      cylinder.material = material;
      cylinder.isPickable = true;
      // Keep connection edges rendered even when camera intersects their bounds.
      cylinder.alwaysSelectAsActiveMesh = true;
      cylinder.renderingGroupId = 1;  // Render edges on top of transparent boxes
      (cylinder as any).edgeData = { from: edge.from, to: edge.to };
      (cylinder as any).edgeKind = edgeKind;
      
      // Parent to scene root to move with the scene
      if (sceneRoot) {
        cylinder.parent = sceneRoot;
      }

      // Arrowhead cone at the target end: tip points in the direction of the call
      const arrowHeight = edgeKind === 'import-cycle'
        ? edgeDiameter * 4.2
        : edgeKind === 'import'
          ? edgeDiameter * 3.8
          : edgeKind === 'export'
            ? edgeDiameter * 3.6
        : edgeKind === 're-export'
          ? edgeDiameter * 3.7
        : edgeKind === 'type-import' || edgeKind === 'type-export'
          ? edgeDiameter * 3.4
        : edgeKind === 'var-write'
          ? edgeDiameter * 5.0
        : edgeKind === 'var-read'
          ? edgeDiameter * 4.4
        : edgeKind === 'new-call'
          ? edgeDiameter * 4.6
        : edgeKind === 'extends' || edgeKind === 'implements'
          ? edgeDiameter * 4.2
        : edgeKind === 'decorator'
          ? edgeDiameter * 4.4
        : edgeKind === 'enum-member-read'
          ? edgeDiameter * 4.2
        : edgeKind === 'module-augmentation'
          ? edgeDiameter * 3.8
        : edgeKind === 'type-ref' || edgeKind === 'type-constraint' || edgeKind === 'overload-of'
          ? edgeDiameter * 3.6
          : edgeDiameter * 4.0;
      const arrowBaseDiameter = edgeKind === 'import-cycle'
        ? edgeDiameter * 2.7
        : edgeKind === 'import'
          ? edgeDiameter * 2.4
          : edgeKind === 'export'
            ? edgeDiameter * 2.2
        : edgeKind === 're-export'
          ? edgeDiameter * 2.3
        : edgeKind === 'type-import' || edgeKind === 'type-export'
          ? edgeDiameter * 2.1
        : edgeKind === 'var-write'
          ? edgeDiameter * 2.9
        : edgeKind === 'var-read'
          ? edgeDiameter * 2.6
        : edgeKind === 'new-call'
          ? edgeDiameter * 2.8
        : edgeKind === 'extends' || edgeKind === 'implements'
          ? edgeDiameter * 2.6
        : edgeKind === 'decorator'
          ? edgeDiameter * 2.7
        : edgeKind === 'type-ref' || edgeKind === 'type-constraint' || edgeKind === 'overload-of'
          ? edgeDiameter * 2.0
          : edgeDiameter * 2.5;
      const arrow = BABYLON.MeshBuilder.CreateCylinder(`arrow_${edgeIndex}`, {
        diameterTop: 0,           // cone tip
        diameterBottom: arrowBaseDiameter,
        height: arrowHeight,
      }, this.scene);
      arrow.material = material;
      arrow.isPickable = true;
      arrow.alwaysSelectAsActiveMesh = true;
      arrow.renderingGroupId = 1;  // Render edges on top of transparent boxes
      (arrow as any).edgeData = { from: edge.from, to: edge.to };
      (arrow as any).edgeKind = edgeKind;
      if (sceneRoot) {
        arrow.parent = sceneRoot;
      }

      // Store cylinder, arrow and metadata
      this.edgeTubes.set(`${edgeIndex}`, cylinder);
      this.edgeArrows.set(`${edgeIndex}`, arrow);
      this.edgeMetadata.set(`${edgeIndex}`, {
        from: edge.from,
        to: edge.to,
        fromFile: fromFile ? toProjectRelativePath(fromFile) : null,
        toFile: toFile ? toProjectRelativePath(toFile) : null,
        isCrossFile,
        isSelfLoop,
        bidirectionalOffsetSign,
        targetsExternalLibrary,
        crossFilePairKey: isCrossFile && fromFile && toFile && !targetsExternalLibrary
          ? this.getCrossFilePairKey(fromFile, toFile)
          : null,
      });

      if (isCrossFile && fromFile && toFile && !targetsExternalLibrary) {
        const pairKey = this.getCrossFilePairKey(fromFile, toFile);
        const existing = this.crossFileConduitMetadata.get(pairKey);
        if (existing) {
          existing.edgeCount += 1;
        } else {
          this.crossFileConduitMetadata.set(pairKey, {
            sourceNodeId: edge.from,
            targetNodeId: edge.to,
            sourceFile: toProjectRelativePath(fromFile),
            targetFile: toProjectRelativePath(toFile),
            edgeCount: 1,
            sourceHubSlot: 0,
            sourceHubSlotCount: 1,
            targetHubSlot: 0,
            targetHubSlotCount: 1,
          });
        }
      }

      edgeIndex++;
    }

    this.assignCrossFileHubSlots();

    for (const [pairKey, conduitMeta] of this.crossFileConduitMetadata.entries()) {
      const conduitRadius = this.computeConduitRadius(conduitMeta.edgeCount);
      const conduitMaterial = new BABYLON.StandardMaterial(`conduitMat_${pairKey}`, this.scene);
      conduitMaterial.emissiveColor = new BABYLON.Color3(0.92, 0.96, 1.0);
      conduitMaterial.diffuseColor = new BABYLON.Color3(0.42, 0.50, 0.64);
      conduitMaterial.specularColor = new BABYLON.Color3(0.86, 0.92, 1.0);
      conduitMaterial.specularPower = 32;
      conduitMaterial.alpha = 0.82;
      conduitMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      conduitMaterial.backFaceCulling = false;
      conduitMaterial.disableLighting = true;
      this.edgeMaterials.add(conduitMaterial);

      const conduit = BABYLON.MeshBuilder.CreateTube(`conduit_${pairKey}`, {
        path: [BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, 1, 0)],
        radius: conduitRadius,
        updatable: true,
      }, this.scene);
      conduit.material = conduitMaterial;
      conduit.isPickable = true;
      conduit.alwaysSelectAsActiveMesh = true;
      conduit.renderingGroupId = 1;
      if (sceneRoot) {
        conduit.parent = sceneRoot;
      }
      (conduit as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (conduit as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        endpoint: 'bundle',
      };
      this.crossFileConduits.set(pairKey, conduit);

      const junctionRadius = this.computeConduitJunctionRadius(conduitRadius);
      const junctionHeight = this.computeConduitJunctionHeight(conduitRadius);
      const sourceJunction = BABYLON.MeshBuilder.CreateCylinder(`conduitJunction_${pairKey}_source`, {
        diameterTop: 1,
        diameterBottom: 1,
        height: 1,
        tessellation: 12,
      }, this.scene);
      sourceJunction.material = conduitMaterial;
      sourceJunction.isPickable = true;
      sourceJunction.alwaysSelectAsActiveMesh = true;
      sourceJunction.renderingGroupId = 1;
      if (sceneRoot) {
        sourceJunction.parent = sceneRoot;
      }
      (sourceJunction as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (sourceJunction as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.targetNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        endpoint: 'source',
      };

      const targetJunction = BABYLON.MeshBuilder.CreateCylinder(`conduitJunction_${pairKey}_target`, {
        diameterTop: 1,
        diameterBottom: 1,
        height: 1,
        tessellation: 12,
      }, this.scene);
      targetJunction.material = conduitMaterial;
      targetJunction.isPickable = true;
      targetJunction.alwaysSelectAsActiveMesh = true;
      targetJunction.renderingGroupId = 1;
      if (sceneRoot) {
        targetJunction.parent = sceneRoot;
      }
      (targetJunction as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (targetJunction as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.sourceNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        endpoint: 'target',
      };

      const initialScale = new BABYLON.Vector3(junctionRadius, junctionHeight, junctionRadius);
      sourceJunction.scaling = initialScale.clone();
      targetJunction.scaling = initialScale.clone();

      this.crossFileConduitJunctions.set(pairKey, { source: sourceJunction, target: targetJunction });

        // --- File link boxes (billboard labels at each conduit endpoint) ---
        const lblTargetColor = fileColorMap?.get(conduitMeta.targetFile) ?? new BABYLON.Color3(0.5, 0.5, 0.5);
        const lblSourceColor = fileColorMap?.get(conduitMeta.sourceFile) ?? new BABYLON.Color3(0.5, 0.5, 0.5);
        const sourceLinkBox = this.createFileLinkBoxMesh(
          `fileLinkBox_${pairKey}_source`,
          conduitMeta.targetFile,
          lblTargetColor,
          sceneRoot,
        );
        const targetLinkBox = this.createFileLinkBoxMesh(
          `fileLinkBox_${pairKey}_target`,
          conduitMeta.sourceFile,
          lblSourceColor,
          sceneRoot,
        );
        (sourceLinkBox as any).edgeData = {
          from: conduitMeta.sourceNodeId,
          to: conduitMeta.targetNodeId,
        };
        (sourceLinkBox as any).hubData = {
          sourceNodeId: conduitMeta.sourceNodeId,
          targetNodeId: conduitMeta.targetNodeId,
          navigationNodeId: conduitMeta.targetNodeId,
          sourceFile: conduitMeta.sourceFile,
          targetFile: conduitMeta.targetFile,
          endpoint: 'source',
        };
        (targetLinkBox as any).edgeData = {
          from: conduitMeta.sourceNodeId,
          to: conduitMeta.targetNodeId,
        };
        (targetLinkBox as any).hubData = {
          sourceNodeId: conduitMeta.sourceNodeId,
          targetNodeId: conduitMeta.targetNodeId,
          navigationNodeId: conduitMeta.sourceNodeId,
          sourceFile: conduitMeta.sourceFile,
          targetFile: conduitMeta.targetFile,
          endpoint: 'target',
        };
        this.crossFileConduitLinkBoxes.set(pairKey, { source: sourceLinkBox, target: targetLinkBox });
    }

    this.edgesDirty = true;
  }


  public markEdgesDirty(): void {
    this.edgesDirty = true;
  }



  /**
   * Remove a node mesh reference from the tracking map
   */
  removeMeshReference(nodeId: string): void {
    this.nodeMeshes.delete(nodeId);
    this.edgesDirty = true;
  }

  /**
   * Clear all edge meshes and edge materials created by this factory.
   */
  public clearEdges(): void {
    for (const cylinder of this.edgeTubes.values()) {
      cylinder.dispose();
    }
    this.edgeTubes.clear();

    for (const arrow of this.edgeArrows.values()) {
      arrow.dispose();
    }
    this.edgeArrows.clear();

    for (const conduit of this.crossFileConduits.values()) {
      conduit.dispose();
    }
    this.crossFileConduits.clear();

    for (const junctionPair of this.crossFileConduitJunctions.values()) {
      junctionPair.source.dispose();
      junctionPair.target.dispose();
    }
    this.crossFileConduitJunctions.clear();

    for (const linkBoxPair of this.crossFileConduitLinkBoxes.values()) {
      linkBoxPair.source.dispose();
      linkBoxPair.target.dispose();
    }
    this.crossFileConduitLinkBoxes.clear();

    this.crossFileConduitMetadata.clear();

    this.edgeMetadata.clear();

    for (const material of this.edgeMaterials.values()) {
      material.dispose();
    }
    this.edgeMaterials.clear();
    this.edgesDirty = true;
  }

  /**
   * Remove all cached node mesh references.
   */
  public clearNodeReferences(): void {
    this.nodeMeshes.clear();
    this.edgesDirty = true;
  }

  private toParentLocalPoint(parent: BABYLON.Node | null, worldPoint: BABYLON.Vector3): BABYLON.Vector3 {
    if (parent && (parent as any).getWorldMatrix) {
      const parentMatrix = (parent as any).getWorldMatrix().clone() as BABYLON.Matrix;
      const inverseParentMatrix = BABYLON.Matrix.Invert(parentMatrix);
      return BABYLON.Vector3.TransformCoordinates(worldPoint, inverseParentMatrix);
    }
    return worldPoint.clone();
  }

  private buildSelfLoopPath(parent: BABYLON.Node | null, sourceCenterWorld: BABYLON.Vector3, nodeRadius: number): BABYLON.Vector3[] {
    const loopRadius = Math.max(3.2, nodeRadius * 1.8);
    const loopLift = Math.max(2.6, nodeRadius * 1.4);
    const loopCenter = sourceCenterWorld.add(new BABYLON.Vector3(0, loopLift, 0));
    const angleOffset = -Math.PI / 3;
    const segments = 28;
    const worldPath: BABYLON.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = angleOffset + (Math.PI * 2 * t);
      worldPath.push(new BABYLON.Vector3(
        loopCenter.x + (Math.cos(angle) * loopRadius),
        loopCenter.y,
        loopCenter.z + (Math.sin(angle) * loopRadius),
      ));
    }

    return worldPath.map((point) => this.toParentLocalPoint(parent, point));
  }

  private recreateSelfLoopTube(
    edgeId: string,
    existingTube: BABYLON.Mesh,
    path: BABYLON.Vector3[],
    radius: number,
  ): BABYLON.Mesh {
    const replacement = BABYLON.MeshBuilder.CreateTube(existingTube.name, {
      path,
      radius,
      updatable: true,
    }, this.scene);

    replacement.material = existingTube.material;
    replacement.isPickable = existingTube.isPickable;
    replacement.alwaysSelectAsActiveMesh = existingTube.alwaysSelectAsActiveMesh;
    replacement.parent = existingTube.parent;
    (replacement as any).edgeData = (existingTube as any).edgeData;

    existingTube.dispose();
    this.edgeTubes.set(edgeId, replacement);
    return replacement;
  }

  private computeBidirectionalOffsetVector(
    edgeDirection: BABYLON.Vector3,
    isCrossFile: boolean,
    offsetSign: number,
  ): BABYLON.Vector3 {
    if (offsetSign === 0) {
      return BABYLON.Vector3.Zero();
    }

    // Build a stable perpendicular vector so reciprocal edges can be rendered
    // as separate parallel lines.
    let referenceUp = BABYLON.Axis.Y;
    if (Math.abs(BABYLON.Vector3.Dot(edgeDirection, referenceUp)) > 0.92) {
      referenceUp = BABYLON.Axis.X;
    }

    let lateral = BABYLON.Vector3.Cross(edgeDirection, referenceUp);
    if (!Number.isFinite(lateral.length()) || lateral.lengthSquared() < 0.000001) {
      lateral = BABYLON.Vector3.Cross(edgeDirection, BABYLON.Axis.Z);
    }
    if (!Number.isFinite(lateral.length()) || lateral.lengthSquared() < 0.000001) {
      return BABYLON.Vector3.Zero();
    }
    lateral.normalize();

    const baseOffset = isCrossFile
      ? Math.max(1.6, SceneConfig.EDGE_RADIUS * 4)
      : Math.max(1.0, SceneConfig.INTERNAL_EDGE_RADIUS * 10);
    return lateral.scale(baseOffset * offsetSign);
  }

  /**
   * Update edge positions and rotations to follow their connected nodes
   * Reuses cylinder meshes for performance - no recreation each frame
   * Called during render loop to keep edges attached to moving nodes
   * 
   * Uses batching to avoid RAF violations: processes EDGES_PER_FRAME edges per call,
   * cycling through all edges over multiple frames for smooth performance.
   */
  public updateEdges(force: boolean = false): void {
    if (!force && !this.edgesDirty) {
      return;
    }

    if (this.edgeTubes.size === 0) {
      this.edgesDirty = false;
      return;
    }

    if (this.nodeMeshes.size === 0) {
      for (const tube of this.edgeTubes.values()) {
        tube.setEnabled(false);
      }
      for (const arrow of this.edgeArrows.values()) {
        arrow.setEnabled(false);
      }
      for (const conduit of this.crossFileConduits.values()) {
        conduit.setEnabled(false);
      }
      for (const pair of this.crossFileConduitJunctions.values()) {
        pair.source.setEnabled(false);
        pair.target.setEnabled(false);
      }
      for (const pair of this.crossFileConduitLinkBoxes.values()) {
        pair.source.setEnabled(false);
        pair.target.setEnabled(false);
      }
      this.edgesDirty = true;
      return;
    }

    // Build per-frame collision samples once per file box parent.
    const collisionSampleCache = new Map<BABYLON.Node, Array<{
      mesh: BABYLON.Mesh;
      center: BABYLON.Vector3;
      radius: number;
    }>>();
    let hasMissingNodeReferences = false;

    // When force=true, process ALL edges at once (initialization)
    // When force=false, batch process EDGES_PER_FRAME edges per frame.
    // In static mode, same-file edges are frozen and skipped here.
    const edgeIds = Array.from(this.edgeTubes.keys()).filter((edgeId) => {
      if (force) {
        return true;
      }
      const metadata = this.edgeMetadata.get(edgeId);
      const isCrossFile = metadata?.isCrossFile ?? true;
      if (!isCrossFile && this.sameFileEdgesStatic) {
        return false;
      }
      if (isCrossFile && this.crossFileEdgesStatic) {
        return false;
      }
      return true;
    });

    if (edgeIds.length === 0) {
      this.edgesDirty = hasMissingNodeReferences;
      return;
    }

    let edgesToProcess: string[];
    
    if (force) {
      edgesToProcess = edgeIds;  // Process all edges
    } else {
      // Batch process: rotate through edges, processing EDGES_PER_FRAME per frame
      const batchSize = Math.min(MeshFactory.EDGES_PER_FRAME, edgeIds.length);
      edgesToProcess = [];
      for (let i = 0; i < batchSize; i++) {
        const index = (this.edgeBatchUpdateIndex + i) % edgeIds.length;
        edgesToProcess.push(edgeIds[index]);
      }
      this.edgeBatchUpdateIndex = (this.edgeBatchUpdateIndex + batchSize) % edgeIds.length;
    }

    for (const edgeId of edgesToProcess) {
      const cylinder = this.edgeTubes.get(edgeId);
      if (!cylinder) continue;

      const metadata = this.edgeMetadata.get(edgeId);
      if (!metadata) continue;

      // Get current node positions directly from meshes (always up-to-date after layout/repulsion)
      const sourceMesh = this.nodeMeshes.get(metadata.from);
      const targetMesh = this.nodeMeshes.get(metadata.to);

      if (!sourceMesh || !targetMesh) {
        hasMissingNodeReferences = true;
        cylinder.setEnabled(false);
        const arrow = this.edgeArrows.get(edgeId);
        if (arrow) {
          arrow.setEnabled(false);
        }
        continue;  // Skip if nodes not found
      }

      // Delegate to helper to process this single edge
      this.updateSingleEdge(
        edgeId,
        cylinder,
        metadata,
        sourceMesh,
        targetMesh,
        collisionSampleCache,
      );
    }

    const shouldUpdateCrossFileConduits = force || !this.crossFileEdgesStatic;
    // Cross-file conduits can be frozen after hub positioning has converged.
    if (shouldUpdateCrossFileConduits) {
      for (const [pairKey, conduit] of this.crossFileConduits.entries()) {
      const conduitMeta = this.crossFileConduitMetadata.get(pairKey);
      const junctions = this.crossFileConduitJunctions.get(pairKey);
      const linkBoxes = this.crossFileConduitLinkBoxes.get(pairKey);
      if (!conduitMeta) {
        conduit.setEnabled(false);
        if (junctions) {
          junctions.source.setEnabled(false);
          junctions.target.setEnabled(false);
        }
        if (linkBoxes) {
          linkBoxes.source.setEnabled(false);
          linkBoxes.target.setEnabled(false);
        }
        continue;
      }

      const sourceNode = this.nodeMeshes.get(conduitMeta.sourceNodeId);
      const targetNode = this.nodeMeshes.get(conduitMeta.targetNodeId);
      if (!sourceNode || !targetNode) {
        hasMissingNodeReferences = true;
        conduit.setEnabled(false);
        if (junctions) {
          junctions.source.setEnabled(false);
          junctions.target.setEnabled(false);
        }
        if (linkBoxes) {
          linkBoxes.source.setEnabled(false);
          linkBoxes.target.setEnabled(false);
        }
        continue;
      }

      // Delegate to helper to process this single conduit
      this.updateSingleConduit(
        pairKey,
        conduit,
        conduitMeta,
        sourceNode,
        targetNode,
        junctions,
        linkBoxes,
      );
    }
    }

    this.edgesDirty = hasMissingNodeReferences;
  }

  /** Process a single edge tube update (extracted for batching) */
  private updateSingleEdge(
    edgeId: string,
    cylinder: BABYLON.Mesh,
    metadata: {
      from: string;
      to: string;
      fromFile: string | null;
      toFile: string | null;
      isCrossFile: boolean;
      isSelfLoop: boolean;
      bidirectionalOffsetSign: number;
      targetsExternalLibrary: boolean;
      crossFilePairKey: string | null;
    },
    sourceMesh: BABYLON.Mesh,
    targetMesh: BABYLON.Mesh,
    collisionSampleCache: Map<BABYLON.Node, Array<{
      mesh: BABYLON.Mesh;
      center: BABYLON.Vector3;
      radius: number;
    }>>,
  ): void {
    const arrow = this.edgeArrows.get(edgeId);
    const edgeVisibility = this.getEdgeVisibilityFactor(metadata, sourceMesh, targetMesh);

    if (edgeVisibility <= 0.0001) {
      cylinder.setEnabled(false);
      if (arrow) {
        arrow.setEnabled(false);
      }
      return;
    }

    if (metadata.isSelfLoop) {
      const sourceCenterPos = sourceMesh.getAbsolutePosition().clone();
      const sourceRadius = sourceMesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 2.0;
      const loopPath = this.buildSelfLoopPath(cylinder.parent ?? null, sourceCenterPos, sourceRadius);
      const loopTubeRadius = metadata.isCrossFile
        ? Math.max(0.1, SceneConfig.EDGE_RADIUS * 0.65)
        : Math.max(0.08, SceneConfig.INTERNAL_EDGE_RADIUS * 1.2);

      let activeTube = cylinder;
      try {
        BABYLON.MeshBuilder.CreateTube(cylinder.name, {
          path: loopPath,
          radius: loopTubeRadius,
          updatable: true,
          instance: cylinder,
        }, this.scene);
      } catch {
        activeTube = this.recreateSelfLoopTube(edgeId, cylinder, loopPath, loopTubeRadius);
      }

      this.ensureMeshEnabled(activeTube);
      activeTube.visibility = edgeVisibility;

      if (arrow) {
        const loopRadius = Math.max(3.2, sourceRadius * 1.8);
        const loopLift = Math.max(2.6, sourceRadius * 1.4);
        const loopCenter = sourceCenterPos.add(new BABYLON.Vector3(0, loopLift, 0));
        const angle = -Math.PI / 3;
        const pointOnLoop = new BABYLON.Vector3(
          loopCenter.x + (Math.cos(angle) * loopRadius),
          loopCenter.y,
          loopCenter.z + (Math.sin(angle) * loopRadius),
        );
        const tangent = new BABYLON.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
        const arrowHalfHeight = arrow.getBoundingInfo().boundingBox.maximum.y;
        const arrowCenterWorld = pointOnLoop.subtract(tangent.scale(arrowHalfHeight));
        arrow.position = this.toParentLocalPoint(arrow.parent ?? null, arrowCenterWorld);

        const arrowQ = BABYLON.Quaternion.Identity();
        BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, tangent, arrowQ);
        arrow.rotationQuaternion = arrowQ;

        this.ensureMeshEnabled(arrow);
        arrow.visibility = edgeVisibility;
      }

      return;
    }

    // Get current positions (world space)
    const sourceCenterPos = sourceMesh.getAbsolutePosition().clone();
    const targetCenterPos = targetMesh.getAbsolutePosition().clone();

    // Calculate direction and distance
    const direction = targetCenterPos.subtract(sourceCenterPos);
    const distance = direction.length();

    if (distance < 0.001) {
      cylinder.setEnabled(false);  // Hide edge if nodes are at same position
      this.edgeArrows.get(edgeId)?.setEnabled(false);
      return;
    }

    // Use mesh half extents so edges can connect to any face (x/y/z).
    const sourceBoundingBox = sourceMesh.getBoundingInfo().boundingBox;
    const targetBoundingBox = targetMesh.getBoundingInfo().boundingBox;
    const sourceHalfExtents = {
      x: Math.max(0.1, (sourceBoundingBox.maximum.x - sourceBoundingBox.minimum.x) * 0.5),
      y: Math.max(0.1, (sourceBoundingBox.maximum.y - sourceBoundingBox.minimum.y) * 0.5),
      z: Math.max(0.1, (sourceBoundingBox.maximum.z - sourceBoundingBox.minimum.z) * 0.5),
    };
    const targetHalfExtents = {
      x: Math.max(0.1, (targetBoundingBox.maximum.x - targetBoundingBox.minimum.x) * 0.5),
      y: Math.max(0.1, (targetBoundingBox.maximum.y - targetBoundingBox.minimum.y) * 0.5),
      z: Math.max(0.1, (targetBoundingBox.maximum.z - targetBoundingBox.minimum.z) * 0.5),
    };

    // Normalize direction
    const normalizedDir = direction.normalize();
    const bidirectionalOffset = this.computeBidirectionalOffsetVector(
      normalizedDir,
      metadata.isCrossFile,
      metadata.bidirectionalOffsetSign,
    );
    const offsetSourcePos = sourceCenterPos.add(bidirectionalOffset);
    const offsetTargetPos = targetCenterPos.add(bidirectionalOffset);

    // Connect to the dominant axis face between source and target (no angle math).
    const delta = offsetTargetPos.subtract(offsetSourcePos);
    const absDx = Math.abs(delta.x);
    const absDy = Math.abs(delta.y);
    const absDz = Math.abs(delta.z);

    let sourceFaceOffset: BABYLON.Vector3;
    let targetFaceOffset: BABYLON.Vector3;
    if (absDx >= absDy && absDx >= absDz) {
      const sign = delta.x >= 0 ? 1 : -1;
      sourceFaceOffset = new BABYLON.Vector3(sign * sourceHalfExtents.x, 0, 0);
      targetFaceOffset = new BABYLON.Vector3(-sign * targetHalfExtents.x, 0, 0);
    } else if (absDy >= absDx && absDy >= absDz) {
      const sign = delta.y >= 0 ? 1 : -1;
      sourceFaceOffset = new BABYLON.Vector3(0, sign * sourceHalfExtents.y, 0);
      targetFaceOffset = new BABYLON.Vector3(0, -sign * targetHalfExtents.y, 0);
    } else {
      const sign = delta.z >= 0 ? 1 : -1;
      sourceFaceOffset = new BABYLON.Vector3(0, 0, sign * sourceHalfExtents.z);
      targetFaceOffset = new BABYLON.Vector3(0, 0, -sign * targetHalfExtents.z);
    }

    let edgeStartPos = offsetSourcePos.add(sourceFaceOffset);
    let edgeEndPos = offsetTargetPos.add(targetFaceOffset);

    // Get edge diameter from metadata/config
    const edgeKind = (cylinder as any).edgeKind ?? 'call';
    const edgeDiameter = edgeKind === 'var-write'
      ? SceneConfig.INTERNAL_EDGE_RADIUS * 3.0
      : edgeKind === 'var-read'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.2
      : edgeKind === 'new-call'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.6
      : edgeKind === 'extends' || edgeKind === 'implements'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.2
      : edgeKind === 'decorator' || edgeKind === 'enum-member-read'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.0
      : edgeKind === 'import' || edgeKind === 'import-cycle'
        ? SceneConfig.EDGE_RADIUS * 1.6
      : edgeKind === 'export' || edgeKind === 're-export'
        ? SceneConfig.EDGE_RADIUS * 1.4
      : edgeKind === 'type-import' || edgeKind === 'type-export'
        ? SceneConfig.EDGE_RADIUS * 1.2
      : edgeKind === 'module-augmentation'
        ? SceneConfig.EDGE_RADIUS * 1.3
      : edgeKind === 'type-ref' || edgeKind === 'type-constraint' || edgeKind === 'overload-of'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 1.2
        : metadata.isCrossFile
          ? SceneConfig.EDGE_RADIUS * 2
          : SceneConfig.INTERNAL_EDGE_RADIUS * 2;
    const edgeRadius = edgeDiameter * 0.5;

    const resolvedHubParents = this.resolveCrossFileHubParents(sourceMesh, targetMesh);
    const sourceParent = resolvedHubParents?.sourceParent ?? null;
    const targetParent = resolvedHubParents?.targetParent ?? null;
    const canBundleCrossFile = metadata.isCrossFile
      && !metadata.targetsExternalLibrary
      && !!sourceParent
      && !!targetParent
      && sourceParent !== targetParent;

    const pairMeta = metadata.crossFilePairKey
      ? this.crossFileConduitMetadata.get(metadata.crossFilePairKey)
      : null;
    const usesPairMeta = !!pairMeta && !!metadata.fromFile && !!metadata.toFile;
    const isForwardPairDirection = usesPairMeta
      && pairMeta!.sourceFile === metadata.fromFile
      && pairMeta!.targetFile === metadata.toFile;
    const sourceSlot = pairMeta
      ? (isForwardPairDirection ? pairMeta.sourceHubSlot : pairMeta.targetHubSlot)
      : 0;
    const sourceSlotCount = pairMeta
      ? (isForwardPairDirection ? pairMeta.sourceHubSlotCount : pairMeta.targetHubSlotCount)
      : 1;
    const targetSlot = pairMeta
      ? (isForwardPairDirection ? pairMeta.targetHubSlot : pairMeta.sourceHubSlot)
      : 0;
    const targetSlotCount = pairMeta
      ? (isForwardPairDirection ? pairMeta.targetHubSlotCount : pairMeta.sourceHubSlotCount)
      : 1;

    const crossFileHubs = canBundleCrossFile
      ? this.computeCrossFileHubPoints(
          sourceParent!,
          targetParent!,
          sourceSlot,
          sourceSlotCount,
          targetSlot,
          targetSlotCount,
        )
      : null;

    if (crossFileHubs) {
      edgeStartPos = this.computeMeshFacePointToward(sourceMesh, crossFileHubs.sourceHub);
      edgeEndPos = this.computeMeshFacePointToward(targetMesh, crossFileHubs.targetHub);
    }

    // Determine shared file box parent - only internal edges need collision avoidance
    const sharedFileBox = (sourceMesh.parent === targetMesh.parent) ? sourceMesh.parent : null;

    // Keep the tube ending at the arrow base so edges do not overlap cone tips.
    const edgeDirection = edgeEndPos.subtract(edgeStartPos).normalize();
    const arrowFullHeight = arrow
      ? arrow.getBoundingInfo().boundingBox.maximum.y * 2
      : 0;
    const tubeEndPos = arrow && arrowFullHeight > 0.001
      ? edgeEndPos.subtract(edgeDirection.scale(arrowFullHeight))
      : edgeEndPos;

    // Calculate collision-free waypoints (only for edges in the same file box)
    const collisionCandidates = sharedFileBox
      ? this.getCollisionSamplesForFileBox(sharedFileBox, collisionSampleCache)
      : [];
    const waypoints = crossFileHubs
      ? [edgeStartPos, crossFileHubs.sourceHub, crossFileHubs.targetHub, tubeEndPos]
      : sharedFileBox
      ? this.calculateCollisionAvoidanceWaypoints(
          edgeStartPos,
          tubeEndPos,
          edgeRadius,
          collisionCandidates,
          sourceMesh,
          targetMesh,
        )
      : [edgeStartPos, tubeEndPos];

    // Convert waypoints to local space relative to parent for tube creation
    const localWaypoints = waypoints.map((wp) => this.toParentLocalPoint(cylinder.parent ?? null, wp));

    // Update tube with new path
    const tubeRadius = Math.max(0.06, edgeDiameter * 0.5);
    let activeTube = cylinder;
    try {
      BABYLON.MeshBuilder.CreateTube(cylinder.name, {
        path: localWaypoints,
        radius: tubeRadius,
        updatable: true,
        instance: cylinder,
      }, this.scene);
    } catch {
      // If tube update fails, recreate the tube and continue with the replacement.
      cylinder.dispose();
      const newTube = BABYLON.MeshBuilder.CreateTube(cylinder.name, {
        path: localWaypoints,
        radius: tubeRadius,
        updatable: true,
      }, this.scene);
      newTube.material = cylinder.material;
      newTube.isPickable = true;
      newTube.alwaysSelectAsActiveMesh = true;
      newTube.renderingGroupId = 1;
      (newTube as any).edgeData = (cylinder as any).edgeData;
      (newTube as any).edgeKind = (cylinder as any).edgeKind;
      if (cylinder.parent) {
        newTube.parent = cylinder.parent;
      }
      this.edgeTubes.set(edgeId, newTube);
      activeTube = newTube;
    }

    // Ensure tube is visible
    this.ensureMeshEnabled(activeTube);
    activeTube.visibility = edgeVisibility;

    // Position and orient arrowhead at the target surface
    if (arrow) {
      const arrowHalfHeight = arrowFullHeight / 2;
      // Place cone center so its tip (+Y) sits exactly at edgeEndPos
      const arrowCenterWorld = edgeEndPos.subtract(edgeDirection.scale(arrowHalfHeight));

      if (arrow.parent) {
        const parentMatrix = (arrow.parent as BABYLON.TransformNode).getWorldMatrix().clone();
        const inverseParentMatrix = BABYLON.Matrix.Invert(parentMatrix);
        arrow.position = BABYLON.Vector3.TransformCoordinates(arrowCenterWorld, inverseParentMatrix);
      } else {
        arrow.position = arrowCenterWorld;
      }

      // Same rotation as the cylinder: align Y-axis to edge direction
      const arrowQ = BABYLON.Quaternion.Identity();
      BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, edgeDirection, arrowQ);
      arrow.rotationQuaternion = arrowQ;

      this.ensureMeshEnabled(arrow);
      arrow.visibility = edgeVisibility;
    }
  }

  /** Process a single conduit update (cross-file edge bundle) */
  private updateSingleConduit(
    pairKey: string,
    conduit: BABYLON.Mesh,
    conduitMeta: {
      sourceNodeId: string;
      targetNodeId: string;
      sourceFile: string;
      targetFile: string;
      edgeCount: number;
      sourceHubSlot: number;
      sourceHubSlotCount: number;
      targetHubSlot: number;
      targetHubSlotCount: number;
    },
    sourceNode: BABYLON.Mesh,
    targetNode: BABYLON.Mesh,
    junctions: { source: BABYLON.Mesh; target: BABYLON.Mesh } | null | undefined,
    linkBoxes: { source: BABYLON.Mesh; target: BABYLON.Mesh } | null | undefined,
  ): void {
    const resolvedHubParents = this.resolveCrossFileHubParents(sourceNode, targetNode);
    const sourceParent = resolvedHubParents?.sourceParent ?? null;
    const targetParent = resolvedHubParents?.targetParent ?? null;
    if (!sourceParent || !targetParent || sourceParent === targetParent) {
      conduit.setEnabled(false);
      if (junctions) {
        junctions.source.setEnabled(false);
        junctions.target.setEnabled(false);
      }
      if (linkBoxes) {
        linkBoxes.source.setEnabled(false);
        linkBoxes.target.setEnabled(false);
      }
      return;
    }

    const hubs = this.computeCrossFileHubPoints(
      sourceParent,
      targetParent,
      conduitMeta.sourceHubSlot,
      conduitMeta.sourceHubSlotCount,
      conduitMeta.targetHubSlot,
      conduitMeta.targetHubSlotCount,
    );
    const localPath = [
      this.toParentLocalPoint(conduit.parent ?? null, hubs.sourceHub),
      this.toParentLocalPoint(conduit.parent ?? null, hubs.targetHub),
    ];

    const conduitRadius = this.computeConduitRadius(conduitMeta.edgeCount);
    let activeConduit = conduit;
    try {
      BABYLON.MeshBuilder.CreateTube(conduit.name, {
        path: localPath,
        radius: conduitRadius,
        updatable: true,
        instance: conduit,
      }, this.scene);
    } catch {
      conduit.dispose();
      const replacement = BABYLON.MeshBuilder.CreateTube(conduit.name, {
        path: localPath,
        radius: conduitRadius,
        updatable: true,
      }, this.scene);
      replacement.material = conduit.material;
      replacement.isPickable = false;
      replacement.alwaysSelectAsActiveMesh = true;
      replacement.renderingGroupId = 1;
      if (conduit.parent) {
        replacement.parent = conduit.parent;
      }
      (replacement as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (replacement as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        endpoint: 'bundle',
      };
      this.crossFileConduits.set(pairKey, replacement);
      activeConduit = replacement;
    }

    (activeConduit as any).edgeData = {
      from: conduitMeta.sourceNodeId,
      to: conduitMeta.targetNodeId,
    };
    (activeConduit as any).hubData = {
      sourceNodeId: conduitMeta.sourceNodeId,
      targetNodeId: conduitMeta.targetNodeId,
      sourceFile: conduitMeta.sourceFile,
      targetFile: conduitMeta.targetFile,
      sourceHubWorld: hubs.sourceHub.clone(),
      targetHubWorld: hubs.targetHub.clone(),
      endpoint: 'bundle',
    };

    this.ensureMeshEnabled(activeConduit);
    activeConduit.visibility = 1.0;

    if (junctions) {
      (junctions.source as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (junctions.source as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.targetNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        sourceHubWorld: hubs.sourceHub.clone(),
        targetHubWorld: hubs.targetHub.clone(),
        endpoint: 'source',
      };
      (junctions.target as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (junctions.target as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.sourceNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        sourceHubWorld: hubs.sourceHub.clone(),
        targetHubWorld: hubs.targetHub.clone(),
        endpoint: 'target',
      };

      const direction = hubs.targetHub.subtract(hubs.sourceHub);
      const directionLength = direction.length();
      const normalized = directionLength > 0.0001
        ? direction.scale(1 / directionLength)
        : BABYLON.Axis.Y;
      const junctionRadius = this.computeConduitJunctionRadius(conduitRadius);
      const junctionHeight = this.computeConduitJunctionHeight(conduitRadius);
      const junctionScale = new BABYLON.Vector3(junctionRadius, junctionHeight, junctionRadius);

      junctions.source.position = this.toParentLocalPoint(junctions.source.parent ?? null, hubs.sourceHub);
      junctions.target.position = this.toParentLocalPoint(junctions.target.parent ?? null, hubs.targetHub);
      junctions.source.scaling = junctionScale.clone();
      junctions.target.scaling = junctionScale.clone();

      const q = BABYLON.Quaternion.Identity();
      BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, normalized, q);
      junctions.source.rotationQuaternion = q.clone();
      junctions.target.rotationQuaternion = q.clone();

      this.ensureMeshEnabled(junctions.source);
      this.ensureMeshEnabled(junctions.target);
      junctions.source.visibility = 1.0;
      junctions.target.visibility = 1.0;
    }

    if (linkBoxes) {
      (linkBoxes.source as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (linkBoxes.source as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.targetNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        sourceHubWorld: hubs.sourceHub.clone(),
        targetHubWorld: hubs.targetHub.clone(),
        endpoint: 'source',
      };
      (linkBoxes.target as any).edgeData = {
        from: conduitMeta.sourceNodeId,
        to: conduitMeta.targetNodeId,
      };
      (linkBoxes.target as any).hubData = {
        sourceNodeId: conduitMeta.sourceNodeId,
        targetNodeId: conduitMeta.targetNodeId,
        navigationNodeId: conduitMeta.sourceNodeId,
        sourceFile: conduitMeta.sourceFile,
        targetFile: conduitMeta.targetFile,
        sourceHubWorld: hubs.sourceHub.clone(),
        targetHubWorld: hubs.targetHub.clone(),
        endpoint: 'target',
      };

      linkBoxes.source.position = this.toParentLocalPoint(linkBoxes.source.parent ?? null, hubs.sourceHub);
      linkBoxes.target.position = this.toParentLocalPoint(linkBoxes.target.parent ?? null, hubs.targetHub);
      this.ensureMeshEnabled(linkBoxes.source);
      this.ensureMeshEnabled(linkBoxes.target);
      linkBoxes.source.visibility = 1.0;
      linkBoxes.target.visibility = 1.0;
    }
  }

  private getCollisionSamplesForFileBox(
    fileBoxParent: BABYLON.Node,
    cache: Map<BABYLON.Node, Array<{ mesh: BABYLON.Mesh; center: BABYLON.Vector3; radius: number }>>,
  ): Array<{ mesh: BABYLON.Mesh; center: BABYLON.Vector3; radius: number }> {
    const cached = cache.get(fileBoxParent);
    if (cached) {
      return cached;
    }

    const samples: Array<{ mesh: BABYLON.Mesh; center: BABYLON.Vector3; radius: number }> = [];
    const children = fileBoxParent.getChildren() as BABYLON.Mesh[];
    for (const mesh of children) {
      if (!mesh || !mesh.isVisible || !mesh.name || !mesh.name.startsWith('func_')) {
        continue;
      }

      const bounds = mesh.getBoundingInfo()?.boundingSphere;
      const radius = Math.max(0.25, bounds?.radiusWorld ?? 0.5);
      samples.push({
        mesh,
        center: mesh.getAbsolutePosition().clone(),
        radius,
      });
    }

    cache.set(fileBoxParent, samples);
    return samples;
  }

  private ensureMeshEnabled(mesh: BABYLON.Mesh): void {
    const isEnabledMember = (mesh as any).isEnabled;
    const isCurrentlyEnabled = typeof isEnabledMember === 'function'
      ? isEnabledMember.call(mesh)
      : typeof isEnabledMember === 'boolean'
        ? isEnabledMember
        : true;

    if (!isCurrentlyEnabled) {
      mesh.setEnabled(true);
    }
  }

  private isMeshRenderable(mesh: BABYLON.Mesh | null | undefined): boolean {
    if (!mesh) {
      return false;
    }

    if ((mesh as any).isVisible === false) {
      return false;
    }

    const isEnabledMember = (mesh as any).isEnabled;
    if (typeof isEnabledMember === 'function') {
      return !!isEnabledMember.call(mesh);
    }
    if (typeof isEnabledMember === 'boolean') {
      return isEnabledMember;
    }
    return true;
  }

  /**
   * Shorten a file path to maxLen characters, preserving the filename.
   */
  private shortenFilePath(filePath: string, maxLen: number): string {
    if (filePath.length <= maxLen) return filePath;
    const parts = filePath.split('/');
    const filename = parts[parts.length - 1];
    if (filename.length >= maxLen - 1) {
      return '\u2026' + filename.slice(-(maxLen - 1));
    }
    let i = 1;
    let result = filePath;
    while (result.length > maxLen && i < parts.length - 1) {
      result = '\u2026/' + parts.slice(i).join('/');
      i++;
    }
    return result.length <= maxLen ? result : '\u2026' + filePath.slice(-(maxLen - 1));
  }

  /**
   * Create a small billboard plane label positioned at a conduit hub point,
   * showing the name of the file on the far end of the conduit.
   */
  private createFileLinkBoxMesh(
    name: string,
    referencedFile: string,
    fileColor: BABYLON.Color3,
    sceneRoot?: BABYLON.TransformNode,
  ): BABYLON.Mesh {
    const texW = 512;
    const texH = 128;
    const texture = new BABYLON.DynamicTexture(`${name}_tex`, { width: texW, height: texH }, this.scene, false);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const r = Math.round(Math.min(255, fileColor.r * 220 + 18));
    const g = Math.round(Math.min(255, fileColor.g * 220 + 18));
    const b = Math.round(Math.min(255, fileColor.b * 220 + 18));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.88)`;
    ctx.fillRect(0, 0, texW, texH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, texW - 6, texH - 6);
    ctx.font = 'bold 28px Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.shortenFilePath(referencedFile, 32), texW / 2, texH / 2);
    texture.update();

    const mat = new BABYLON.StandardMaterial(`${name}_mat`, this.scene);
    mat.diffuseTexture = texture;
    mat.emissiveColor = new BABYLON.Color3(
      Math.min(1, fileColor.r * 0.5 + 0.25),
      Math.min(1, fileColor.g * 0.5 + 0.25),
      Math.min(1, fileColor.b * 0.5 + 0.25),
    );
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mat.alpha = 0.92;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    this.edgeMaterials.add(mat);

    const plane = BABYLON.MeshBuilder.CreatePlane(name, { width: 10.0, height: 2.8 }, this.scene);
    plane.material = mat;
    plane.isPickable = true;
    plane.alwaysSelectAsActiveMesh = true;
    plane.renderingGroupId = 2;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    if (sceneRoot) {
      plane.parent = sceneRoot;
    }
    return plane;
  }

  private getEdgeVisibilityFactor(
    metadata: {
      from: string;
      to: string;
      fromFile: string | null;
      toFile: string | null;
      isCrossFile: boolean;
      isSelfLoop: boolean;
      bidirectionalOffsetSign: number;
      targetsExternalLibrary: boolean;
      crossFilePairKey: string | null;
    },
    sourceMesh: BABYLON.Mesh,
    targetMesh: BABYLON.Mesh,
  ): number {
    void metadata;

    // If either endpoint is hidden/disabled (for example module anchors),
    // hide the connected edge so it cannot appear as a dangling connection.
    if (!this.isMeshRenderable(sourceMesh) || !this.isMeshRenderable(targetMesh)) {
      return 0.0;
    }

    return 1.0;
  }

  private extractFilePathFromNodeId(nodeId: string): string | null {
    const atIndex = nodeId.lastIndexOf('@');
    if (atIndex >= 0 && atIndex < nodeId.length - 1) {
      return nodeId.slice(atIndex + 1);
    }

    if (nodeId.startsWith('html:')) {
      return nodeId.slice('html:'.length);
    }

    return null;
  }

  /**
   * Calculate waypoints for edges within the same file box to avoid collisions with sibling function boxes.
   * Only checks boxes that are children of the shared file box parent.
   * Cross-file edges skip this (they don't share a parent).
   */
  private calculateCollisionAvoidanceWaypoints(
    startPos: BABYLON.Vector3,
    endPos: BABYLON.Vector3,
    edgeRadius: number,
    collisionCandidates: Array<{ mesh: BABYLON.Mesh; center: BABYLON.Vector3; radius: number }>,
    sourceMesh?: BABYLON.Mesh,
    targetMesh?: BABYLON.Mesh,
  ): BABYLON.Vector3[] {
    // Early exit: very short edges unlikely to collide
    const edgeLength = BABYLON.Vector3.Distance(startPos, endPos);
    if (edgeLength < 2.0) {
      return [startPos, endPos];
    }

    if (collisionCandidates.length === 0) {
      return [startPos, endPos];
    }

    const waypoints: BABYLON.Vector3[] = [startPos];
    const edgeDirection = endPos.subtract(startPos).normalize();

    // Check for collisions with sibling boxes only
    const collisionBoxes: Array<{ mesh: BABYLON.Mesh; distance: number }> = [];

    for (const candidate of collisionCandidates) {
      const mesh = candidate.mesh;
      if (mesh === sourceMesh || mesh === targetMesh) {
        continue;
      }
      const boxCenter = candidate.center;
      const boxRadius = candidate.radius + edgeRadius + 0.3;

      // Project box center onto edge line
      const toBox = boxCenter.subtract(startPos);
      const projectionLength = BABYLON.Vector3.Dot(toBox, edgeDirection);

      // Skip if box is completely before/after the edge segment
      if (projectionLength < -boxRadius || projectionLength > edgeLength + boxRadius) {
        continue;
      }

      // Check distance from edge line to box center
      const closestPointOnEdge = startPos.add(edgeDirection.scale(
        BABYLON.Scalar.Clamp(projectionLength, 0, edgeLength)
      ));
      const distanceToBox = BABYLON.Vector3.Distance(closestPointOnEdge, boxCenter);

      if (distanceToBox < boxRadius) {
        collisionBoxes.push({ mesh, distance: projectionLength });
      }
    }

    if (collisionBoxes.length === 0) {
      waypoints.push(endPos);
      return waypoints;
    }

    // Sort and add waypoints to route around boxes.
    // Cap waypoint count to avoid excessive per-edge path complexity.
    collisionBoxes.sort((a, b) => a.distance - b.distance);
    const MAX_COLLISION_WAYPOINTS = 2;

    for (const { mesh } of collisionBoxes.slice(0, MAX_COLLISION_WAYPOINTS)) {
      const sample = collisionCandidates.find((c) => c.mesh === mesh);
      const boxCenter = sample?.center ?? mesh.getAbsolutePosition();
      const boxRadius = (sample?.radius ?? (mesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0.5)) + edgeRadius + 0.5;

      // Build perpendicular offset direction
      let offsetDir = BABYLON.Axis.X;
      if (Math.abs(BABYLON.Vector3.Dot(edgeDirection, offsetDir)) > 0.9) {
        offsetDir = BABYLON.Axis.Y;
      }

      let sideDir = BABYLON.Vector3.Cross(edgeDirection, offsetDir).normalize();
      if (!Number.isFinite(sideDir.length()) || sideDir.lengthSquared() < 0.001) {
        sideDir = BABYLON.Vector3.Cross(edgeDirection, BABYLON.Axis.Z).normalize();
      }

      waypoints.push(boxCenter.add(sideDir.scale(boxRadius * 1.2)));
    }

    waypoints.push(endPos);
    return waypoints;
  }

}
