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
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    if (node.type === 'external') {
      this.createExternalModuleMesh(node, position, onNodeInteraction);
    } else if (node.type === 'variable') {
      this.createVariableMesh(node, position, onNodeInteraction);
    } else {
      this.createFunctionMesh(node, position, fileColor, onNodeInteraction);
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
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: SceneConfig.FUNCTION_BOX_SIZE }, this.scene);
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
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
    const edgeMaterial = new BABYLON.StandardMaterial('edgeMaterial', this.scene);
    edgeMaterial.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);  // Dark gray

    let edgeIndex = 0;
    for (const edge of edges) {
      this.createEdge(edge, layoutNodes, edgeMaterial, edgeIndex++);
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
      const points = [
        new BABYLON.Vector3(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z),
        new BABYLON.Vector3(targetNode.position.x, targetNode.position.y, targetNode.position.z),
      ];

      const tube = BABYLON.MeshBuilder.CreateTube(`edge_${index}`, {
        path: points,
        radius: SceneConfig.EDGE_RADIUS,
      });
      tube.parent = this.sceneRoot;
      tube.material = material;
    }
  }

  /**
   * Create a transparent sphere container for functions in a specific file
   */

}
