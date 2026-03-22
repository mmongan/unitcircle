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
  private isAnimating: boolean = false;
  private fileColorMap: Map<string, BABYLON.Color3> = new Map();
  private currentFunctionId: string | null = null;
  private currentFaceNormal: BABYLON.Vector3 | null = null;
  private xrExperience: BABYLON.WebXRDefaultExperience | null = null;
  
  // Flight controls
  private flightSpeed = 100;  // Units per second
  private keysPressed: Map<string, boolean> = new Map();
  private isFlying = false;

  // Real-time physics
  private layout: ForceDirectedLayout | null = null;
  private nodeMeshMap: Map<string, BABYLON.Mesh> = new Map();  // Map node IDs to their meshes
  private physicsActive = false;
  private physicsIterationCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Initialize scene action manager for click handling
    this.scene.actionManager = new BABYLON.ActionManager(this.scene);

    // Create scene root transform - all objects will be parented to this
    this.sceneRoot = new BABYLON.TransformNode('sceneRoot', this.scene);

    // Initialize services
    this.meshFactory = new MeshFactory(this.scene);
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

    // Setup flight controls
    this.setupFlightControls();

    // Setup single scene-level click handler
    this.setupClickHandler();
  }

  /**
   * Add a single scene-level observer for all mesh clicks
   */
  private setupClickHandler(): void {
    this.scene.onPointerObservable.add((pointerEvent) => {
      if (pointerEvent.type === BABYLON.PointerEventTypes.POINTERDOWN && !this.isAnimating) {
        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        if (pickResult && pickResult.hit && pickResult.pickedMesh) {
          const clickedNode = (pickResult.pickedMesh as any).nodeData as GraphNode;
          if (clickedNode) {
            let faceNormal = (pickResult as any).normal || new BABYLON.Vector3(0, 0, 1);
            const pickedPoint = (pickResult as any).pickedPoint as BABYLON.Vector3;
            const cubePosition = pickResult.pickedMesh.position;
            
            // Check if click is near an edge (within 10% of cube size) and get adjacent face if so
            const adjacentFaceNormal = this.getAdjacentFaceIfNearEdge(pickedPoint, cubePosition, faceNormal);
            if (adjacentFaceNormal) {
              faceNormal = adjacentFaceNormal;
            }
            
            const isSameFunction = clickedNode.id === this.currentFunctionId;
            const isSameFace = isSameFunction && this.isFaceNormalEqual(faceNormal, this.currentFaceNormal);
            
            try {
              if (isSameFace) {
                // Same face clicked again - slide to show that face
                this.slideFaceView(pickResult.pickedMesh.position, faceNormal);
              } else if (isSameFunction) {
                // Different face of same function - slide to new face
                this.currentFaceNormal = faceNormal.clone();
                this.slideFaceView(pickResult.pickedMesh.position, faceNormal);
              } else {
                // Different function - jump to it
                this.currentFunctionId = clickedNode.id;
                this.currentFaceNormal = faceNormal.clone();  // Preserve the face we're landing on
                this.sceneRootFlyTo(pickResult.pickedMesh.position);
              }
            } catch (error) {
              console.error('Error during animation setup:', error);
              this.isAnimating = false;  // Reset on error
            }
          }
        }
      }
    });
  }

  /**
   * Check if click is within 10% of a cube edge and return adjacent face normal if so
   */
  /**
   * Setup keyboard and mouse controls for free flight
   */
  private setupFlightControls(): void {
    // Keyboard event listeners for WASD movement
    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'shift', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        this.keysPressed.set(key, true);
        this.isFlying = true;
      }
    });

    document.addEventListener('keyup', (event) => {
      const key = event.key.toLowerCase();
      this.keysPressed.set(key, false);
      // Stop flying if no keys are pressed
      if ([...this.keysPressed.values()].every(v => !v)) {
        this.isFlying = false;
      }
    });

    // Update flight each frame
    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.isFlying) {
          this.updateFlight();
        }
      });
    }
  }

  /**
   * Update camera position based on keyboard input for free flight
   */
  private updateFlight(): void {
    const deltaTime = this.engine.getDeltaTime() / 1000; // Convert to seconds
    const distance = this.flightSpeed * deltaTime;

    // Get camera direction vectors
    const forward = this.camera.getDirection(BABYLON.Axis.Z);
    const right = this.camera.getDirection(BABYLON.Axis.X);
    const up = BABYLON.Axis.Y;

    // Process keyboard input
    if (this.keysPressed.get('w') || this.keysPressed.get('arrowup')) {
      // Move forward
      this.camera.position.addInPlace(forward.scale(distance));
    }
    if (this.keysPressed.get('s') || this.keysPressed.get('arrowdown')) {
      // Move backward
      this.camera.position.addInPlace(forward.scale(-distance));
    }
    if (this.keysPressed.get('a') || this.keysPressed.get('arrowleft')) {
      // Move left
      this.camera.position.addInPlace(right.scale(-distance));
    }
    if (this.keysPressed.get('d') || this.keysPressed.get('arrowright')) {
      // Move right
      this.camera.position.addInPlace(right.scale(distance));
    }
    if (this.keysPressed.get(' ')) {
      // Move up
      this.camera.position.addInPlace(up.scale(distance));
    }
    if (this.keysPressed.get('shift') || this.keysPressed.get('control')) {
      // Move down
      this.camera.position.addInPlace(up.scale(-distance));
    }
  }

  /**
   * Set up per-frame physics updates for force-directed layout
   */
  private setupPhysicsLoop(): void {
    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.physicsActive && this.layout) {
          // Apply one iteration of forces
          const stillConverging = this.layout.updateFrame();
          
          // Update mesh positions from layout
          const layoutNodes = this.layout.getNodes();
          for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
            const layoutNode = layoutNodes.get(nodeId);
            if (layoutNode && mesh.position) {
              mesh.position.x = layoutNode.position.x;
              mesh.position.y = layoutNode.position.y;
              mesh.position.z = layoutNode.position.z;
            }
          }

          // Update edge cylinders to follow moving nodes
          this.meshFactory.updateEdges();

          // Stop physics after ~5 seconds (300 frames at 60fps) of settling
          this.physicsIterationCount++;
          if (this.physicsIterationCount > 300 || !stillConverging) {
            this.physicsActive = false;
          }
        }
      });
    }
  }

  private getAdjacentFaceIfNearEdge(pickedPoint: BABYLON.Vector3, cubePosition: BABYLON.Vector3, faceNormal: BABYLON.Vector3): BABYLON.Vector3 | null {
    if (!pickedPoint) return null;
    
    const cubeHalfSize = SceneConfig.FUNCTION_BOX_SIZE / 2;  // 2.0
    const edgeThreshold = cubeHalfSize * 0.1;  // 10% of half-size = 0.2
    
    // Convert picked point to local coordinates relative to cube center
    const localPoint = pickedPoint.subtract(cubePosition);
    
    // Determine which face was clicked based on normal and find edge
    // The normal should point to one of 6 cardinal directions
    const absNormal = new BABYLON.Vector3(Math.abs(faceNormal.x), Math.abs(faceNormal.y), Math.abs(faceNormal.z));
    
    // Determine which face (X, Y, or Z aligned) and get the 2D coordinates on that face
    if (absNormal.x > 0.9) {
      // Face is X-aligned (left or right)
      const y = localPoint.y;
      const z = localPoint.z;
      
      // Check if near top edge (positive Z)
      if (z > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(0, 0, 1);  // Top face
      }
      // Check if near bottom edge (negative Z)
      if (z < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(0, 0, -1);  // Bottom face
      }
      // Check if near back edge (positive Y)
      if (y > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(0, 1, 0);  // Back face
      }
      // Check if near front edge (negative Y)
      if (y < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(0, -1, 0);  // Front face
      }
    } else if (absNormal.y > 0.9) {
      // Face is Y-aligned (front or back)
      const x = localPoint.x;
      const z = localPoint.z;
      
      // Check if near top edge (positive Z)
      if (z > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(0, 0, 1);  // Top face
      }
      // Check if near bottom edge (negative Z)
      if (z < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(0, 0, -1);  // Bottom face
      }
      // Check if near right edge (positive X)
      if (x > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(1, 0, 0);  // Right face
      }
      // Check if near left edge (negative X)
      if (x < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(-1, 0, 0);  // Left face
      }
    } else if (absNormal.z > 0.9) {
      // Face is Z-aligned (top or bottom)
      const x = localPoint.x;
      const y = localPoint.y;
      
      // Check if near right edge (positive X)
      if (x > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(1, 0, 0);  // Right face
      }
      // Check if near left edge (negative X)
      if (x < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(-1, 0, 0);  // Left face
      }
      // Check if near back edge (positive Y)
      if (y > cubeHalfSize - edgeThreshold) {
        return new BABYLON.Vector3(0, 1, 0);  // Back face
      }
      // Check if near front edge (negative Y)
      if (y < -cubeHalfSize + edgeThreshold) {
        return new BABYLON.Vector3(0, -1, 0);  // Front face
      }
    }
    
    return null;  // Not near any edge
  }

  /**
   * Compare two face normals with floating-point tolerance
   */
  private isFaceNormalEqual(a: BABYLON.Vector3 | null, b: BABYLON.Vector3 | null): boolean {
    if (!a || !b) return false;
    const tolerance = 0.1;  // Allow small floating-point differences
    return (
      Math.abs(a.x - b.x) < tolerance &&
      Math.abs(a.y - b.y) < tolerance &&
      Math.abs(a.z - b.z) < tolerance
    );
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

  /**
   * Generate a unique, consistent color for a file based on its name
   */
  private getFileColor(fileName: string): BABYLON.Color3 {
    // Return cached color if already generated
    if (this.fileColorMap.has(fileName)) {
      return this.fileColorMap.get(fileName)!;
    }

    // Generate color from filename hash
    const color = this.generateColorFromString(fileName);
    this.fileColorMap.set(fileName, color);
    return color;
  }

  /**
   * Generate a consistent color from a string using a simple hash algorithm
   */
  private generateColorFromString(str: string): BABYLON.Color3 {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    // Convert hash to RGB - use different ranges to get vibrant colors
    const hue = (Math.abs(hash) % 360) / 360;
    const saturation = 0.5 + ((Math.abs(hash) >> 8) % 100) / 200; // 0.5-1.0
    const brightness = 0.6 + ((Math.abs(hash) >> 16) % 100) / 250; // 0.6-1.0

    // Convert HSB to RGB
    const rgb = this.hsbToRgb(hue, saturation, brightness);
    return new BABYLON.Color3(rgb.r, rgb.g, rgb.b);
  }

  /**
   * Convert HSB color space to RGB
   */
  private hsbToRgb(h: number, s: number, b: number): { r: number; g: number; b: number } {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = b * (1 - s);
    const q = b * (1 - f * s);
    const t = b * (1 - (1 - f) * s);

    let r = 0, g = 0, b_out = 0;
    switch (i % 6) {
      case 0:
        (r = b), (g = t), (b_out = p);
        break;
      case 1:
        (r = q), (g = b), (b_out = p);
        break;
      case 2:
        (r = p), (g = b), (b_out = t);
        break;
      case 3:
        (r = p), (g = q), (b_out = b);
        break;
      case 4:
        (r = t), (g = p), (b_out = b);
        break;
      case 5:
        (r = b), (g = p), (b_out = q);
        break;
    }

    return { r, g, b: b_out };
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
    // Set camera to look at the center of the scene
    this.camera.target = BABYLON.Vector3.Zero();
    // Set camera frustum to support distant objects
    this.camera.minZ = 0.1;    // Near clipping plane
    this.camera.maxZ = 50000;  // Far clipping plane - allow raycasting to very distant meshes
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
    // Create force-directed layout - nodes start at center
    const edges = this.buildEdgeList(graph.edges);
    
    // Build file and exported maps
    const fileMap = new Map<string, string>();
    const exportedMap = new Map<string, boolean>();
    for (const node of graph.nodes) {
      if (node.file) {
        fileMap.set(node.id, node.file);
      }
      if ('isExported' in node) {
        exportedMap.set(node.id, (node as any).isExported);
      }
    }
    
    this.layout = new ForceDirectedLayout(
      graph.nodes.map(n => n.id),
      edges,
      fileMap,
      exportedMap
    );

    // Calculate indegree (incoming connections) for each node
    const indegreeMap = this.calculateIndegree(graph.edges);

    // Render nodes at their random initial positions around 100 units from center
    const initialNodes = this.layout.getNodes();
    this.renderNodes(graph.nodes, initialNodes, indegreeMap);
    this.renderEdges();  // Create edge cylinders
    this.meshFactory.updateEdges();  // Position edges at initial node positions

    // Enable physics updates to pull connected nodes together and push others apart
    this.physicsActive = true;
    this.physicsIterationCount = 0;
    this.setupPhysicsLoop();

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions and ${graph.edges.length} calls`);
  }

  /**
   * Incrementally update the scene - only create/remove changed objects
   * New nodes are added and physics pushes them apart
   */
  private updateCodeGraph(graph: GraphData): void {
    this.validateGraphData(graph);

    // Rebuild layout with all nodes for proper physics
    const edges = this.buildEdgeList(graph.edges);
    
    // Build file and exported maps
    const fileMap = new Map<string, string>();
    const exportedMap = new Map<string, boolean>();
    for (const node of graph.nodes) {
      if (node.file) {
        fileMap.set(node.id, node.file);
      }
      if ('isExported' in node) {
        exportedMap.set(node.id, (node as any).isExported);
      }
    }
    
    this.layout = new ForceDirectedLayout(
      graph.nodes.map(n => n.id),
      edges,
      fileMap,
      exportedMap
    );

    // Calculate indegree (incoming connections) for each node
    const indegreeMap = this.calculateIndegree(graph.edges);
    const layoutNodes = this.layout.getNodes();

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
      this.nodeMeshMap.delete(nodeId);
    }

    // Remove deleted edges
    const removedEdges = Array.from(this.currentEdges).filter(edge => !newEdgePairs.has(edge));
    for (const edgePair of removedEdges) {
      this.removeMeshesForEdge(edgePair);
      this.currentEdges.delete(edgePair);
    }

    // Create only new nodes - just place them, physics will spread them
    const newNodes = graph.nodes.filter(n => !this.currentNodeIds.has(n.id));
    this.renderNodesWithAnimation(newNodes, layoutNodes, indegreeMap, false);  // animated=false - physics will move them
    newNodes.forEach(n => this.currentNodeIds.add(n.id));

    // Create only new edges
    const newEdges = graph.edges.filter(
      e => !this.currentEdges.has(`${e.from}→${e.to}`)
    );
    this.renderEdges();  // Create new edge cylinders
    this.meshFactory.updateEdges();  // Position edges immediately
    newEdges.forEach(e => this.currentEdges.add(`${e.from}→${e.to}`));

    // Restart physics to spread updated graph
    this.physicsActive = true;
    this.physicsIterationCount = 0;

    console.log(
      `✓ Updated code graph: ${removedNodeIds.length} removed, ${newNodes.length} created, ` +
      `${removedEdges.length} edges removed, ${newEdges.length} edges created`
    );
  }

  /**
   * Render nodes with optional animation control
   */
  private renderNodesWithAnimation(
    nodes: GraphNode[],
    layoutNodes: Map<string, any>,
    indegreeMap: Map<string, number> = new Map(),
    animateFromCenter: boolean = false
  ): void {
    for (const node of nodes) {
      const layoutNode = layoutNodes.get(node.id);
      if (!layoutNode) continue;

      const targetPosition = new BABYLON.Vector3(
        layoutNode.position.x,
        layoutNode.position.y,
        layoutNode.position.z
      );

      // If animating from center (new nodes), add perpendicular jitter to target
      if (animateFromCenter) {
        const radiusDistance = BABYLON.Vector3.Distance(new BABYLON.Vector3(0, 0, 0), targetPosition);
        if (radiusDistance > 0.1) {
          // Calculate the radial direction (center to target)
          const radialDirection = targetPosition.normalize();
          
          // Generate a random perpendicular vector
          const perpendicular1 = this.getPerpendicularVector(radialDirection);
          const perpendicular2 = BABYLON.Vector3.Cross(radialDirection, perpendicular1).normalize();
          
          // Random blend of the two perpendicular directions
          const angle = Math.random() * Math.PI * 2;
          const randomPerpendicular = perpendicular1
            .scale(Math.cos(angle))
            .add(perpendicular2.scale(Math.sin(angle)));
          
          // Add small jitter (about 5-15% of radius distance, max 2 units)
          const jitterAmount = Math.min(2.0, radiusDistance * (0.05 + Math.random() * 0.1));
          const jitterVector = randomPerpendicular.scale(jitterAmount);
          
          targetPosition.addInPlace(jitterVector);
        }
      }

      // Get or generate color for this file
      const fileColor = node.file ? this.getFileColor(node.file) : null;
      const indegree = indegreeMap.get(node.id) || 0;

      // Start position: center for new nodes, or target for existing nodes
      const startPosition = animateFromCenter 
        ? new BABYLON.Vector3(0, 0, 0) 
        : targetPosition;

      this.meshFactory.createNodeMesh(node, startPosition, fileColor, indegree, (mesh, material, n) => {
        this.setupNodeInteraction(mesh, material, n);
        // Track mesh for physics updates
        this.nodeMeshMap.set(node.id, mesh);
        // Only animate if starting from center (new nodes)
        if (animateFromCenter) {
          this.animateNodeToPosition(mesh, targetPosition, 7000);  // 7 second animation for dramatic effect
        }
      });
    }
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
    
    // Remove mesh reference from factory
    this.meshFactory.removeMeshReference(nodeId);
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

  private buildEdgeList(edges: Array<{ from: string; to: string }>): Array<{ source: string; target: string }> {
    return edges.map(e => ({ source: e.from, target: e.to }));
  }

  /**
   * Animate a node mesh to a target position
   */
  private animateNodeToPosition(
    mesh: BABYLON.Mesh,
    targetPosition: BABYLON.Vector3,
    duration: number = 2500  // 2.5 second animation for dramatic effect
  ): void {
    const currentPosition = mesh.position.clone();
    
    // Create position animation
    const animationName = `nodeMove_${mesh.id}`;
    const animation = new BABYLON.Animation(
      animationName,
      'position',
      60,  // 60 fps
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    // Create keyframes for smooth easing
    const frameRate = 60;
    const totalFrames = Math.floor((duration / 1000) * frameRate);
    
    const keys = [
      { frame: 0, value: currentPosition },
      { frame: totalFrames, value: targetPosition }
    ];

    animation.setKeys(keys);
    
    // Use ease function for smooth animation
    const easingFunction = new BABYLON.CubicEase();
    easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
    animation.setEasingFunction(easingFunction);

    // Remove any existing animation on this mesh
    this.scene.stopAnimation(mesh);

    // Add and play the animation
    mesh.animations = [];
    mesh.animations.push(animation);
    this.scene.beginAnimation(mesh, 0, totalFrames, false);
  }

  private renderNodes(
    nodes: GraphNode[],
    layoutNodes: Map<string, any>,
    indegreeMap: Map<string, number> = new Map()
  ): void {
    // Just place nodes at current positions - physics will move them
    this.renderNodesWithAnimation(nodes, layoutNodes, indegreeMap, false);  // animated=false - no animation
  }

  /**
   * Create transparent sphere containers for each file
   */


  /**
   * Resolve overlapping spheres by reducing radii while maintaining minimum bounds
   */


  private setupNodeInteraction(
    mesh: BABYLON.Mesh,
    material: BABYLON.StandardMaterial,
    node: GraphNode
  ): void {
    const originalColor = material.emissiveColor.clone();
    
    // Store node reference on the mesh for later retrieval during clicks
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
  }

  private sceneRootFlyTo(targetPosition: BABYLON.Vector3): void {
    // Stop any existing animation on the scene root
    this.scene.stopAnimation(this.sceneRoot);

    const cameraPosition = SceneConfig.CAMERA_POSITION;
    
    // Landing position: directly on top of the object like a platform
    // Position camera high enough above the object to look down at it
    const platformHeight = SceneConfig.FUNCTION_BOX_SIZE / 2 + 8;  // Land on top with 8 unit offset for platform view
    const landingPosition = targetPosition.add(new BABYLON.Vector3(0, platformHeight, 0));
    
    // Scene root position: camera at (0,0,-70) + offset pointing down from above
    // We want camera looking down at the landing position
    const downwardViewOffset = new BABYLON.Vector3(0, 0, 0);  // No additional offset, look straight down
    const targetSceneRootPosition = cameraPosition
      .add(downwardViewOffset)
      .subtract(landingPosition);

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
    
    const animationDurationMs = SceneConfig.FLY_TO_ANIMATION_TIME_MS;
    let animationStarted = false;
    
    this.scene.beginDirectAnimation(
      this.sceneRoot,
      [positionAnimation],
      0,
      totalFrames,
      false,
      1,
      () => {
        // Animation completed - allow next click
        this.isAnimating = false;
      }
    );
    animationStarted = true;

    // Set flag only after animation successfully started
    if (animationStarted) {
      this.isAnimating = true;
    }
    
    // Safety timeout to reset animation flag (2 second absolute maximum)
    setTimeout(() => {
      this.isAnimating = false;
    }, Math.max(animationDurationMs + 100, 2000));
  }

  /**
   * Slide view to show a specific face of the cube
   */
  private slideFaceView(cubePosition: BABYLON.Vector3, faceNormal: BABYLON.Vector3): void {
    // Stop any existing animation
    this.scene.stopAnimation(this.sceneRoot);

    // Track the current face being viewed
    this.currentFaceNormal = faceNormal.clone();

    const cameraPosition = SceneConfig.CAMERA_POSITION;
    
    // Normalize the face normal and scale it to position camera at that face
    // Distance: half cube size + offset from camera to node
    const cubeHalfSize = SceneConfig.FUNCTION_BOX_SIZE / 2;
    const viewDistance = cubeHalfSize + 6.5;  // Same offset as FLY_TO_OFFSET
    
    // Calculate position offset from cube center based on clicked face normal
    const normalizedFace = faceNormal.normalize();
    const faceOffset = normalizedFace.scale(viewDistance);
    
    // Target sceneRoot position: camera - (cube center + face offset)
    const targetSceneRootPosition = cameraPosition.subtract(cubePosition.add(faceOffset));

    // Quick animation to slide to this view (300ms instead of 600ms)
    const slideAnimation = new BABYLON.Animation(
      'slidePosition',
      'position',
      SceneConfig.FLY_TO_ANIMATION_FPS,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3
    );
    
    const startPos = this.sceneRoot.position.clone();
    const totalFrames = (300 / 1000) * SceneConfig.FLY_TO_ANIMATION_FPS;  // 300ms animation
    
    // Smooth easing for slide
    const keys = [];
    for (let i = 0; i <= totalFrames; i++) {
      const t = i / totalFrames;
      // Ease-out cubic for smooth deceleration
      const easeT = 1 - Math.pow(1 - t, 3);
      
      const x = startPos.x + (targetSceneRootPosition.x - startPos.x) * easeT;
      const y = startPos.y + (targetSceneRootPosition.y - startPos.y) * easeT;
      const z = startPos.z + (targetSceneRootPosition.z - startPos.z) * easeT;
      
      keys.push({
        frame: i,
        value: new BABYLON.Vector3(x, y, z),
      });
    }
    slideAnimation.setKeys(keys);
    
    let animationStarted = false;
    this.scene.beginDirectAnimation(
      this.sceneRoot,
      [slideAnimation],
      0,
      totalFrames,
      false,
      1,
      () => {
        // Animation completed - allow next click
        this.isAnimating = false;
      }
    );
    animationStarted = true;

    // Set flag only after animation successfully started
    if (animationStarted) {
      this.isAnimating = true;
    }
    
    // Safety timeout to reset animation flag (ensure it's longer than animation duration)
    setTimeout(() => {
      this.isAnimating = false;
    }, Math.max(SceneConfig.FLY_TO_ANIMATION_TIME_MS + 200, 3000));
  }

  private calculateIndegree(edges: Array<{ from: string; to: string }>): Map<string, number> {
    const indegreeMap = new Map<string, number>();
    for (const edge of edges) {
      indegreeMap.set(edge.to, (indegreeMap.get(edge.to) || 0) + 1);
    }
    return indegreeMap;
  }

  private renderEdges(): void {
    if (!this.layout) return;
    
    // Get the current graph edges in correct format for MeshFactory
    const graphEdges = Array.from(this.currentEdges).map(edgeId => {
      const [from, to] = edgeId.split('→');
      return { from, to };
    });
    
    const layoutNodes = this.layout.getNodes();
    this.meshFactory.createEdges(graphEdges, layoutNodes, this.sceneRoot);
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
      this.xrExperience = await this.scene.createDefaultXRExperienceAsync();
      console.log('WebXR experience created successfully');

      // Setup VR controller input
      const xrInput = this.xrExperience.input;
      xrInput.onControllerAddedObservable.add((controller) => {
        // Track motion controller for raycasting
        controller.onMotionControllerInitObservable.add((motionController) => {
          // Look for trigger button (usually squeeze/grip button in VR)
          const triggerComponent = motionController.getComponent('xr-standard-trigger');
          const squeezeComponent = motionController.getComponent('xr-standard-squeeze');
          
          const activationComponent = triggerComponent || squeezeComponent;
          
          if (activationComponent) {
            activationComponent.onButtonStateChangedObservable.add(() => {
              // Trigger pressed - perform raycast from controller to select object
              if (activationComponent.pressed && !this.isAnimating) {
                this.handleVRControllerClick(controller);
              }
            });
          }
        });
      });

      // Fallback: Also support pointer down for desktop VR
      xrInput.onControllerRemovedObservable.add((_controller) => {
        console.log('VR Controller disconnected');
      });
    } catch (error) {
      console.warn('WebXR not available or failed to initialize:', error);
    }
  }

  private handleVRControllerClick(controller: BABYLON.WebXRInputSource): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    // Raycast from controller forward
    const controllerAim = controller.pointer;
    
    // Create ray from controller position in forward direction
    const origin = controllerAim.position.clone();
    const direction = BABYLON.Vector3.Normalize(controllerAim.getDirection(BABYLON.Axis.Z));
    
    const length = 1000;
    const ray = new BABYLON.Ray(origin, direction, length);
    
    // Cast ray and check for hits
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      // Only pick clickable meshes with nodeData
      return mesh.isPickable && !!(mesh as any).nodeData;
    });
    
    if (hit && hit.hit && hit.pickedMesh) {
      const clickedNode = (hit.pickedMesh as any).nodeData as GraphNode;
      if (clickedNode) {
        // Use hit point to determine which face was clicked
        const hitPoint = hit.pickedPoint || origin;
        const cubePosition = hit.pickedMesh.position;
        
        // Get face normal from hit
        let faceNormal = hit.getNormal(true) || new BABYLON.Vector3(0, 0, 1);
        
        // Check if click is near an edge
        const adjacentFaceNormal = this.getAdjacentFaceIfNearEdge(hitPoint, cubePosition, faceNormal);
        if (adjacentFaceNormal) {
          faceNormal = adjacentFaceNormal;
        }
        
        const isSameFunction = clickedNode.id === this.currentFunctionId;
        const isSameFace = isSameFunction && this.isFaceNormalEqual(faceNormal, this.currentFaceNormal);
        
        try {
          if (isSameFace) {
            // Same face clicked again - slide to show that face
            this.slideFaceView(hit.pickedMesh.position, faceNormal);
          } else if (isSameFunction) {
            // Different face of same function - slide to new face
            this.currentFaceNormal = faceNormal.clone();
            this.slideFaceView(hit.pickedMesh.position, faceNormal);
          } else {
            // Different function - jump to it
            this.currentFunctionId = clickedNode.id;
            this.currentFaceNormal = faceNormal.clone();
            this.sceneRootFlyTo(hit.pickedMesh.position);
          }
        } catch (error) {
          console.error('Error during VR animation setup:', error);
          this.isAnimating = false;
        }
      }
    }
  }

  /**
   * Generate a perpendicular vector to the given direction
   * Used to create random jitter perpendicular to the radial direction
   */
  private getPerpendicularVector(direction: BABYLON.Vector3): BABYLON.Vector3 {
    const upVector = new BABYLON.Vector3(0, 1, 0);
    const normalizedDir = direction.normalize();
    
    // If direction is parallel to up vector, use a different reference
    const dotProduct = BABYLON.Vector3.Dot(normalizedDir, upVector);
    const refVector = Math.abs(dotProduct) > 0.9 
      ? new BABYLON.Vector3(1, 0, 0)  // Use X axis if nearly parallel to Y
      : upVector;
    
    // Cross product gives a perpendicular vector
    const perpendicular = BABYLON.Vector3.Cross(normalizedDir, refVector);
    return perpendicular.normalize();
  }

  public run(): void {
    this.engine.runRenderLoop(() => {
      // Update edge cylinders each frame
      this.meshFactory.updateEdges();
      this.scene.render();
    });
  }

  public dispose(): void {
    this.scene.dispose();
    this.engine.dispose();
  }
}
