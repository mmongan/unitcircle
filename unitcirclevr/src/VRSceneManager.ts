import * as BABYLON from '@babylonjs/core';
import { ForceDirectedLayout } from './ForceDirectedLayout';

interface GraphData {
  nodes: Array<{ 
    id: string; 
    name: string; 
    file?: string; 
    line?: number; 
    isExported?: boolean;
    type?: 'function' | 'variable' | 'external';
  }>;
  edges: Array<{ from: string; to: string }>;
  lastUpdated: string;
}

export class VRSceneManager {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.UniversalCamera;
  private sceneRoot!: BABYLON.TransformNode;
  private lastGraphUpdate: string = '';

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Create scene root transform - all objects will be parented to this
    this.sceneRoot = new BABYLON.TransformNode('sceneRoot', this.scene);

    // Setup lighting
    this.setupLighting();

    // Create a camera with wider view
    this.setupCamera(canvas);

    // Create a simple ground
    this.createGround();

    // Initialize code visualization
    this.initializeCodeVisualization();

    // Setup WebXR
    this.setupWebXR();

    // Handle window resize
    window.addEventListener('resize', () => this.engine.resize());

    // Poll for graph updates (every 2 seconds)
    this.setupGraphPolling();
  }

  private setupLighting(): void {
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
    light.intensity = 0.7;

    this.createPointLight();
  }

  private createPointLight(): void {
    const pointLight = new BABYLON.PointLight('pointLight', new BABYLON.Vector3(5, 10, 5), this.scene);
    pointLight.intensity = 0.5;
  }

  private setupCamera(canvas: HTMLCanvasElement): void {
    this.camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, -70), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.inertia = 0.5;
    this.camera.angularSensibility = 1000;
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 150, height: 150 }, this.scene);
    ground.parent = this.sceneRoot;
    ground.material = new BABYLON.StandardMaterial('groundMat', this.scene);
    (ground.material as BABYLON.StandardMaterial).emissiveColor = new BABYLON.Color3(0.2, 0.7, 0.2);
  }

  private async initializeCodeVisualization(): Promise<void> {
    try {
      const graph = await this.loadGraph();
      if (graph && graph.nodes.length > 0) {
        this.validateGraphData(graph);
        this.renderCodeGraph(graph);
      }
    } catch (error) {
      console.error('Error initializing code visualization:', error);
    }
  }

  private validateGraphData(graph: GraphData): boolean {
    return graph.nodes && graph.nodes.length > 0 && graph.edges && Array.isArray(graph.edges);
  }

  private async loadGraph(): Promise<GraphData | null> {
    try {
      const response = await fetch('/unitcircle/graph.json');
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Could not load graph.json:', error);
    }
    return null;
  }

  private setupGraphPolling(): void {
    setInterval(async () => {
      try {
        const graph = await this.loadGraph();
        if (graph && graph.lastUpdated !== this.lastGraphUpdate) {
          console.log('📊 Graph updated, refreshing visualization...');
          this.lastGraphUpdate = graph.lastUpdated;
          this.clearGraph();
          this.validateGraphData(graph);
          this.renderCodeGraph(graph);
        }
      } catch (error) {
        // Silent fail - polling is optional
      }
    }, 2000);
  }

  private clearGraph(): void {
    // Remove all graph meshes (keep ground and lights)
    const meshes = this.scene.meshes.filter(m => m.name.startsWith('func_') || m.name.startsWith('var_') || m.name.startsWith('ext_') || m.name.startsWith('edge_') || m.name.startsWith('label_'));
    for (const mesh of meshes) {
      mesh.dispose();
    }
    
    // Dispose all label textures
    this.scene.textures.forEach(texture => {
      if (texture.name.startsWith('labelTexture_')) {
        texture.dispose();
      }
    });
  }

  private renderCodeGraph(graph: GraphData): void {
    // Create positions using force-directed layout
    const edges = this.buildEdgeList(graph.edges);
    const layout = new ForceDirectedLayout(
      graph.nodes.map(n => n.id),
      edges
    );
    const layoutNodes = this.computeLayout(layout);

    // Find functions that call other functions (have outgoing edges)
    const functionsWithCalls = this.extractCallingFunctions(graph.edges);

    this.renderNodes(graph.nodes, layoutNodes, functionsWithCalls);
    this.renderEdges(graph.edges, layoutNodes);

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions and ${graph.edges.length} calls`);
  }

  private buildEdgeList(edges: Array<{ from: string; to: string }>): ForceDirectedLayout['edges'] {
    return edges.map(e => ({ source: e.from, target: e.to }));
  }

  private computeLayout(layout: ForceDirectedLayout): Map<string, any> {
    return layout.simulate(100);
  }

  private extractCallingFunctions(edges: Array<{ from: string; to: string }>): Set<string> {
    return new Set(edges.map(e => e.from));
  }

  private renderNodes(nodes: GraphData['nodes'], layoutNodes: Map<string, any>, functionsWithCalls: Set<string>): void {
    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id);
      if (!layoutNode) continue;

      const position = new BABYLON.Vector3(
        layoutNode.position.x,
        layoutNode.position.y,
        layoutNode.position.z
      );

      this.createNodeMesh(node, position, functionsWithCalls);
    }
  }

  private createNodeMesh(node: GraphData['nodes'][0], position: BABYLON.Vector3, functionsWithCalls: Set<string>): void {
    if (node.type === 'external') {
      this.createExternalModuleMesh(node, position);
    } else if (node.type === 'variable') {
      this.createVariableMesh(node, position);
    } else {
      this.createFunctionMesh(node, position, functionsWithCalls);
    }
  }

  private createExternalModuleMesh(node: GraphData['nodes'][0], position: BABYLON.Vector3): void {
    const externalModuleColor = new BABYLON.Color3(0.4, 0.8, 1);
    const cylinder = BABYLON.MeshBuilder.CreateCylinder(`ext_${node.id}`, { height: 2.0, diameterTop: 1.2, diameterBottom: 1.2 }, this.scene);
    cylinder.position = position;
    cylinder.parent = this.sceneRoot;

    const material = new BABYLON.StandardMaterial(`extMat_${node.id}`, this.scene);
    material.emissiveColor = externalModuleColor;
    material.wireframe = false;
    cylinder.material = material;

    this.createLabel(node.name, cylinder.position);
    this.setupNodeInteraction(cylinder, material, node);
  }

  private createVariableMesh(node: GraphData['nodes'][0], position: BABYLON.Vector3): void {
    const exportedVarColor = new BABYLON.Color3(1, 0.8, 0.2);
    const unexportedVarColor = new BABYLON.Color3(0.6, 0.6, 0.6);
    
    const sphere = BABYLON.MeshBuilder.CreateSphere(`var_${node.id}`, { diameter: 1.5 }, this.scene);
    sphere.position = position;
    sphere.parent = this.sceneRoot;

    const material = new BABYLON.StandardMaterial(`varMat_${node.id}`, this.scene);
    material.emissiveColor = node.isExported ? exportedVarColor : unexportedVarColor;
    material.wireframe = false;
    sphere.material = material;

    this.createLabel(node.name, sphere.position);
    this.setupNodeInteraction(sphere, material, node);
  }

  private createFunctionMesh(node: GraphData['nodes'][0], position: BABYLON.Vector3, functionsWithCalls: Set<string>): void {
    const exportedColor = new BABYLON.Color3(0.2, 1, 0.8);
    const leafColor = new BABYLON.Color3(0.8, 0.8, 0.8);
    const nonExportedColors = [
      new BABYLON.Color3(1, 0.2, 0.2),
      new BABYLON.Color3(0.2, 1, 0.2),
      new BABYLON.Color3(0.2, 0.2, 1),
      new BABYLON.Color3(1, 1, 0.2),
      new BABYLON.Color3(1, 0.2, 1),
    ];

    const box = BABYLON.MeshBuilder.CreateBox(`func_${node.id}`, { size: 2.0 }, this.scene);
    box.position = position;
    box.parent = this.sceneRoot;

    const material = new BABYLON.StandardMaterial(`mat_${node.id}`, this.scene);
    
    if (node.isExported) {
      material.emissiveColor = exportedColor;
    } else if (functionsWithCalls.has(node.id)) {
      const colorIndex = Math.floor(Math.random() * nonExportedColors.length);
      material.emissiveColor = nonExportedColors[colorIndex];
    } else {
      material.emissiveColor = leafColor;
    }
    
    material.wireframe = false;
    box.material = material;

    this.createLabel(node.name, box.position);
    this.setupNodeInteraction(box, material, node);
  }

  private setupNodeInteraction(mesh: BABYLON.Mesh, material: BABYLON.StandardMaterial, node: GraphData['nodes'][0]): void {
    const originalColor = material.emissiveColor.clone();
    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.showTooltip(node);
      })
    );
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        material.emissiveColor = originalColor.clone();
        this.hideTooltip();
      })
    );
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () => {
        this.sceneRootFlyTo(mesh.position, node);
      })
    );
  }

  private sceneRootFlyTo(targetPosition: BABYLON.Vector3, node: GraphData['nodes'][0]): void {
    // Animate scene root position to place object directly below camera (top-down view)
    // Camera is fixed at (0, 0, -70); position object directly below
    const cameraPosition = new BABYLON.Vector3(0, 0, -70);
    
    // Top-down viewing position: object centered below camera
    const viewOffset = new BABYLON.Vector3(0, 0, -5);
    
    // Calculate where the target should appear in world space
    const desiredWorldPosition = cameraPosition.add(viewOffset);
    
    // Calculate scene root offset to position target at desired world position
    const sceneOffset = desiredWorldPosition.subtract(targetPosition);

    // Animate scene root movement over 800ms
    BABYLON.Animation.CreateAndStartAnimation(
      'sceneRootFly',
      this.sceneRoot,
      'position',
      60,
      48, // 800ms at 60fps
      this.sceneRoot.position.clone(),
      sceneOffset,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    // Show function signature panel after animation completes (800ms)
    setTimeout(() => this.showFunctionSignature(node), 800);
  }

  private showFunctionSignature(node: GraphData['nodes'][0]): void {
    // Create or update the signature panel
    const existing = document.getElementById('signaturePanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'signaturePanel';
    
    // Build signature display
    let signatureHtml = `<div><strong>${node.name}</strong></div>`;
    
    if (node.isExported) {
      signatureHtml += `<div style="color: #00ff00; margin-top: 4px;">📤 Exported</div>`;
    } else {
      signatureHtml += `<div style="color: #ffaa00; margin-top: 4px;">📦 Internal</div>`;
    }
    
    if (node.file) {
      signatureHtml += `<div style="color: #88ff88; margin-top: 4px;">📄 ${node.file}</div>`;
    }
    
    if (node.line) {
      signatureHtml += `<div style="color: #88ff88;">📍 Line ${node.line}</div>`;
    }
    
    if (node.type) {
      const typeLabel = node.type === 'function' ? '⚙️ Function' : node.type === 'variable' ? '📊 Variable' : '🔌 External';
      signatureHtml += `<div style="color: #aaccff; margin-top: 4px;">${typeLabel}</div>`;
    }
    
    panel.innerHTML = `
      <div style="background: rgba(0, 0, 0, 0.95); color: white; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 14px; border: 2px solid #00ff00; max-width: 300px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.8);">
        ${signatureHtml}
      </div>
    `;
    
    panel.style.position = 'fixed';
    panel.style.top = '50%';
    panel.style.left = '50%';
    panel.style.transform = 'translate(-50%, -50%)';
    panel.style.zIndex = '1000';
    
    document.body.appendChild(panel);
  }

  private renderEdges(edges: Array<{ from: string; to: string }>, layoutNodes: Map<string, any>): void {
    const edgeMaterial = new BABYLON.StandardMaterial('edgeMaterial', this.scene);
    edgeMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);

    let edgeIndex = 0;
    for (const edge of edges) {
      this.renderEdge(edge, layoutNodes, edgeMaterial, edgeIndex++);
    }
  }

  private renderEdge(edge: { from: string; to: string }, layoutNodes: Map<string, any>, material: BABYLON.StandardMaterial, index: number): void {
    const sourceNode = layoutNodes.get(edge.from);
    const targetNode = layoutNodes.get(edge.to);

    if (sourceNode && targetNode) {
      const points = [
        new BABYLON.Vector3(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z),
        new BABYLON.Vector3(targetNode.position.x, targetNode.position.y, targetNode.position.z)
      ];

      const tube = BABYLON.MeshBuilder.CreateTube(`edge_${index}`, {
        path: points,
        radius: 0.2
      });
      tube.parent = this.sceneRoot;
      tube.material = material;
    }
  }

  private createLabel(text: string, position: BABYLON.Vector3): void {
    // Create dynamic texture for text
    const dynamicTexture = new BABYLON.DynamicTexture('labelTexture_' + text, 512, this.scene);
    const ctx = dynamicTexture.getContext() as any;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 512, 512);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 256);
    
    dynamicTexture.update();

    // Create plane for label
    const labelPlane = BABYLON.MeshBuilder.CreatePlane(`label_${text}`, { width: 2, height: 0.5 }, this.scene);
    labelPlane.position = position.add(new BABYLON.Vector3(0, 1.2, 0));
    labelPlane.parent = this.sceneRoot;
    labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera

    const labelMaterial = new BABYLON.StandardMaterial(`labelMat_${text}`, this.scene);
    labelMaterial.emissiveTexture = dynamicTexture;
    labelMaterial.backFaceCulling = false;
    labelPlane.material = labelMaterial;
  }

  private showTooltip(node: { name: string; file?: string; line?: number }): void {
    // Create HTML tooltip element
    const existing = document.getElementById('tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.id = 'tooltip';
    
    let tooltipContent = `<div><strong>${node.name}</strong></div>`;
    if (node.file) {
      tooltipContent += `<div style="color: #88ff88; margin-top: 4px;">📄 ${node.file}</div>`;
    }
    if (node.line) {
      tooltipContent += `<div style="color: #88ff88;">📍 Line ${node.line}</div>`;
    }
    
    tooltip.innerHTML = `
      <div style="background: rgba(0, 0, 0, 0.9); color: white; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; border: 2px solid #00ff00; max-width: 250px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);">
        ${tooltipContent}
      </div>
    `;
    
    tooltip.style.position = 'fixed';
    tooltip.style.top = '20px';
    tooltip.style.right = '20px';
    tooltip.style.zIndex = '1000';
    
    document.body.appendChild(tooltip);
  }

  private hideTooltip(): void {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) tooltip.remove();
  }

  private async setupWebXR(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await this.scene.createDefaultXRExperienceAsync();
      console.log('WebXR experience created successfully');
    } catch (error) {
      console.warn('WebXR not available or failed to initialize:', error);
    }
  }

  public run(): void {
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }

  public dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}
