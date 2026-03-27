/**
 * Factory for creating and managing 3D mesh representations of code entities
 */
import * as BABYLON from '@babylonjs/core';
import type { GraphNode } from './types';
import { SceneConfig } from './SceneConfig';

export class MeshFactory {
  private scene: BABYLON.Scene;
  private nodeMeshes: Map<string, BABYLON.Mesh> = new Map();  // Track meshes for raycasting
  private edgeTubes: Map<string, BABYLON.Mesh> = new Map();   // Simple tube storage
  private edgeMetadata: Map<string, { from: string; to: string; isCrossFile: boolean }> = new Map();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
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
    } else if (node.type === 'variable') {
      this.createVariableMesh(node, position, onNodeInteraction);
    } else {
      this.createFunctionMesh(node, position, fileColor, indegree, onNodeInteraction);
    }
  }

  /**
   * Create an external module cylinder mesh
   */
  private createExternalModuleMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const cylinder = BABYLON.MeshBuilder.CreateCylinder(
      `ext_${node.id}`,
      {
        height: SceneConfig.EXTERNAL_CYLINDER_HEIGHT,
        diameterTop: SceneConfig.EXTERNAL_CYLINDER_DIAMETER,
        diameterBottom: SceneConfig.EXTERNAL_CYLINDER_DIAMETER,
      },
      this.scene
    );
    cylinder.position = position;
    cylinder.isPickable = true;

    const material = new BABYLON.StandardMaterial(`extMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15);  // Subtle gray
    material.wireframe = false;
    cylinder.material = material;

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, cylinder);

    this.createLabel(node.name, cylinder as BABYLON.Mesh);
    onNodeInteraction(cylinder as BABYLON.Mesh, material, node);
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
    // Keep both exported and internal function boxes large enough to see.
    const boxSize = node.isExported
      ? Math.max(6.0, SceneConfig.FUNCTION_BOX_SIZE)
      : Math.max(1.0, SceneConfig.FUNCTION_BOX_SIZE);

    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: boxSize }, this.scene);
    box.position = position;
    box.isPickable = true;

    const material = new BABYLON.StandardMaterial(`mat_${node.id}`, this.scene);

    // Use a solid base on the cube and render signature text as planes on each face.
    // This avoids inconsistent UV orientation across cube faces.
    material.diffuseColor = fileColor
      ? new BABYLON.Color3(
        0.35 + (fileColor.r * 0.35),
        0.35 + (fileColor.g * 0.35),
        0.35 + (fileColor.b * 0.35)
      )
      : new BABYLON.Color3(0.6, 0.6, 0.6);
    
    // Subtle emissive glow based on file color
    if (fileColor) {
      material.emissiveColor = new BABYLON.Color3(
        fileColor.r * 0.1,
        fileColor.g * 0.1,
        fileColor.b * 0.1
      );
    } else {
      material.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    }
    
    material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    material.specularPower = 16;
    material.wireframe = false;
    
    // Exported functions are highlighted; internal functions remain visible.
    if (node.isExported) {
      material.alpha = 1.0;
      material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      material.disableLighting = false;
      material.emissiveColor = new BABYLON.Color3(0.22, 0.22, 0.22);
      box.isVisible = true;
      box.setEnabled(true);
    } else {
      material.alpha = 1.0;
      material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      material.disableLighting = false;
      if (fileColor) {
        material.emissiveColor = new BABYLON.Color3(
          0.08 + (fileColor.r * 0.10),
          0.08 + (fileColor.g * 0.10),
          0.08 + (fileColor.b * 0.10)
        );
      } else {
        material.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.12);
      }
      box.isVisible = true;
      box.setEnabled(true);
    }

    box.material = material;

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, box);

    this.createFunctionFaceDescriptionPlanes(node, box, fileColor, boxSize);

    onNodeInteraction(box as BABYLON.Mesh, material, node);
  }

  /**
   * Create one description plane per face so text orientation is controlled
   * explicitly instead of relying on cube UV orientation.
   */
  private createFunctionFaceDescriptionPlanes(
    node: GraphNode,
    parentBox: BABYLON.Mesh,
    _fileColor: BABYLON.Color3 | null,
    boxSize: number
  ): void {
    // Single texture shared across all faces — each plane is placed facing
    // outward and uses backFaceCulling=true so it's only visible from the
    // outside.  No per-face texture flip is needed because the UV layout is
    // aligned correctly for each outward-facing orientation.
    // Keep most of the face transparent so the cube's base color remains visible.
    const texture = this.createSignatureTexture(node, null);
    const half = boxSize / 2;
    const offset = half + 0.02;
    const planeSize = boxSize;

    const faces: Array<{ suffix: string; position: BABYLON.Vector3; rotation: BABYLON.Vector3 }> = [
      {
        suffix: 'front',
        position: new BABYLON.Vector3(0, 0, offset),
        rotation: new BABYLON.Vector3(0, 0, 0),
      },
      {
        suffix: 'back',
        position: new BABYLON.Vector3(0, 0, -offset),
        rotation: new BABYLON.Vector3(0, Math.PI, 0),
      },
      {
        suffix: 'right',
        position: new BABYLON.Vector3(offset, 0, 0),
        rotation: new BABYLON.Vector3(0, Math.PI / 2, 0),
      },
      {
        suffix: 'left',
        position: new BABYLON.Vector3(-offset, 0, 0),
        rotation: new BABYLON.Vector3(0, -Math.PI / 2, 0),
      },
      {
        suffix: 'top',
        position: new BABYLON.Vector3(0, offset, 0),
        rotation: new BABYLON.Vector3(-Math.PI / 2, 0, Math.PI),
      },
      {
        suffix: 'bottom',
        position: new BABYLON.Vector3(0, -offset, 0),
        rotation: new BABYLON.Vector3(Math.PI / 2, 0, 0),
      },
    ];

    for (const face of faces) {
      const labelPlane = BABYLON.MeshBuilder.CreatePlane(
        `func_label_${node.id}_${face.suffix}`,
        { width: planeSize, height: planeSize, sideOrientation: BABYLON.Mesh.BACKSIDE },
        this.scene
      );
      labelPlane.parent = parentBox;
      labelPlane.position = face.position;
      labelPlane.rotation = face.rotation;
      labelPlane.isPickable = false;

      const labelMaterial = new BABYLON.StandardMaterial(`func_label_mat_${node.id}_${face.suffix}`, this.scene);
      labelMaterial.diffuseTexture = texture;
      labelMaterial.emissiveTexture = texture;
      labelMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
      labelMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9);
      labelMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
      // Cull back faces so we only see the intended front of each label.
      labelMaterial.backFaceCulling = true;
      labelMaterial.disableLighting = true;
      labelPlane.material = labelMaterial;
    }
  }

  /**
   * Create a dynamic texture with function signature information
   */
  private createSignatureTexture(node: GraphNode, backgroundColor: BABYLON.Color3 | null = null): BABYLON.DynamicTexture {
    const textureSize = SceneConfig.SIGNATURE_TEXTURE_SIZE;
    const dynamicTexture = new BABYLON.DynamicTexture(
      `signatureTexture_${node.id}`,
      textureSize,
      this.scene
    );
    dynamicTexture.hasAlpha = false;
    const ctx = dynamicTexture.getContext() as any;

    // BACKSIDE orientation makes the visible label side horizontally mirrored;
    // pre-flip the canvas so rendered text reads forward in-world.
    ctx.save();
    ctx.translate(textureSize, 0);
    ctx.scale(-1, 1);

    // Use an opaque dark plaque background to keep label rendering stable.
    if (backgroundColor) {
      const r = Math.floor(backgroundColor.r * 255);
      const g = Math.floor(backgroundColor.g * 255);
      const b = Math.floor(backgroundColor.b * 255);
      ctx.fillStyle = `rgb(${Math.max(0, r - 120)}, ${Math.max(0, g - 120)}, ${Math.max(0, b - 120)})`;
    } else {
      ctx.fillStyle = 'rgb(22, 22, 22)';
    }
    ctx.fillRect(0, 0, textureSize, textureSize);

    // Draw border frame in white for contrast
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE
    );

    // Function boxes should display only the function signature.
    const lines: string[] = [node.name];

    ctx.font = `bold ${SceneConfig.SIGNATURE_FONT_SIZE_PX}px ${SceneConfig.SIGNATURE_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lineHeight = SceneConfig.SIGNATURE_FONT_SIZE_PX * 1.5;
    let yOffset = (textureSize - lineHeight) / 2;
    
    // Calculate panel dimensions
    const panelPadding = 15;
    const panelWidth = textureSize - 4 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE;
    const panelHeight = lineHeight + 2 * panelPadding;
    const panelX = (textureSize - panelWidth) / 2;
    const panelY = yOffset - panelPadding;

    // Draw dark semi-transparent background panel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

    // Draw white signature text centered on the panel.
    ctx.fillStyle = '#ffffff';
    yOffset = panelY + panelPadding;
    ctx.fillText(lines[0], textureSize / 2, yOffset);

    ctx.restore();

    dynamicTexture.update();
    return dynamicTexture;
  }

  /**
   * Create a billboard label above a mesh
   */
  private createLabel(text: string, parentMesh: BABYLON.Mesh): void {
    const dynamicTexture = new BABYLON.DynamicTexture(
      `labelTexture_${parentMesh.id}`,
      SceneConfig.LABEL_TEXTURE_SIZE,
      this.scene
    );
    const ctx = dynamicTexture.getContext() as any;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, SceneConfig.LABEL_TEXTURE_SIZE, SceneConfig.LABEL_TEXTURE_SIZE);

    ctx.fillStyle = '#ffffff';  // White text for contrast
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw dark outline for readability
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.fillText(text, SceneConfig.LABEL_TEXTURE_SIZE / 2, SceneConfig.LABEL_TEXTURE_SIZE / 2);

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
  }

  /**
   * Create edge (cylinder) meshes connecting nodes
   * Uses cylinders that can be reused and repositioned each frame for performance
   * Clears old edges before creating new ones
   */
  createEdges(
    edges: Array<{ from: string; to: string }>,
    _layoutNodes: Map<string, any>,  // Kept for API compatibility, actual positions from mesh.getAbsolutePosition()
    sceneRoot?: BABYLON.TransformNode,
    nodeExportedMap?: Map<string, boolean>  // Map of node IDs to isExported status
  ): void {
    // Clear old edges
    for (const cylinder of this.edgeTubes.values()) {
      cylinder.dispose();
    }
    this.edgeTubes.clear();
    this.edgeMetadata.clear();

    // Create material for same-file edges (visible but subtle and thin)
    const samFileEdgeMaterial = new BABYLON.StandardMaterial('sameFileEdgeMaterial', this.scene);
    samFileEdgeMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);  // Dim gray
    samFileEdgeMaterial.alpha = 0.4;
    samFileEdgeMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

    // Create material for cross-file edges
    const crossFileEdgeMaterial = new BABYLON.StandardMaterial('crossFileEdgeMaterial', this.scene);
    crossFileEdgeMaterial.emissiveColor = new BABYLON.Color3(1.0, 0.84, 0.0);  // Golden
    crossFileEdgeMaterial.alpha = 0;  // Hidden
    crossFileEdgeMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

    // Create material for exported function connections (glowing yellow)
    const exportedEdgeMaterial = new BABYLON.StandardMaterial('exportedEdgeMaterial', this.scene);
    exportedEdgeMaterial.emissiveColor = new BABYLON.Color3(1.0, 1.0, 0.0);  // Bright yellow
    exportedEdgeMaterial.specularColor = new BABYLON.Color3(1.0, 1.0, 0.8);
    exportedEdgeMaterial.specularPower = 32;
    exportedEdgeMaterial.alpha = 1.0;  // Visible
    exportedEdgeMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

    // Create cylinder for each edge that will be repositioned each frame
    let edgeIndex = 0;
    for (const edge of edges) {
      // Note: We don't check layoutNodes because updateEdges() will use actual mesh positions
      // This allows edges to be created before node meshes are fully positioned

      // Extract file paths to determine if cross-file
      const fromFile = edge.from.split('@')[1];
      const toFile = edge.to.split('@')[1];
      const isCrossFile = fromFile !== toFile;
      
      // Check if the target node is an exported function
      const isExportedConnection = nodeExportedMap && nodeExportedMap.get(edge.to);
      
      // Select material: cross-file exported connections get glowing yellow;
      // same-file edges (including to exported functions) use the internal style.
      let material = samFileEdgeMaterial;
      if (isExportedConnection && isCrossFile) {
        material = exportedEdgeMaterial;
      } else if (isCrossFile) {
        material = crossFileEdgeMaterial;
      }

      // Thinner cylinders for same-file (internal) edges, normal size for cross-file.
      const edgeDiameter = isCrossFile
        ? SceneConfig.EDGE_RADIUS * 2
        : SceneConfig.INTERNAL_EDGE_RADIUS * 2;
      const cylinder = BABYLON.MeshBuilder.CreateCylinder(`edge_${edgeIndex}`, {
        diameter: edgeDiameter,
        height: 1,  // Will be scaled based on distance
      }, this.scene);
      
      cylinder.material = material;
      cylinder.isPickable = false;
      
      // Parent to scene root to move with the scene
      if (sceneRoot) {
        cylinder.parent = sceneRoot;
      }

      // Store cylinder and metadata
      this.edgeTubes.set(`${edgeIndex}`, cylinder);
      this.edgeMetadata.set(`${edgeIndex}`, {
        from: edge.from,
        to: edge.to,
        isCrossFile
      });

      edgeIndex++;
    }
  }



  /**
   * Remove a node mesh reference from the tracking map
   */
  removeMeshReference(nodeId: string): void {
    this.nodeMeshes.delete(nodeId);
  }

  /**
   * Update edge positions and rotations to follow their connected nodes
   * Reuses cylinder meshes for performance - no recreation each frame
   * Called during render loop to keep edges attached to moving nodes
   */
  public updateEdges(): void {
    if (this.edgeTubes.size === 0 || this.nodeMeshes.size === 0) {
      return;  // No edges to update
    }

    for (const [edgeId, cylinder] of this.edgeTubes) {
      const metadata = this.edgeMetadata.get(edgeId);
      if (!metadata) continue;

      // Get current node positions directly from meshes (always up-to-date after layout/repulsion)
      const sourceMesh = this.nodeMeshes.get(metadata.from);
      const targetMesh = this.nodeMeshes.get(metadata.to);

      if (!sourceMesh || !targetMesh) {
        continue;  // Skip if nodes not found
      }

      // Get current positions (world space)
      const sourceCenterPos = sourceMesh.getAbsolutePosition().clone();
      const targetCenterPos = targetMesh.getAbsolutePosition().clone();

      // Calculate direction and distance
      const direction = targetCenterPos.subtract(sourceCenterPos);
      const distance = direction.length();

      if (distance < 0.001) {
        cylinder.setEnabled(false);  // Hide edge if nodes are at same position
        continue;
      }

      // Get half-sizes of source and target meshes for surface contact points
      const sourceBoundingBox = sourceMesh.getBoundingInfo().boundingBox;
      const targetBoundingBox = targetMesh.getBoundingInfo().boundingBox;
      // Calculate half-size as distance from center to corner
      const sourceSize = sourceBoundingBox.maximum.subtract(sourceBoundingBox.minimum).scale(0.5);
      const targetSize = targetBoundingBox.maximum.subtract(targetBoundingBox.minimum).scale(0.5);
      const sourceHalfSize = sourceSize.length();  // Approximate half-size (distance to corner)
      const targetHalfSize = targetSize.length();  // Approximate half-size (distance to corner)

      // Normalize direction
      const normalizedDir = direction.normalize();

      // Start point: move source center outward by half its size
      const edgeStartPos = sourceCenterPos.add(normalizedDir.scale(sourceHalfSize));
      
      // End point: move target center inward by half its size (approach from outside)
      const edgeEndPos = targetCenterPos.add(normalizedDir.scale(-targetHalfSize));

      // Use midpoint of start and end for cylinder position
      const midpointWorld = edgeStartPos.add(edgeEndPos).scale(0.5);
      
      // Recalculate distance based on surface points
      const surfaceDistance = edgeEndPos.subtract(edgeStartPos).length();
      
      // Convert world position to local position relative to parent
      // If cylinder has a parent, position is automatically local
      if (cylinder.parent) {
        const parentMatrix = (cylinder.parent as BABYLON.TransformNode).getWorldMatrix().clone();
        const inverseParentMatrix = BABYLON.Matrix.Invert(parentMatrix);
        const localPosition = BABYLON.Vector3.TransformCoordinates(midpointWorld, inverseParentMatrix);
        cylinder.position = localPosition;
      } else {
        cylinder.position = midpointWorld;
      }

      // Scale cylinder to surface-to-surface distance
      cylinder.scaling.y = Math.max(surfaceDistance, 0.1);  // Minimum 0.1 to avoid invisible edges

      // Rotate cylinder to point along the connection
      const edgeDirection = edgeEndPos.subtract(edgeStartPos).normalize();
      const yAxis = BABYLON.Axis.Y;
      const rotationQuaternion = BABYLON.Quaternion.Identity();
      BABYLON.Quaternion.FromUnitVectorsToRef(yAxis, edgeDirection, rotationQuaternion);
      cylinder.rotationQuaternion = rotationQuaternion;

      // Ensure cylinder is visible
      if (!cylinder.isEnabled) {
        cylinder.setEnabled(true);
      }
    }
  }

}
