import * as BABYLON from '@babylonjs/core';
import { MeshFactory } from './MeshFactory';
import type { GraphNode, GraphEdge } from './types';

/**
 * GraphRenderer manages visual mesh creation and updates for nodes, edges, boxes, and labels
 */
export class GraphRenderer {
  private scene: BABYLON.Scene;
  private sceneRoot: BABYLON.TransformNode;
  private meshFactory: MeshFactory;

  private nodeMeshMap: Map<string, BABYLON.Mesh> = new Map();
  private fileBoxMeshes: Map<string, BABYLON.Mesh> = new Map();
  private directoryBoxMeshes: Map<string, BABYLON.Mesh> = new Map();
  private fileBoxLabels: Map<string, BABYLON.Mesh> = new Map();
  private directoryBoxLabels: Map<string, BABYLON.Mesh> = new Map();

  // Track edges during rendering
  private lastFileBoxScales: Map<string, BABYLON.Vector3> = new Map();
  private lastDirectoryBoxScales: Map<string, BABYLON.Vector3> = new Map();

  constructor(scene: BABYLON.Scene, sceneRoot: BABYLON.TransformNode, meshFactory: MeshFactory) {
    this.scene = scene;
    this.sceneRoot = sceneRoot;
    this.meshFactory = meshFactory;
  }

  /**
   * Clear all scene meshes and reinitialize
   */
  public clearScene(): void {
    // Dispose all node meshes
    for (const mesh of this.nodeMeshMap.values()) {
      mesh.dispose(false, true);
    }
    this.nodeMeshMap.clear();
    this.meshFactory.clearNodeReferences();

    // Dispose all edge meshes
    this.meshFactory.clearEdges();

    // Dispose all file box outlines
    for (const mesh of this.fileBoxMeshes.values()) {
      mesh.dispose(false, true);
    }
    this.fileBoxMeshes.clear();

    // Dispose all directory box outlines
    for (const mesh of this.directoryBoxMeshes.values()) {
      mesh.dispose(false, true);
    }
    this.directoryBoxMeshes.clear();

    // Dispose labels
    for (const mesh of this.fileBoxLabels.values()) {
      mesh.dispose(false, true);
    }
    this.fileBoxLabels.clear();

    for (const mesh of this.directoryBoxLabels.values()) {
      mesh.dispose(false, true);
    }
    this.directoryBoxLabels.clear();

    this.lastFileBoxScales.clear();
    this.lastDirectoryBoxScales.clear();
  }

  /**
   * Render file boxes (wireframe containers for nodes)
   */
  public renderFileBoxes(fileBoxDimensions: Map<string, BABYLON.Vector3>): void {
    for (const [file, dims] of fileBoxDimensions) {
      if (this.fileBoxMeshes.has(file)) continue; // Already exists

      const box = BABYLON.MeshBuilder.CreateBox(
        `filebox_${file}`,
        { size: 1 },
        this.scene,
      );
      box.parent = this.sceneRoot;
      box.isPickable = true;
      box.scaling = dims.clone();

      // Wireframe material
      const mat = new BABYLON.StandardMaterial(`filebox_mat_${file}`, this.scene);
      mat.wireframe = true;
      mat.alpha = 0.18;
      mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      mat.needDepthPrePass = true;
      mat.disableDepthWrite = true;
      mat.emissiveColor = new BABYLON.Color3(0.4, 0.6, 0.8);
      box.material = mat;

      this.fileBoxMeshes.set(file, box);
      this.lastFileBoxScales.set(file, dims.clone());
    }
  }

  /**
   * Render directory boxes (grouped file containers)
   */
  public renderDirectoryBoxes(directoryBoxDimensions: Map<string, { position: BABYLON.Vector3; scaling: BABYLON.Vector3 }>): void {
    for (const [dirPath, { position, scaling }] of directoryBoxDimensions) {
      if (this.directoryBoxMeshes.has(dirPath)) {
        const existing = this.directoryBoxMeshes.get(dirPath)!;
        existing.position.copyFrom(position);
        existing.scaling.copyFrom(scaling);
        continue;
      }

      const box = BABYLON.MeshBuilder.CreateBox(
        `dirbox_${dirPath}`,
        { size: 1 },
        this.scene,
      );
      box.parent = this.sceneRoot;
      box.position.copyFrom(position);
      box.scaling.copyFrom(scaling);
      box.isPickable = false;

      const mat = new BABYLON.StandardMaterial(`dirbox_mat_${dirPath}`, this.scene);
      mat.wireframe = true;
      mat.alpha = 0.08;
      mat.emissiveColor = new BABYLON.Color3(0.3, 0.5, 0.7);
      box.material = mat;

      this.directoryBoxMeshes.set(dirPath, box);
    }
  }

  /**
   * Render node meshes for all graph nodes
   */
  public renderNodes(
    nodes: GraphNode[],
    nodePositions: Map<string, BABYLON.Vector3>,
    fileColorMap: Map<string, BABYLON.Color3>,
    onNodeCreated?: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void,
  ): void {
    let renderCount = 0;

    for (const node of nodes) {
      if (this.nodeMeshMap.has(node.id)) continue; // Already rendered

      const position = nodePositions.get(node.id) || BABYLON.Vector3.Zero();
      const color = fileColorMap.get(node.file || 'external') || new BABYLON.Color3(0.7, 0.7, 0.7);

      // Create node mesh via factory
      this.meshFactory.createNodeMesh(node, position, color, 0, (mesh, material) => {
        this.nodeMeshMap.set(node.id, mesh);
        mesh.parent = this.sceneRoot;
        mesh.position = position.clone();

        if (onNodeCreated) {
          onNodeCreated(mesh, material, node);
        }

        renderCount++;
      });
    }

    console.log(`📦 Rendered nodes: ${renderCount}`);
  }

  /**
   * Render edges between nodes
   */
  public renderEdges(
    edges: GraphEdge[],
    nodeMeshMap: Map<string, BABYLON.Mesh>,
    _currentEdgeKinds: Map<string, GraphEdge['kind']>,
  ): void {
    // Edge rendering delegated to MeshFactory.createEdges() which is called
    // with full graph data from VRSceneManager - this method is a placeholder
    // for the rendering interface
    const edgeData = edges.map(e => ({
      from: e.from,
      to: e.to,
      kind: e.kind || 'call' as const,
    }));

    if (edgeData.length > 0 && nodeMeshMap.size > 0) {
      // Edges will be rendered via parent service
      console.log(`📊 Prepared ${edgeData.length} edges for rendering`);
    }
  }

  /**
   * Create a label for a file box
   */
  public createFileBoxLabel(
    file: string,
    box: BABYLON.Mesh,
  ): BABYLON.Mesh | null {
    const labelTexture = new BABYLON.DynamicTexture(`label_${file}`, 512, this.scene, true);
    const ctx = labelTexture.getContext() as CanvasRenderingContext2D;

    // Draw label background and text
    ctx.fillStyle = 'rgba(40, 60, 80, 0.9)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(file, 256, 64);
    labelTexture.update();

    // Create label plane
    const labelPlane = BABYLON.MeshBuilder.CreatePlane(
      `label_plane_${file}`,
      { width: 4, height: 1 },
      this.scene,
    );
    labelPlane.parent = this.sceneRoot;
    labelPlane.position.copyFrom(box.position);
    labelPlane.position.y += box.scaling.y * 0.5 + 1;

    const labelMat = new BABYLON.StandardMaterial(`label_mat_${file}`, this.scene);
    labelMat.emissiveTexture = labelTexture;
    labelMat.disableLighting = true;
    labelMat.backFaceCulling = false;
    labelPlane.material = labelMat;

    this.fileBoxLabels.set(file, labelPlane);
    return labelPlane;
  }

  /**
   * Update transforms of all labels to follow boxes
   */
  public updateLabelTransforms(): void {
    for (const [file, label] of this.fileBoxLabels) {
      const box = this.fileBoxMeshes.get(file);
      if (!box) continue;

      label.position.copyFrom(box.position);
      label.position.y += box.scaling.y * 0.5 + 1;
    }

    for (const [dir, label] of this.directoryBoxLabels) {
      const box = this.directoryBoxMeshes.get(dir);
      if (!box) continue;

      label.position.copyFrom(box.position);
      label.position.y += box.scaling.y * 0.5 + 1;
    }
  }

  /**
   * Get or create mesh map
   */
  public getNodeMeshMap(): Map<string, BABYLON.Mesh> {
    return this.nodeMeshMap;
  }

  public getFileBoxMeshes(): Map<string, BABYLON.Mesh> {
    return this.fileBoxMeshes;
  }

  public getDirectoryBoxMeshes(): Map<string, BABYLON.Mesh> {
    return this.directoryBoxMeshes;
  }

  /**
   * Populate current edge list
   */
  public populateCurrentEdges(edges: GraphEdge[]): Map<string, GraphEdge['kind']> {
    const edgeKinds = new Map<string, GraphEdge['kind']>();
    for (const edge of edges) {
      const key = `${edge.from}→${edge.to}`;
      edgeKinds.set(key, edge.kind ?? 'call');
    }
    return edgeKinds;
  }

  /**
   * Auto-size file boxes based on node layout
   */
  public autosizeFileBoxes(
    _fileNodeCounts: Map<string, number>,
    nodeGroupBounds: Map<string, { min: BABYLON.Vector3; max: BABYLON.Vector3 }>,
  ): Map<string, BABYLON.Vector3> {
    const dimensions = new Map<string, BABYLON.Vector3>();

    for (const [file, bounds] of nodeGroupBounds) {
      const size = bounds.max.subtract(bounds.min);
      const padding = 4.0;
      const scaledSize = new BABYLON.Vector3(
        Math.max(8, size.x + padding),
        Math.max(8, size.y + padding),
        Math.max(8, size.z + padding),
      );
      dimensions.set(file, scaledSize);
    }

    return dimensions;
  }
}
