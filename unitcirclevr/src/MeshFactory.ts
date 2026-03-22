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
    indegree: number = 0,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    // Scale box size based on number of incoming connections (indegree)
    // Uses logarithmic scaling to keep size differences visible but not extreme
    // Formula: base + log(indegree + 1) * scale_factor
    const baseSize = SceneConfig.FUNCTION_BOX_SIZE;
    const scaleFactor = 1.0;  // 1.0 unit increase per log step
    const boxSize = baseSize + Math.log(Math.max(1, indegree + 1)) * scaleFactor;

    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: boxSize }, this.scene);
    box.position = position;
    box.isPickable = true;

    const material = new BABYLON.StandardMaterial(`mat_${node.id}`, this.scene);

    // Apply signature texture with file color background
    const signatureTexture = this.createSignatureTexture(node, fileColor);
    signatureTexture.uScale = 1.0;
    signatureTexture.vScale = 1.0;
    signatureTexture.uOffset = 0;
    signatureTexture.vOffset = 0;
    
    // Use texture as diffuse (primary visual) for proper lighting response
    material.diffuseTexture = signatureTexture;
    // Keep diffuse color neutral so file color from texture shows through
    material.diffuseColor = new BABYLON.Color3(1, 1, 1);
    
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
    
    material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    material.specularPower = 16;
    material.wireframe = false;
    
    // Make cube faces transparent
    material.alpha = 0.7;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

    box.material = material;

    // Store reference to this mesh for raycasting during edge creation
    this.nodeMeshes.set(node.id, box);

    onNodeInteraction(box as BABYLON.Mesh, material, node);
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
    const ctx = dynamicTexture.getContext() as any;

    // Draw background with file color or transparent
    if (backgroundColor) {
      // Convert color to RGB hex and fill background
      const r = Math.floor(backgroundColor.r * 255);
      const g = Math.floor(backgroundColor.g * 255);
      const b = Math.floor(backgroundColor.b * 255);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, textureSize, textureSize);
    } else {
      // Transparent background if no color provided
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, textureSize, textureSize);
    }

    // Draw border frame in white for contrast
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE
    );

    // Draw text with dark background panel for legibility
    const lines: string[] = [node.name];
    if (node.isExported) {
      lines.push('Exported');
    } else {
      lines.push('Internal');
    }
    if (node.file) {
      lines.push(node.file);
    }
    if (node.line) {
      lines.push(`Line ${node.line}`);
    }
    const typeLabel =
      node.type === 'function' ? 'Function' : node.type === 'variable' ? 'Variable' : 'External';
    lines.push(typeLabel);

    ctx.font = `bold ${SceneConfig.SIGNATURE_FONT_SIZE_PX}px ${SceneConfig.SIGNATURE_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lineHeight = SceneConfig.SIGNATURE_FONT_SIZE_PX * 1.5;
    let yOffset = lineHeight + 20;
    
    // Calculate panel dimensions
    const panelPadding = 15;
    const panelWidth = textureSize - 4 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE;
    const panelHeight = lines.length * lineHeight + 2 * panelPadding;
    const panelX = (textureSize - panelWidth) / 2;
    const panelY = yOffset - panelPadding;

    // Draw dark semi-transparent background panel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);

    // Draw white text on the dark panel
    ctx.fillStyle = '#ffffff';  // White text for maximum contrast
    yOffset = panelY + panelPadding;
    for (const line of lines) {
      ctx.fillText(line, textureSize / 2, yOffset);
      yOffset += lineHeight;
    }

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
   * Create edge (tube) meshes connecting nodes
   */
  createEdges(
    edges: Array<{ from: string; to: string }>,
    layoutNodes: Map<string, any>
  ): void {
    // Create material for same-file edges
    const samFileEdgeMaterial = new BABYLON.StandardMaterial('sameFileEdgeMaterial', this.scene);
    samFileEdgeMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.8, 0.8);  // Gray

    // Create material for cross-file edges
    const crossFileEdgeMaterial = new BABYLON.StandardMaterial('crossFileEdgeMaterial', this.scene);
    crossFileEdgeMaterial.emissiveColor = new BABYLON.Color3(1.0, 0.84, 0.0);  // Golden

    // Create simple tube for each edge
    let edgeIndex = 0;
    for (const edge of edges) {
      const sourceNode = layoutNodes.get(edge.from);
      const targetNode = layoutNodes.get(edge.to);

      if (!sourceNode || !targetNode) {
        edgeIndex++;
        continue;
      }

      // Extract file paths to determine if cross-file
      const fromFile = edge.from.split('@')[1];
      const toFile = edge.to.split('@')[1];
      const isCrossFile = fromFile !== toFile;
      const material = isCrossFile ? crossFileEdgeMaterial : samFileEdgeMaterial;

      // Create tube from source to target node centers
      const sourceCenterPos = new BABYLON.Vector3(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z);
      const targetCenterPos = new BABYLON.Vector3(targetNode.position.x, targetNode.position.y, targetNode.position.z);

      const points = [sourceCenterPos, targetCenterPos];
      const tube = BABYLON.MeshBuilder.CreateTube(`edge_${edgeIndex}`, {
        path: points,
        radius: SceneConfig.EDGE_RADIUS,
      }, this.scene);
      
      tube.material = material;
      tube.isPickable = false;

      // Store tube and metadata
      this.edgeTubes.set(`${edgeIndex}`, tube);
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
   * Update edge positions and geometry to follow their connected nodes
   * Called during render loop to keep edges attached to moving nodes
   */
  public updateEdges(): void {
    if (this.edgeTubes.size === 0 || this.nodeMeshes.size === 0) {
      return;  // No edges to update
    }

    for (const [edgeId, oldTube] of this.edgeTubes) {
      const metadata = this.edgeMetadata.get(edgeId);
      if (!metadata) continue;

      // Get current node positions directly from meshes (always up-to-date after layout/repulsion)
      const sourceMesh = this.nodeMeshes.get(metadata.from);
      const targetMesh = this.nodeMeshes.get(metadata.to);

      if (!sourceMesh || !targetMesh) {
        continue;  // Skip if nodes not found
      }

      // Use mesh positions - these are always current after node movements
      const sourceCenterPos = sourceMesh.position.clone();
      const targetCenterPos = targetMesh.position.clone();

      // Create simple tube from source to target centers
      const points = [sourceCenterPos, targetCenterPos];

      // Dispose old tube and create new one with updated path
      oldTube.dispose();
      const newTube = BABYLON.MeshBuilder.CreateTube(`edge_${edgeId}`, {
        path: points,
        radius: SceneConfig.EDGE_RADIUS,
      }, this.scene);

      // Apply material based on cross-file flag
      newTube.material = this.getDefaultEdgeMaterial(metadata.isCrossFile);
      newTube.isPickable = false;
      
      // Update stored tube
      this.edgeTubes.set(edgeId, newTube);
    }
  }

  /**
   * Get or create default edge material
   */
  private getDefaultEdgeMaterial(isCrossFile: boolean): BABYLON.StandardMaterial {
    const material = new BABYLON.StandardMaterial(
      isCrossFile ? 'crossFileEdgeMaterial' : 'sameFileEdgeMaterial',
      this.scene
    );
    material.emissiveColor = isCrossFile
      ? new BABYLON.Color3(1.0, 0.84, 0.0)  // Golden
      : new BABYLON.Color3(0.8, 0.8, 0.8); // Gray
    return material;
  }
}
