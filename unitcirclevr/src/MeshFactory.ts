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
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    if (node.type === 'external') {
      this.createExternalModuleMesh(node, position, onNodeInteraction);
    } else if (node.type === 'variable') {
      this.createVariableMesh(node, position, onNodeInteraction);
    } else {
      this.createFunctionMesh(node, position, onNodeInteraction);
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

    const material = new BABYLON.StandardMaterial(`extMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);  // Dark gray
    material.wireframe = false;
    cylinder.material = material;

    this.createLabel(node.name, cylinder.position);
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

    const material = new BABYLON.StandardMaterial(`varMat_${node.id}`, this.scene);
    material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);  // Dark gray
    material.wireframe = false;
    sphere.material = material;

    this.createLabel(node.name, sphere.position);
    onNodeInteraction(sphere as BABYLON.Mesh, material, node);
  }

  /**
   * Create a function box mesh with signature texture
   */
  private createFunctionMesh(
    node: GraphNode,
    position: BABYLON.Vector3,
    onNodeInteraction: (mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphNode) => void
  ): void {
    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: SceneConfig.FUNCTION_BOX_SIZE }, this.scene);
    box.position = position;
    box.parent = this.sceneRoot;

    const material = new BABYLON.StandardMaterial(`mat_${node.id}`, this.scene);

    // Apply signature texture with minimal color overlay
    const signatureTexture = this.createSignatureTexture(node);
    signatureTexture.uScale = 1.0;
    signatureTexture.vScale = 1.0;
    signatureTexture.uOffset = 0;
    signatureTexture.vOffset = 0;
    
    // Use texture without emissive glow
    material.emissiveTexture = signatureTexture;
    material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);  // Dark gray for visibility
    material.wireframe = false;

    box.material = material;

    this.createLabel(node.name, box.position);
    onNodeInteraction(box as BABYLON.Mesh, material, node);
  }

  /**
   * Create a dynamic texture with function signature information
   */
  private createSignatureTexture(node: GraphNode): BABYLON.DynamicTexture {
    const textureSize = SceneConfig.SIGNATURE_TEXTURE_SIZE;
    const dynamicTexture = new BABYLON.DynamicTexture(
      `signatureTexture_${node.id}`,
      textureSize,
      this.scene
    );
    const ctx = dynamicTexture.getContext() as any;

    // Draw transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, textureSize, textureSize);

    // Draw border frame
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE,
      textureSize - 2 * SceneConfig.SIGNATURE_TEXTURE_BORDER_SIZE
    );

    // Draw text in white for visibility on any color
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

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${SceneConfig.SIGNATURE_FONT_SIZE_PX}px ${SceneConfig.SIGNATURE_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lineHeight = SceneConfig.SIGNATURE_FONT_SIZE_PX * 1.5;
    let yOffset = lineHeight + 20;
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
  private createLabel(text: string, position: BABYLON.Vector3): void {
    const dynamicTexture = new BABYLON.DynamicTexture(
      'labelTexture_' + text,
      SceneConfig.LABEL_TEXTURE_SIZE,
      this.scene
    );
    const ctx = dynamicTexture.getContext() as any;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, SceneConfig.LABEL_TEXTURE_SIZE, SceneConfig.LABEL_TEXTURE_SIZE);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, SceneConfig.LABEL_TEXTURE_SIZE / 2, SceneConfig.LABEL_TEXTURE_SIZE / 2);

    dynamicTexture.update();

    // Create plane for label
    const labelPlane = BABYLON.MeshBuilder.CreatePlane(
      `label_${text}`,
      { width: SceneConfig.LABEL_WIDTH, height: SceneConfig.LABEL_HEIGHT },
      this.scene
    );
    labelPlane.position = position.add(SceneConfig.LABEL_OFFSET);
    labelPlane.parent = this.sceneRoot;
    labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    const labelMaterial = new BABYLON.StandardMaterial(`labelMat_${text}`, this.scene);
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
}
