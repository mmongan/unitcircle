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
  private meshFactory!: MeshFactory;
  private graphLoader: GraphLoader;
  private currentNodeIds: Set<string> = new Set();
  private currentEdges: Set<string> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Initialize scene action manager for click handling
    this.scene.actionManager = new BABYLON.ActionManager(this.scene);

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
      this.renderCodeGraph(graph);
      
      // Track initial state for incremental updates
      this.currentNodeIds = new Set(graph.nodes.map(n => n.id));
      this.currentEdges = new Set(graph.edges.map(e => `${e.from}→${e.to}`));
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

        // Check for updates via lightweight version.json (only ~100 bytes)
        const hasUpdates = await this.graphLoader.checkForUpdates();
        if (!hasUpdates) {
          return;  // No updates, skip loading full graph
        }

        // Only load full graph.json if version changed
        const graph = await this.graphLoader.loadGraph();
        if (graph) {
          console.log('📊 Graph updated, refreshing visualization...');
          this.updateCodeGraph(graph);
        }
      } catch (error) {
        // Silent fail - polling is optional
      }
    }, SceneConfig.GRAPH_POLL_INTERVAL_MS);
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

  /**
   * Incrementally update the scene - only create/remove changed objects
   */
  private updateCodeGraph(graph: GraphData): void {
    this.validateGraphData(graph);

    // Compute layout for all nodes
    const edges = this.buildEdgeList(graph.edges);
    const layout = new ForceDirectedLayout(
      graph.nodes.map(n => n.id),
      edges
    );
    const layoutNodes = this.computeLayout(layout);

    // Track new node IDs and edge pairs
    const newNodeIds = new Set(graph.nodes.map(n => n.id));
    const newEdgePairs = new Set(
      graph.edges.map(e => `${e.from}→${e.to}`)
    );

    // Remove deleted nodes
    const removedNodeIds = Array.from(this.currentNodeIds).filter(id => !newNodeIds.has(id));
    for (const nodeId of removedNodeIds) {
      this.removeMeshesForNode(nodeId);
      this.currentNodeIds.delete(nodeId);
    }

    // Remove deleted edges
    const removedEdges = Array.from(this.currentEdges).filter(edge => !newEdgePairs.has(edge));
    for (const edgePair of removedEdges) {
      this.removeMeshesForEdge(edgePair);
      this.currentEdges.delete(edgePair);
    }

    // Create only new nodes
    const newNodes = graph.nodes.filter(n => !this.currentNodeIds.has(n.id));
    this.renderNodes(newNodes, layoutNodes);
    newNodes.forEach(n => this.currentNodeIds.add(n.id));

    // Create only new edges
    const newEdges = graph.edges.filter(
      e => !this.currentEdges.has(`${e.from}→${e.to}`)
    );
    this.renderEdges(newEdges, layoutNodes);
    newEdges.forEach(e => this.currentEdges.add(`${e.from}→${e.to}`));

    console.log(
      `✓ Updated code graph: ${removedNodeIds.length} removed, ${newNodes.length} created, ` +
      `${removedEdges.length} edges removed, ${newEdges.length} edges created`
    );
  }

  /**
   * Remove all meshes associated with a node
   */
  private removeMeshesForNode(nodeId: string): void {
    // Remove all meshes with this node's prefix (handles func_, var_, ext_ prefixes)
    const nodeMeshes = this.scene.meshes.filter(m => 
      m.name.includes(nodeId) && m.name.includes('_')
    );
    for (const mesh of nodeMeshes) {
      mesh.dispose();
    }
    
    // Remove label mesh
    const labelMesh = this.scene.meshes.find(m => m.name === `label_${nodeId}`);
    if (labelMesh) {
      labelMesh.dispose();
    }
    
    // Remove label textures
    const labelTexture = this.scene.textures.find(t => t.name === `labelTexture_${nodeId}`);
    if (labelTexture) {
      labelTexture.dispose();
    }
    
    // Remove signature texture
    const sigTexture = this.scene.textures.find(t => t.name === `signatureTexture_${nodeId}`);
    if (sigTexture) {
      sigTexture.dispose();
    }
  }

  /**
   * Remove meshes associated with an edge
   */
  private removeMeshesForEdge(edgePair: string): void {
    const edgeId = `edge_${edgePair.replace('→', '_to_')}`;
    const meshes = this.scene.meshes.filter(m => m.name.startsWith(edgeId));
    for (const mesh of meshes) {
      mesh.dispose();
    }
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
    
    // Store node reference on the mesh for later retrieval
    (mesh as any).nodeData = node;
    
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
    
    // Use scene-level pick trigger to capture the exact hit point
    const originalFlyTo = this.sceneRootFlyTo.bind(this);
    this.scene.onPointerObservable.add((pointerEvent) => {
      if (pointerEvent.type === BABYLON.PointerEventTypes.POINTERDOWN && mesh.isPickable) {
        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        if (pickResult && pickResult.hit && pickResult.pickedMesh === mesh) {
          // Get the normal at the clicked point to determine which face was clicked
          const normal = pickResult.getNormal(true);
          // Verify the mesh corresponds to the correct node and fly to it
          const clickedNode = (mesh as any).nodeData as GraphNode;
          if (clickedNode) {
            // Use world position, not local position, since scene root moves
            originalFlyTo(mesh.getAbsolutePosition(), normal ?? undefined);
          }
        }
      }
    });
  }

  private sceneRootFlyTo(targetPosition: BABYLON.Vector3, faceNormal?: BABYLON.Vector3): void {
    // Stop any existing animation on the scene root
    this.scene.stopAnimation(this.sceneRoot);

    const cameraPosition = SceneConfig.CAMERA_POSITION;
    const viewOffset = SceneConfig.FLY_TO_OFFSET;

    // Landing position: on top of the cube (add height for landing on top surface)
    const landingHeight = SceneConfig.FUNCTION_BOX_SIZE / 2 + 3;  // Land on top with 3 unit offset
    const targetSceneRootPosition = cameraPosition
      .add(viewOffset)
      .subtract(targetPosition)
      .add(new BABYLON.Vector3(0, landingHeight, 0));

    // Calculate rotation to face the clicked face toward camera
    let rotationQuaternion = BABYLON.Quaternion.Identity();
    if (faceNormal) {
      // Create a rotation that orients the face normal to point toward camera
      const targetDirection = BABYLON.Vector3.Zero().subtract(cameraPosition).normalize();
      
      // Create rotation to align faceNormal with targetDirection
      rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(faceNormal, targetDirection, rotationQuaternion);
    }

    // Create parabolic position animation
    const positionAnimation = new BABYLON.Animation(
      'sceneRootFlyPosition',
      'position',
      SceneConfig.FLY_TO_ANIMATION_FPS,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3
    );
    
    const startPos = this.sceneRoot.position.clone();
    const totalFrames = (SceneConfig.FLY_TO_ANIMATION_TIME_MS / 1000) * SceneConfig.FLY_TO_ANIMATION_FPS;
    const peakHeight = 15;  // Maximum height above starting point
    
    // Create keyframes along parabolic path
    const keys = [];
    for (let i = 0; i <= totalFrames; i++) {
      const t = i / totalFrames;  // 0 to 1
      
      // Linear interpolation for X and Z
      const x = startPos.x + (targetSceneRootPosition.x - startPos.x) * t;
      const z = startPos.z + (targetSceneRootPosition.z - startPos.z) * t;
      
      // Parabolic path for Y: peak at t=0.5, reach target at t=1
      // Formula: y = startY + gravity_arc + (targetY - startY) * t
      // where gravity_arc = -peakHeight * (1 - 4*(t-0.5)²) creates upward arc
      const gravityArc = -peakHeight * Math.max(0, 1 - 4 * Math.pow(t - 0.5, 2));
      const y = startPos.y + (targetSceneRootPosition.y - startPos.y) * t + gravityArc;
      
      keys.push({
        frame: i,
        value: new BABYLON.Vector3(x, y, z),
      });
    }
    positionAnimation.setKeys(keys);
    
    this.scene.beginDirectAnimation(
      this.sceneRoot,
      [positionAnimation],
      0,
      totalFrames,
      false
    );

    // If a face normal was provided, also animate rotation
    if (faceNormal && !rotationQuaternion.equals(BABYLON.Quaternion.Identity())) {
      const rotationAnimation = new BABYLON.Animation(
        'sceneRootFlyRotation',
        'rotationQuaternion',
        SceneConfig.FLY_TO_ANIMATION_FPS,
        BABYLON.Animation.ANIMATIONTYPE_QUATERNION
      );
      
      const rotKeys = [];
      rotKeys.push({
        frame: 0,
        value: this.sceneRoot.rotationQuaternion || BABYLON.Quaternion.Identity(),
      });
      rotKeys.push({
        frame: totalFrames,
        value: rotationQuaternion,
      });
      rotationAnimation.setKeys(rotKeys);
      
      // Add easing to rotation as well for consistency
      const rotationEasing = new BABYLON.QuadraticEase();
      rotationEasing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
      rotationAnimation.setEasingFunction(rotationEasing);

      this.scene.beginDirectAnimation(
        this.sceneRoot,
        [rotationAnimation],
        0,
        totalFrames,
        false
      );
    }
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
