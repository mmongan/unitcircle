/**
 * Factory for creating and managing 3D mesh representations of code entities
 */
import * as BABYLON from '@babylonjs/core';
import type { GraphNode } from './types';
import { SceneConfig } from './SceneConfig';
import { toProjectRelativePath } from './PathUtils';

export class MeshFactory {
  private scene: BABYLON.Scene;
  private nodeMeshes: Map<string, BABYLON.Mesh> = new Map();  // Track meshes for raycasting
  private edgeTubes: Map<string, BABYLON.Mesh> = new Map();   // Simple tube storage
  private edgeArrows: Map<string, BABYLON.Mesh> = new Map();  // Arrowhead cones at target end
  private edgeMetadata: Map<string, {
    from: string;
    to: string;
    fromFile: string | null;
    toFile: string | null;
    isCrossFile: boolean;
    isSelfLoop: boolean;
    bidirectionalOffsetSign: number;
    targetsExternalLibrary: boolean;
  }> = new Map();
  private edgeMaterials: Set<BABYLON.StandardMaterial> = new Set();
  private focusedFile: string | null = null;
  private focusedDirectories: Set<string> = new Set();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  public setDeclutterContext(focusedFile: string | null, focusedDirectories: Iterable<string>): void {
    this.focusedFile = focusedFile ? toProjectRelativePath(focusedFile) : null;
    this.focusedDirectories = new Set(Array.from(focusedDirectories, (dir) => toProjectRelativePath(dir)));
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
    // Keep both exported and internal function boxes large enough to see.
    const boxSize = node.isExported
      ? Math.max(SceneConfig.EXPORTED_FUNCTION_BOX_SIZE, SceneConfig.FUNCTION_BOX_SIZE)
      : Math.max(SceneConfig.INTERNAL_FUNCTION_BOX_SIZE, SceneConfig.FUNCTION_BOX_SIZE);

    const { texture, faceUV } = this.createFunctionFaceTextureAtlas(node, fileColor);
    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: boxSize, faceUV }, this.scene);
    box.position = position;
    box.isPickable = true;
    (box as any).boxSize = boxSize;

    const material = new BABYLON.StandardMaterial(`mat_${node.id}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(1, 1, 1);
    material.diffuseTexture = texture;
    
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

    onNodeInteraction(box as BABYLON.Mesh, material, node);
  }
  /**
   * Build a texture atlas plus face UV mapping for a single box mesh.
   */
  private createFunctionFaceTextureAtlas(
    node: GraphNode,
    fileColor: BABYLON.Color3 | null
  ): { texture: BABYLON.DynamicTexture; faceUV: BABYLON.Vector4[] } {
    const tileSize = Math.floor(SceneConfig.SIGNATURE_TEXTURE_SIZE / 2);
    const atlasCols = 3;
    const atlasRows = 2;
    const textureWidth = tileSize * atlasCols;
    const textureHeight = tileSize * atlasRows;

    const dynamicTexture = new BABYLON.DynamicTexture(
      `signatureTexture_${node.id}`,
      { width: textureWidth, height: textureHeight },
      this.scene
    );
    dynamicTexture.hasAlpha = false;
    const ctx = dynamicTexture.getContext() as any;

    ctx.clearRect(0, 0, textureWidth, textureHeight);

    // Draw background using the file color, darkened for contrast with white text.
    let bgColor = 'rgb(0, 0, 0)';
    if (fileColor) {
      const r = Math.max(0, Math.floor(fileColor.r * 200));
      const g = Math.max(0, Math.floor(fileColor.g * 200));
      const b = Math.max(0, Math.floor(fileColor.b * 200));
      bgColor = `rgb(${r}, ${g}, ${b})`;
    }

    const faceLabels = ['front', 'back', 'right', 'left', 'top', 'bottom'];
    for (let i = 0; i < faceLabels.length; i++) {
      const col = i % atlasCols;
      const row = Math.floor(i / atlasCols);
      const x = col * tileSize;
      const y = row * tileSize;
      const centerX = x + (tileSize / 2);
      const centerY = y + (tileSize / 2);
      const maxTextWidth = tileSize * 0.86;
      const lineHeight = Math.floor(tileSize * 0.16);
      const maxLines = 4;

      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y, tileSize, tileSize);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.01));
      ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

      const faceFontSize = Math.max(18, Math.floor(tileSize * 0.22));
      ctx.font = `bold ${faceFontSize}px ${SceneConfig.SIGNATURE_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';

      const wrappedLines = this.wrapTextToWidth(ctx, node.name, maxTextWidth, maxLines);
      const totalHeight = wrappedLines.length * lineHeight;
      let lineY = centerY - (totalHeight / 2) + (lineHeight / 2);
      for (const line of wrappedLines) {
        ctx.fillText(line, centerX, lineY);
        lineY += lineHeight;
      }
    }

    dynamicTexture.update();

    const buildUV = (index: number): BABYLON.Vector4 => {
      const col = index % atlasCols;
      const row = Math.floor(index / atlasCols);
      const u0 = col / atlasCols;
      const v0 = row / atlasRows;
      const u1 = (col + 1) / atlasCols;
      const v1 = (row + 1) / atlasRows;
      return new BABYLON.Vector4(u0, v0, u1, v1);
    };

    const faceUV: BABYLON.Vector4[] = [
      buildUV(0),
      buildUV(1),
      buildUV(2),
      buildUV(3),
      buildUV(4),
      buildUV(5),
    ];

    return { texture: dynamicTexture, faceUV };
  }

  /**
   * Wrap text to fit a target pixel width, preserving readability for long symbol names.
   */
  private wrapTextToWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number
  ): string[] {
    const normalized = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [text];
    }

    const lines: string[] = [];
    let currentLine = '';

    const pushLine = () => {
      if (currentLine.trim().length > 0) {
        lines.push(currentLine.trim());
      }
      currentLine = '';
    };

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (!currentLine) {
        // Fallback: break very long tokens by character width.
        let remaining = word;
        while (remaining.length > 0) {
          let take = remaining.length;
          while (take > 1 && ctx.measureText(remaining.slice(0, take)).width > maxWidth) {
            take--;
          }
          const chunk = remaining.slice(0, take);
          lines.push(chunk);
          remaining = remaining.slice(take);
          if (lines.length >= maxLines) {
            break;
          }
        }
      } else {
        pushLine();
        currentLine = word;
      }

      if (lines.length >= maxLines) {
        break;
      }
    }

    if (lines.length < maxLines && currentLine) {
      pushLine();
    }

    if (lines.length === 0) {
      return [text];
    }

    if (lines.length > maxLines) {
      return lines.slice(0, maxLines);
    }

    // Add ellipsis if we had to truncate words.
    if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
      const lastIndex = lines.length - 1;
      let last = lines[lastIndex];
      while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lastIndex] = `${last}...`;
    }

    return lines;
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
    edges: Array<{ from: string; to: string; kind?: 'call' | 'var-read' | 'var-write' }>,
    _layoutNodes: Map<string, any>,  // Kept for API compatibility, actual positions from mesh.getAbsolutePosition()
    sceneRoot?: BABYLON.TransformNode,
    nodeExportedMap?: Map<string, boolean>,  // Map of node IDs to isExported status
    fileColorMap?: Map<string, BABYLON.Color3>, // Map of file paths to file box colors
    nodeFileMap?: Map<string, string>,
  ): void {
    // Clear old edge meshes/materials first so repeated graph refreshes do not leak GPU resources.
    this.clearEdges();

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
      edgeKind?: 'call' | 'var-read' | 'var-write',
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

      if (edgeKind === 'var-write') {
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
      const edgeDiameter = edgeKind === 'var-write'
        ? SceneConfig.INTERNAL_EDGE_RADIUS * 3.0
        : edgeKind === 'var-read'
          ? SceneConfig.INTERNAL_EDGE_RADIUS * 2.2
          : isSelfLoop
        ? SceneConfig.EDGE_RADIUS * 1.6
        : isCrossFile
          ? SceneConfig.EDGE_RADIUS * 2
          : isExportedConnection
            ? SceneConfig.INTERNAL_EDGE_RADIUS * 4
            : SceneConfig.INTERNAL_EDGE_RADIUS * 2;
      const cylinder = isSelfLoop
        ? BABYLON.MeshBuilder.CreateTube(`edge_${edgeIndex}`, {
            path: this.buildSelfLoopPath(sceneRoot ?? null, BABYLON.Vector3.Zero(), 2.0),
            radius: Math.max(0.06, edgeDiameter * 0.45),
            updatable: true,
          }, this.scene)
        : BABYLON.MeshBuilder.CreateCylinder(`edge_${edgeIndex}`, {
            diameter: edgeDiameter,
            height: 1,  // Will be scaled based on distance
          }, this.scene);
      
      cylinder.material = material;
      cylinder.isPickable = true;
      // Keep connection edges rendered even when camera intersects their bounds.
      cylinder.alwaysSelectAsActiveMesh = true;
      cylinder.renderingGroupId = 1;  // Render edges on top of transparent boxes
      (cylinder as any).edgeData = { from: edge.from, to: edge.to };
      
      // Parent to scene root to move with the scene
      if (sceneRoot) {
        cylinder.parent = sceneRoot;
      }

      // Arrowhead cone at the target end: tip points in the direction of the call
      const arrowHeight = edgeKind === 'var-write'
        ? edgeDiameter * 5.0
        : edgeKind === 'var-read'
          ? edgeDiameter * 4.4
          : edgeDiameter * 4.0;
      const arrowBaseDiameter = edgeKind === 'var-write'
        ? edgeDiameter * 2.9
        : edgeKind === 'var-read'
          ? edgeDiameter * 2.6
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
    this.edgeMetadata.clear();

    for (const material of this.edgeMaterials.values()) {
      material.dispose();
    }
    this.edgeMaterials.clear();
  }

  /**
   * Remove all cached node mesh references.
   */
  public clearNodeReferences(): void {
    this.nodeMeshes.clear();
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

      const arrow = this.edgeArrows.get(edgeId);

      const edgeVisibility = this.getEdgeVisibilityFactor(metadata, sourceMesh, targetMesh);

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

        continue;
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
        continue;
      }

      // Use vertical half extents so edges connect through top/bottom faces.
      const sourceBoundingBox = sourceMesh.getBoundingInfo().boundingBox;
      const targetBoundingBox = targetMesh.getBoundingInfo().boundingBox;
      const sourceHalfY = Math.max(
        0.1,
        (sourceBoundingBox.maximum.y - sourceBoundingBox.minimum.y) * 0.5,
      );
      const targetHalfY = Math.max(
        0.1,
        (targetBoundingBox.maximum.y - targetBoundingBox.minimum.y) * 0.5,
      );

      // Normalize direction
      const normalizedDir = direction.normalize();
      const bidirectionalOffset = this.computeBidirectionalOffsetVector(
        normalizedDir,
        metadata.isCrossFile,
        metadata.bidirectionalOffsetSign,
      );
      const offsetSourcePos = sourceCenterPos.add(bidirectionalOffset);
      const offsetTargetPos = targetCenterPos.add(bidirectionalOffset);

      // All non-self edges connect via top/bottom faces only.
      // If target is above source, exit source top and enter target bottom.
      // If target is below source, exit source bottom and enter target top.
      const verticalSign = targetCenterPos.y >= sourceCenterPos.y ? 1 : -1;
      const sourceVerticalOffset = new BABYLON.Vector3(0, verticalSign * sourceHalfY, 0);
      const targetVerticalOffset = new BABYLON.Vector3(0, -verticalSign * targetHalfY, 0);

      const edgeStartPos = offsetSourcePos.add(sourceVerticalOffset);
      const edgeEndPos = offsetTargetPos.add(targetVerticalOffset);

      // Edge direction unit vector (source → target)
      const edgeDirection = edgeEndPos.subtract(edgeStartPos).normalize();

      // Compute arrow cone height so we can shorten the cylinder to avoid overlap.
      // The cone is unscaled so its bounding-box half-height equals arrowHeight/2.
      const arrowFullHeight = arrow
        ? arrow.getBoundingInfo().boundingBox.maximum.y * 2
        : 0;

      // Cylinder ends at the cone's base (not the target surface) so the tip is visible.
      const cylinderEndPos = edgeEndPos.subtract(edgeDirection.scale(arrowFullHeight));

      // Use midpoint of start and cylinder-end for the cylinder position
      const midpointWorld = edgeStartPos.add(cylinderEndPos).scale(0.5);
      
      // Recalculate distance based on surface points (cylinder portion only)
      const surfaceDistance = cylinderEndPos.subtract(edgeStartPos).length();
      
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
      const yAxis = BABYLON.Axis.Y;
      const rotationQuaternion = BABYLON.Quaternion.Identity();
      BABYLON.Quaternion.FromUnitVectorsToRef(yAxis, edgeDirection, rotationQuaternion);
      cylinder.rotationQuaternion = rotationQuaternion;

      // Ensure cylinder is visible
      this.ensureMeshEnabled(cylinder);
      cylinder.visibility = edgeVisibility;

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
    },
    sourceMesh: BABYLON.Mesh,
    targetMesh: BABYLON.Mesh,
  ): number {
    if (metadata.isCrossFile) {
      return this.getCrossFileEdgeVisibilityFactor(metadata);
    }

    const sharedParent = sourceMesh.parent && sourceMesh.parent === targetMesh.parent
      ? sourceMesh.parent
      : null;
    if (!sharedParent || typeof (sharedParent as BABYLON.AbstractMesh).getBoundingInfo !== 'function') {
      return 1.0;
    }

    if (typeof (sharedParent as BABYLON.AbstractMesh).computeWorldMatrix === 'function') {
      (sharedParent as BABYLON.AbstractMesh).computeWorldMatrix(true);
    }

    const viewerWorldPosition = this.getViewerWorldPosition();
    if (!viewerWorldPosition) {
      return 1.0;
    }

    const boundingBox = (sharedParent as BABYLON.AbstractMesh).getBoundingInfo()?.boundingBox;
    if (!boundingBox) {
      return 1.0;
    }

    return this.isPointInsideBoundingBox(boundingBox, viewerWorldPosition) ? 1.0 : 0.22;
  }

  private getCrossFileEdgeVisibilityFactor(metadata: {
    fromFile: string | null;
    toFile: string | null;
    targetsExternalLibrary: boolean;
  }): number {
    if (!this.focusedFile) {
      return 1.0;
    }

    if (metadata.fromFile === this.focusedFile || metadata.toFile === this.focusedFile) {
      return 1.0;
    }

    if (metadata.targetsExternalLibrary) {
      return metadata.fromFile === this.focusedFile ? 1.0 : 0.18;
    }

    const fromDir = metadata.fromFile ? this.getDirectoryPathSafe(metadata.fromFile) : '';
    const toDir = metadata.toFile ? this.getDirectoryPathSafe(metadata.toFile) : '';
    return this.focusedDirectories.has(fromDir) || this.focusedDirectories.has(toDir)
      ? 0.56
      : 0.24;
  }

  private isPointInsideBoundingBox(
    boundingBox: BABYLON.BoundingBox,
    point: BABYLON.Vector3,
  ): boolean {
    if (typeof boundingBox.intersectsPoint === 'function') {
      return boundingBox.intersectsPoint(point);
    }

    const minimumWorld = (boundingBox as any).minimumWorld ?? boundingBox.minimum;
    const maximumWorld = (boundingBox as any).maximumWorld ?? boundingBox.maximum;
    if (!minimumWorld || !maximumWorld) {
      return true;
    }

    const padding = 0.5;
    return point.x >= (minimumWorld.x - padding)
      && point.x <= (maximumWorld.x + padding)
      && point.y >= (minimumWorld.y - padding)
      && point.y <= (maximumWorld.y + padding)
      && point.z >= (minimumWorld.z - padding)
      && point.z <= (maximumWorld.z + padding);
  }

  private getViewerWorldPosition(): BABYLON.Vector3 | null {
    const activeCamera = this.scene.activeCamera;
    if (!activeCamera) {
      return null;
    }

    const activeGlobal = (activeCamera as any).globalPosition as BABYLON.Vector3 | undefined;
    if (activeGlobal && Number.isFinite(activeGlobal.x) && Number.isFinite(activeGlobal.y) && Number.isFinite(activeGlobal.z)) {
      return typeof activeGlobal.clone === 'function'
        ? activeGlobal.clone()
        : new BABYLON.Vector3(activeGlobal.x, activeGlobal.y, activeGlobal.z);
    }

    if (activeCamera.position) {
      return typeof activeCamera.position.clone === 'function'
        ? activeCamera.position.clone()
        : new BABYLON.Vector3(activeCamera.position.x, activeCamera.position.y, activeCamera.position.z);
    }

    return null;
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

  private getDirectoryPathSafe(filePath: string): string {
    const normalized = toProjectRelativePath(filePath);
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex >= 0 ? normalized.slice(0, slashIndex) : '';
  }

}
