import * as BABYLON from '@babylonjs/core';
import { ForceDirectedLayout } from './ForceDirectedLayout';
import type { GraphData, GraphNode } from './types';
import { MeshFactory } from './MeshFactory';
import { GraphLoader } from './GraphLoader';
import { SceneConfig } from './SceneConfig';

export class VRSceneManager {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.UniversalCamera;
  private sceneRoot!: BABYLON.TransformNode;
  private lastGraphUpdate: string = '';
  private meshFactory!: MeshFactory;
  private graphLoader: GraphLoader;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Create scene root transform - all objects will be parented to this
    this.sceneRoot = new BABYLON.TransformNode('sceneRoot', this.scene);

    // Initialize services
    this.meshFactory = new MeshFactory(this.scene, this.sceneRoot);
    this.graphLoader = new GraphLoader(SceneConfig.GRAPH_POLL_INTERVAL_MS);

    // Setup lighting
    this.setupLighting();

    // Create a camera with wider view
    this.setupCamera(canvas);

    // Create a simple ground
    this.createGround();

    // Setup WebXR (non-blocking)
    this.setupWebXR();

    // Handle window resize
    window.addEventListener('resize', () => this.engine.resize());
  }

  /**
   * Initialize the scene visualization - must be called after construction
   */
  async initialize(): Promise<void> {
    console.log('📦 Initializing code visualization...');
    
    // Load and render the code graph
    await this.initializeCodeVisualization();
    
    // Start polling for graph updates
    this.setupGraphPolling();
  }

  private setupLighting(): void {
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
    light.intensity = SceneConfig.LIGHT_INTENSITY;

    const pointLight = new BABYLON.PointLight(
      'pointLight',
      SceneConfig.POINT_LIGHT_POSITION,
      this.scene
    );
    pointLight.intensity = SceneConfig.POINT_LIGHT_INTENSITY;
  }

  private setupCamera(canvas: HTMLCanvasElement): void {
    this.camera = new BABYLON.UniversalCamera(
      'camera',
      SceneConfig.CAMERA_POSITION,
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.inertia = SceneConfig.CAMERA_INERTIA;
    this.camera.angularSensibility = SceneConfig.CAMERA_ANGULAR_SENSIBILITY;
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      'ground',
      { width: SceneConfig.GROUND_WIDTH, height: SceneConfig.GROUND_HEIGHT },
      this.scene
    );
    ground.parent = this.sceneRoot;
    ground.visibility = 0;
  }

  private async initializeCodeVisualization(): Promise<void> {
    try {
      console.log('📦 Initializing code visualization...');
      const graph = await this.graphLoader.loadGraph();
      
      if (!graph) {
        console.error('❌ Failed to load graph: graph is null or undefined');
        return;
      }
      
      if (!graph.nodes || graph.nodes.length === 0) {
        console.error('❌ Failed to load graph: no nodes found');
        return;
      }
      
      console.log(`✓ Graph loaded: ${graph.nodes.length} nodes, ${graph.edges?.length || 0} edges`);
      this.validateGraphData(graph);
      this.lastGraphUpdate = graph.lastUpdated || '';
      this.renderCodeGraph(graph);
    } catch (error) {
      console.error('❌ Error initializing code visualization:', error);
    }
  }

  private validateGraphData(graph: GraphData): boolean {
    return graph.nodes && graph.nodes.length > 0 && graph.edges && Array.isArray(graph.edges);
  }

  private setupGraphPolling(): void {
    setInterval(async () => {
      try {
        if (!this.graphLoader.shouldPoll()) {
          return;
        }

        const graph = await this.graphLoader.loadGraph();
        if (graph && this.graphLoader.hasGraphUpdated(this.lastGraphUpdate)) {
          console.log('📊 Graph updated, refreshing visualization...');
          this.lastGraphUpdate = graph.lastUpdated;
          this.clearGraph();
          this.validateGraphData(graph);
          this.renderCodeGraph(graph);
        }
      } catch (error) {
        // Silent fail - polling is optional
      }
    }, SceneConfig.GRAPH_POLL_INTERVAL_MS);
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

  public renderCodeGraph(graph: GraphData): void {
    // Create positions using force-directed layout
    const edges = this.buildEdgeList(graph.edges);
    const layout = new ForceDirectedLayout(
      graph.nodes.map(n => n.id),
      edges
    );
    const layoutNodes = this.computeLayout(layout);

    this.renderNodes(graph.nodes, layoutNodes);
    this.renderEdges(graph.edges, layoutNodes);

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions and ${graph.edges.length} calls`);
  }

  private buildEdgeList(edges: Array<{ from: string; to: string }>): ForceDirectedLayout['edges'] {
    return edges.map(e => ({ source: e.from, target: e.to }));
  }

  private computeLayout(layout: ForceDirectedLayout): Map<string, any> {
    return layout.simulate(SceneConfig.LAYOUT_ITERATIONS);
  }

  private renderNodes(
    nodes: GraphNode[],
    layoutNodes: Map<string, any>
  ): void {
    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id);
      if (!layoutNode) continue;

      const position = new BABYLON.Vector3(
        layoutNode.position.x,
        layoutNode.position.y,
        layoutNode.position.z
      );

      this.meshFactory.createNodeMesh(node, position, (mesh, material, n) =>
        this.setupNodeInteraction(mesh, material, n)
      );
    }
  }

  private setupNodeInteraction(
    mesh: BABYLON.Mesh,
    material: BABYLON.StandardMaterial,
    node: GraphNode
  ): void {
    const originalColor = material.emissiveColor.clone();
    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        material.emissiveColor = SceneConfig.HOVER_COLOR;
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
        this.sceneRootFlyTo(mesh.position);
      })
    );
  }

  private sceneRootFlyTo(targetPosition: BABYLON.Vector3): void {
    // Stop any existing animation on the scene root
    this.scene.stopAnimation(this.sceneRoot);

    // Animate scene root position to place object directly below camera (top-down view)
    // Camera is fixed at CAMERA_POSITION; position object directly below
    const cameraPosition = SceneConfig.CAMERA_POSITION;

    // Top-down viewing position: object centered below camera
    const viewOffset = SceneConfig.FLY_TO_OFFSET;

    // Calculate where the target should appear in world space
    const desiredWorldPosition = cameraPosition.add(viewOffset);

    // Calculate scene root offset to position target at desired world position
    const sceneOffset = desiredWorldPosition.subtract(targetPosition);

    // Animate scene root movement
    BABYLON.Animation.CreateAndStartAnimation(
      'sceneRootFly',
      this.sceneRoot,
      'position',
      SceneConfig.FLY_TO_ANIMATION_FPS,
      (SceneConfig.FLY_TO_ANIMATION_TIME_MS / 1000) * SceneConfig.FLY_TO_ANIMATION_FPS,
      this.sceneRoot.position.clone(),
      sceneOffset,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
  }

  private renderEdges(edges: Array<{ from: string; to: string }>, layoutNodes: Map<string, any>): void {
    this.meshFactory.createEdges(edges, layoutNodes);
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
