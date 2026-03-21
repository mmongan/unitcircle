/**
 * Factory for creating and managing 3D mesh representations of code entities
 */
import * as BABYLON from '@babylonjs/core';
import type { GraphNode } from './types';
import { SceneConfig } from './SceneConfig';

export class MeshFactory {
  private scene: BABYLON.Scene;
  private sceneRoot: BABYLON.TransformNode;

  constructor(scene: BABYLON.Scene, sceneRoot: BABYLON.TransformNode) {
    this.scene = scene;
    this.sceneRoot = sceneRoot;
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
    cylinder.parent = this.sceneRoot;
    cylinder.isPickable = true;

    const material = new BABYLON.StandardMaterial(`extMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15);  // Subtle gray
    material.wireframe = false;
    cylinder.material = material;

    this.createLabel(node.name, cylinder.position, node.id);
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
    sphere.parent = this.sceneRoot;
    sphere.isPickable = true;

    const material = new BABYLON.StandardMaterial(`varMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15);  // Subtle gray
    material.wireframe = false;
    sphere.material = material;

    this.createLabel(node.name, sphere.position, node.id);
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
    box.parent = this.sceneRoot;
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
  private createLabel(text: string, position: BABYLON.Vector3, nodeId: string): void {
    const dynamicTexture = new BABYLON.DynamicTexture(
      `labelTexture_${nodeId}`,
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
      `label_${nodeId}`,
      { width: SceneConfig.LABEL_WIDTH, height: SceneConfig.LABEL_HEIGHT },
      this.scene
    );
    labelPlane.position = position.add(SceneConfig.LABEL_OFFSET);
    labelPlane.parent = this.sceneRoot;
    labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const labelMaterial = new BABYLON.StandardMaterial(`labelMat_${nodeId}`, this.scene);
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
    // Create material for normal edges (same-file calls)
    const edgeMaterial = new BABYLON.StandardMaterial('edgeMaterial', this.scene);
    edgeMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.8, 0.8);  // Bright gray

    // Create material for golden edges (cross-file calls)
    const goldenEdgeMaterial = new BABYLON.StandardMaterial('goldenEdgeMaterial', this.scene);
    goldenEdgeMaterial.emissiveColor = new BABYLON.Color3(1.0, 0.84, 0.0);  // Golden yellow

    // Render all edges connecting to function centers
    let edgeIndex = 0;
    for (const edge of edges) {
      // Extract file paths from edge endpoints (format: "functionName@/path/to/file.ts")
      const fromFile = edge.from.split('@')[1];
      const toFile = edge.to.split('@')[1];
      
      // Color golden if calling across files, gray if same file
      const isCrossFile = fromFile !== toFile;
      const material = isCrossFile ? goldenEdgeMaterial : edgeMaterial;
      
      this.createEdge(edge, layoutNodes, material, edgeIndex);
      edgeIndex++;
    }
  }

  /**
   * Create a single edge between two nodes
   */
  private createEdge(
    edge: { from: string; to: string },
    layoutNodes: Map<string, any>,
    material: BABYLON.StandardMaterial,
    index: number
  ): void {
    const sourceNode = layoutNodes.get(edge.from);
    const targetNode = layoutNodes.get(edge.to);

    if (sourceNode && targetNode) {
      const sourcePos = new BABYLON.Vector3(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z);
      const targetPos = new BABYLON.Vector3(targetNode.position.x, targetNode.position.y, targetNode.position.z);
      
      const points = [sourcePos, targetPos];

      const tube = BABYLON.MeshBuilder.CreateTube(`edge_${index}`, {
        path: points,
        radius: SceneConfig.EDGE_RADIUS,
      }, this.scene);
      tube.parent = this.sceneRoot;
      tube.material = material;
      tube.isPickable = false;  // Edges should not be clickable

      // Create arrowhead at the end of the edge
      this.createArrowhead(sourcePos, targetPos, material, index);
    }
  }

  /**
   * Create an arrowhead cone at the end of an edge pointing toward the target
   */
  private createArrowhead(
    sourcePos: BABYLON.Vector3,
    targetPos: BABYLON.Vector3,
    material: BABYLON.StandardMaterial,
    index: number
  ): void {
    const arrowheadSize = 0.4;
    // Create a cone-like shape using a cylinder with small top
    const arrowhead = BABYLON.MeshBuilder.CreateCylinder(`arrowhead_${index}`, {
      diameterTop: 0.05,
      diameterBottom: arrowheadSize,
      height: arrowheadSize * 1.5,
    }, this.scene);

    // Position at target node
    arrowhead.position = targetPos.clone();

    // Calculate direction from source to target
    const direction = targetPos.subtract(sourcePos).normalize();

    // Create a rotation that points the cylinder along the direction vector
    // Default cylinder points up (0, 1, 0). We need to rotate it to point along direction
    const rotationQuaternion = BABYLON.Quaternion.Identity();
    BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Axis.Y, direction, rotationQuaternion);
    arrowhead.rotationQuaternion = rotationQuaternion;

    arrowhead.parent = this.sceneRoot;
    arrowhead.material = material;
    arrowhead.isPickable = false;
  }

  /**
   * Create a transparent sphere container for functions in a specific file
   */

}
