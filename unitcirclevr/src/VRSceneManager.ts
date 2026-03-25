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

  // Real-time physics - Two-level hierarchical layout system
  // Level 1: File-level layout (files as nodes, cross-file references as edges)
  private fileLayout: ForceDirectedLayout | null = null;
  
  // Level 2: File-internal layouts (functions within same file)
  private fileInternalLayouts: Map<string, ForceDirectedLayout> = new Map();

  
  // Tracking for the hierarchical system
  private nodeMeshMap: Map<string, BABYLON.Mesh> = new Map();  // Map node IDs to their meshes
  private nodeToFile: Map<string, string> = new Map();  // Map node IDs to file names
  private fileNodeIds: Map<string, Set<string>> = new Map();  // Map file names to their node IDs
  private graphNodeMap: Map<string, GraphNode> = new Map();  // Map node IDs to GraphNode data
  private fileBoxMeshes: Map<string, BABYLON.Mesh> = new Map();  // Map file names to their wireframe box meshes
  private currentGraphData: GraphData | null = null;  // Store full graph data for edge material selection
  
  private physicsActive = false;
  private physicsIterationCount = 0;
  private physicsLoopInitialized = false;

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
   * Set up per-frame physics updates for two-level hierarchical layout
   * Level 1: File-level layout positions file boxes
   * Level 2: File-internal layouts position nodes within their boxes
   */
  private setupPhysicsLoop(): void {
    if (this.physicsLoopInitialized) {
      return;
    }
    this.physicsLoopInitialized = true;

    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.physicsActive && this.fileLayout && this.fileInternalLayouts.size > 0) {
          // Step 1: Update file-level layout (positions the file boxes)
          this.fileLayout.updateFrame();
          const filePositions = this.fileLayout.getNodes();
          
          // DO NOT update internal layouts during physics loop
          // They are pre-converged in loadGraph and should remain stable
          // Moving the file box automatically moves all child nodes
          
          // Step 3: Update node positions within their file boxes (local positioning)
          // Nodes are parented to file boxes, so local position = position within the box
          // Positions are already set during renderNodes and shouldn't change
          // Note: Nodes don't need updating here - they stay parented to their file boxes

          // Step 3.5: Update file box positions and sizes based on file-level layout
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) {
              // Skip if file node not found (shouldn't happen)
              continue;
            }
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
            
            // File box sizes are now pre-calculated from node bounds and don't change
            // during physics simulation - they were set in renderFileBoxes()
          }
          
          // Step 3b: Apply repulsive forces to prevent file box intersections
          this.applyFileBoxRepulsion(this.fileLayout);

          // Step 3c: Enforce deterministic non-overlap each frame so boxes
          // cannot remain interpenetrating under ongoing layout forces.
          this.resolveInitialFileBoxOverlaps(4);

          // Step 3d: Enforce a minimum surface gap between file boxes.
          this.enforceMinimumFileBoxGap(10.0, 4);

          // Re-apply file box transforms after collision resolution so visual meshes
          // immediately match corrected file-level positions in the same frame.
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) {
              continue;
            }
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
          }
          
          // Step 4: Update edge cylinders to follow moving nodes
          this.meshFactory.updateEdges();
          
          // Step 5: Check convergence
          this.physicsIterationCount++;
          const maxIterations = 500;  // Reasonable limit for convergence
          if (this.physicsIterationCount > maxIterations) {
            this.physicsActive = false;
            console.log(`✓ Physics converged after ${this.physicsIterationCount} iterations`);
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
    this.prepareRenderState(graph);

    const fileMap = this.buildFileNodeMaps(graph);
    this.createAndSettleInternalLayouts(graph, fileMap);

    const indegreeMap = this.calculateIndegree(graph.edges);
    this.renderFileBoxes();

    const files = this.createAndSettleFileLevelLayout(graph, fileMap);
    this.applyFileLayoutPositions();

    this.renderNodes(graph.nodes, indegreeMap);
    this.fitAndSeparateFileBoxes();

    this.populateCurrentEdges(graph);
    this.resolveEdgeObstructions(30);
    this.placeExportedFunctionsOnOptimalFace();
    this.pullInternalNodesToExportedFace();
    this.resolveNodeEdgeObstructions(20);
    this.resolveExportedFaceEdgeObstructions(15);

    this.frameCameraToExportedFunctions();
    this.renderEdges();
    this.meshFactory.updateEdges();

    this.physicsActive = false;
    this.physicsIterationCount = 0;
    this.setupPhysicsLoop();

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions in ${files.length} files and ${graph.edges.length} calls`);
  }

  private prepareRenderState(graph: GraphData): void {
    // Always start new graph renders from the world origin so objects are not
    // biased by any prior camera-follow animation offsets.
    this.sceneRoot.position = BABYLON.Vector3.Zero();
    this.currentFunctionId = null;
    this.currentFaceNormal = null;
    this.isAnimating = false;

    this.currentGraphData = graph;
    this.graphNodeMap.clear();
    for (const node of graph.nodes) {
      this.graphNodeMap.set(node.id, node);
    }
  }

  private buildFileNodeMaps(graph: GraphData): Map<string, string> {
    const fileMap = new Map<string, string>();
    for (const node of graph.nodes) {
      if (!node.file) {
        continue;
      }

      fileMap.set(node.id, node.file);
      this.nodeToFile.set(node.id, node.file);

      if (!this.fileNodeIds.has(node.file)) {
        this.fileNodeIds.set(node.file, new Set());
      }
      this.fileNodeIds.get(node.file)!.add(node.id);
    }
    return fileMap;
  }

  private createAndSettleInternalLayouts(graph: GraphData, fileMap: Map<string, string>): void {
    const allEdges = this.buildEdgeList(graph.edges);
    for (const [file, nodeIds] of this.fileNodeIds.entries()) {
      const nodeArray = Array.from(nodeIds);
      const sameFileEdges = allEdges.filter(e =>
        nodeIds.has(e.source) && nodeIds.has(e.target)
      );

      const internalLayout = new ForceDirectedLayout(
        nodeArray,
        sameFileEdges,
        fileMap
      );
      this.fileInternalLayouts.set(file, internalLayout);
    }

    for (const internalLayout of this.fileInternalLayouts.values()) {
      internalLayout.simulate(500);
    }

    this.recenterInternalLayouts();
  }

  private createAndSettleFileLevelLayout(graph: GraphData, fileMap: Map<string, string>): string[] {
    const files = Array.from(this.fileNodeIds.keys());
    const crossFileEdges = this.buildCrossFileEdges(graph.edges, fileMap);

    console.log(`📍 File-level layout: ${files.length} files, ${crossFileEdges.length} cross-file edges`);
    console.log(`   Files: ${files.join(', ')}`);
    console.log(`   Cross-file edges: ${crossFileEdges.map(e => `${e.source}->${e.target}`).join(', ')}`);

    this.fileLayout = new ForceDirectedLayout(files, crossFileEdges);
    this.fileLayout.simulate(600);
    return files;
  }

  private applyFileLayoutPositions(): void {
    if (!this.fileLayout) {
      return;
    }

    const initialFilePositions = this.fileLayout.getNodes();
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = initialFilePositions.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  private fitAndSeparateFileBoxes(): void {
    this.autosizeFileBoxes();
    this.ensureExportedFunctionsParentedToFileBoxes();
    this.clampNodesInsideFileBoxes();

    this.positionFileBoxesInGrid();

    // Always resolve collisions immediately after any resize/reposition.
    this.resolveInitialFileBoxOverlaps(6);
    this.enforceMinimumFileBoxGap(10.0, 6);
  }

  private populateCurrentEdges(graph: GraphData): void {
    this.currentEdges.clear();
    for (const edge of graph.edges) {
      this.currentEdges.add(`${edge.from}→${edge.to}`);
    }
  }

  /**
   * Incrementally update the scene - only create/remove changed objects
   * New nodes are added and physics pushes them apart
   */
  private updateCodeGraph(graph: GraphData): void {
    // For now, just re-render the entire graph when it updates
    // TODO: Implement incremental updates for better performance
    this.clearScene();
    this.renderCodeGraph(graph);
  }

  private clearScene(): void {
    // Dispose all node meshes
    for (const mesh of this.nodeMeshMap.values()) {
      mesh.dispose();
    }
    this.nodeMeshMap.clear();
    
    // Dispose all edges
    const edgeMeshes = this.scene.meshes.filter(m => m.name.startsWith('edge_'));
    for (const mesh of edgeMeshes) {
      mesh.dispose();
    }

    // Dispose all file box outlines
    for (const mesh of this.fileBoxMeshes.values()) {
      mesh.dispose();
    }
    this.fileBoxMeshes.clear();
    
    // Clear tracking maps
    this.fileInternalLayouts.clear();
    this.fileNodeIds.clear();
    this.nodeToFile.clear();
    this.fileLayout = null;
  }

  private buildEdgeList(edges: Array<{ from: string; to: string }>): Array<{ source: string; target: string }> {
    return edges.map(e => ({ source: e.from, target: e.to }));
  }

  /**
   * Build edges between file nodes for file-level layout
   * Creates edges between files when there are references crossing file boundaries
   */
  private buildCrossFileEdges(
    edges: Array<{ from: string; to: string }>,
    fileMap: Map<string, string>
  ): Array<{ source: string; target: string }> {
    const fileEdges = new Set<string>();
    
    for (const edge of edges) {
      const sourceFile = fileMap.get(edge.from);
      const targetFile = fileMap.get(edge.to);
      
      // Only create file edge if it's between different files
      if (sourceFile && targetFile && sourceFile !== targetFile) {
        // Create a unique key to avoid duplicate file edges
        const edgeKey = `${sourceFile}->${targetFile}`;
        fileEdges.add(edgeKey);
      }
    }
    
    // Convert edge keys to edge objects
    return Array.from(fileEdges).map(key => {
      const [source, target] = key.split('->');
      return { source, target };
    });
  }

  private renderNodes(
    nodes: GraphNode[],
    indegreeMap: Map<string, number> = new Map()
  ): void {
    const isFunctionNode = (node: GraphNode): boolean => node.type !== 'variable' && node.type !== 'external';

    let functionRenderCount = 0;

    for (const node of nodes) {
      if (!isFunctionNode(node)) {
        continue;
      }

      const file = node.file || 'external';
      const fileLayout = this.fileInternalLayouts.get(file);

      let position = BABYLON.Vector3.Zero();
      if (fileLayout) {
        const layoutNode = fileLayout.getNodes().get(node.id);
        if (layoutNode) {
          position = new BABYLON.Vector3(
            layoutNode.position.x,
            layoutNode.position.y,
            layoutNode.position.z
          );
        }
      }

      // Get or generate color for this file
      const fileColor = file ? this.getFileColor(file) : null;
      const indegree = indegreeMap.get(node.id) || 0;

      this.meshFactory.createNodeMesh(node, position, fileColor, indegree, (mesh, material, n) => {
        this.setupNodeInteraction(mesh, material, n);

        // Ensure exported functions are visibly rendered from first frame.
        if (n.type === 'function' && n.isExported) {
          mesh.isVisible = true;
          mesh.setEnabled(true);
          material.alpha = 1.0;
          material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
          material.disableLighting = true;
          material.emissiveColor = new BABYLON.Color3(0.95, 0.95, 1.0);
        }

        // Track mesh for physics updates
        this.nodeMeshMap.set(node.id, mesh);
        
        // Parent function nodes to their file box and keep local placement.
        const fileBox = this.fileBoxMeshes.get(file);
        if (fileBox) {
          mesh.parent = fileBox;
          mesh.position = position.clone();
          this.applyChildScaleCompensation(mesh, fileBox);
        } else {
          mesh.parent = this.sceneRoot;
          mesh.position = position.clone();
        }

        functionRenderCount++;
      });
    }

    console.log(`📦 Rendered function boxes: ${functionRenderCount}`);
  }

  /**
   * Keep child mesh world scale stable when parent file boxes are resized.
   */
  private applyChildScaleCompensation(child: BABYLON.Mesh, fileBox: BABYLON.Mesh): void {
    const safeX = Math.max(0.0001, fileBox.scaling.x);
    const safeY = Math.max(0.0001, fileBox.scaling.y);
    const safeZ = Math.max(0.0001, fileBox.scaling.z);
    child.scaling = new BABYLON.Vector3(1 / safeX, 1 / safeY, 1 / safeZ);
  }

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

  /**
   * Calculate bounding box dimensions for a group of nodes in world coordinates
   */
  /**
   * Apply repulsive forces between file boxes to prevent intersections
   */
  private applyFileBoxRepulsion(layout: ForceDirectedLayout | null): void {
    if (!layout) return;

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = layout.getNodes();
    const minSeparationPadding = 10.0;

    // Check all pairs of files for intersection
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const file1 = files[i];
        const file2 = files[j];

        const node1 = fileNodes.get(file1);
        const node2 = fileNodes.get(file2);
        if (!node1 || !node2) continue;

        const box1 = this.fileBoxMeshes.get(file1);
        const box2 = this.fileBoxMeshes.get(file2);
        if (!box1 || !box2) continue;

        // Use per-axis half extents so resized (non-uniform) file boxes are separated accurately.
        const half1 = {
          x: box1.scaling.x / 2,
          y: box1.scaling.y / 2,
          z: box1.scaling.z / 2
        };
        const half2 = {
          x: box2.scaling.x / 2,
          y: box2.scaling.y / 2,
          z: box2.scaling.z / 2
        };

        const dx = node2.position.x - node1.position.x;
        const dy = node2.position.y - node1.position.y;
        const dz = node2.position.z - node1.position.z;

        const reqX = half1.x + half2.x + minSeparationPadding;
        const reqY = half1.y + half2.y + minSeparationPadding;
        const reqZ = half1.z + half2.z + minSeparationPadding;

        const overlapX = reqX - Math.abs(dx);
        const overlapY = reqY - Math.abs(dy);
        const overlapZ = reqZ - Math.abs(dz);

        // Collision only if overlaps exist on all three axes.
        if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
          // Push along the axis with smallest penetration to resolve quickly and stably.
          let axis: 'x' | 'y' | 'z' = 'x';
          let penetration = overlapX;
          if (overlapY < penetration) {
            axis = 'y';
            penetration = overlapY;
          }
          if (overlapZ < penetration) {
            axis = 'z';
            penetration = overlapZ;
          }

          const sign = axis === 'x'
            ? (dx >= 0 ? 1 : -1)
            : axis === 'y'
              ? (dy >= 0 ? 1 : -1)
              : (dz >= 0 ? 1 : -1);

          const correction = (penetration / 2) + 0.5;
          const repulsionStrength = Math.max(500, penetration * 40);

          if (axis === 'x') {
            node1.position.x -= sign * correction;
            node2.position.x += sign * correction;
            node1.velocity.x -= sign * repulsionStrength;
            node2.velocity.x += sign * repulsionStrength;
          } else if (axis === 'y') {
            node1.position.y -= sign * correction;
            node2.position.y += sign * correction;
            node1.velocity.y -= sign * repulsionStrength;
            node2.velocity.y += sign * repulsionStrength;
          } else {
            node1.position.z -= sign * correction;
            node2.position.z += sign * correction;
            node1.velocity.z -= sign * repulsionStrength;
            node2.velocity.z += sign * repulsionStrength;
          }

          if (this.physicsIterationCount < 3) {
            console.log(`  🔄 Collision: ${file1} <-> ${file2} axis=${axis} penetration=${penetration.toFixed(1)}`);
          }
        }
      }
    }
  }

  /**
   * Perform deterministic overlap separation for file boxes.
   * Used both before physics starts and during physics updates.
   */
  private resolveInitialFileBoxOverlaps(maxPasses: number = 10): void {
    if (!this.fileLayout) {
      return;
    }

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = this.fileLayout.getNodes();
    const padding = 10.0;

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const file1 = files[i];
          const file2 = files[j];

          const node1 = fileNodes.get(file1);
          const node2 = fileNodes.get(file2);
          const box1 = this.fileBoxMeshes.get(file1);
          const box2 = this.fileBoxMeshes.get(file2);
          if (!node1 || !node2 || !box1 || !box2) {
            continue;
          }

          const half1 = {
            x: box1.scaling.x / 2,
            y: box1.scaling.y / 2,
            z: box1.scaling.z / 2
          };
          const half2 = {
            x: box2.scaling.x / 2,
            y: box2.scaling.y / 2,
            z: box2.scaling.z / 2
          };

          const dx = node2.position.x - node1.position.x;
          const dy = node2.position.y - node1.position.y;
          const dz = node2.position.z - node1.position.z;

          const overlapX = (half1.x + half2.x + padding) - Math.abs(dx);
          const overlapY = (half1.y + half2.y + padding) - Math.abs(dy);
          const overlapZ = (half1.z + half2.z + padding) - Math.abs(dz);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            let axis: 'x' | 'y' | 'z' = 'x';
            let penetration = overlapX;
            if (overlapY < penetration) {
              axis = 'y';
              penetration = overlapY;
            }
            if (overlapZ < penetration) {
              axis = 'z';
              penetration = overlapZ;
            }

            const sign = axis === 'x'
              ? (dx >= 0 ? 1 : -1)
              : axis === 'y'
                ? (dy >= 0 ? 1 : -1)
                : (dz >= 0 ? 1 : -1);

            const correction = (penetration / 2) + 0.5;
            if (axis === 'x') {
              node1.position.x -= sign * correction;
              node2.position.x += sign * correction;
            } else if (axis === 'y') {
              node1.position.y -= sign * correction;
              node2.position.y += sign * correction;
            } else {
              node1.position.z -= sign * correction;
              node2.position.z += sign * correction;
            }
            movedAny = true;
          }
        }
      }

      if (!movedAny) {
        break;
      }
    }

    // Sync corrected positions back to file box meshes.
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = fileNodes.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  /**
   * Enforce a strict minimum surface gap between all file boxes.
   * Gap is measured using bounding spheres around each (possibly non-uniform) box.
   */
  private enforceMinimumFileBoxGap(minGap: number, maxPasses: number = 6): void {
    if (!this.fileLayout) {
      return;
    }

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = this.fileLayout.getNodes();

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const file1 = files[i];
          const file2 = files[j];
          const node1 = fileNodes.get(file1);
          const node2 = fileNodes.get(file2);
          const box1 = this.fileBoxMeshes.get(file1);
          const box2 = this.fileBoxMeshes.get(file2);
          if (!node1 || !node2 || !box1 || !box2) {
            continue;
          }

          const radius1 = Math.sqrt(
            (box1.scaling.x * 0.5) ** 2 +
            (box1.scaling.y * 0.5) ** 2 +
            (box1.scaling.z * 0.5) ** 2
          );
          const radius2 = Math.sqrt(
            (box2.scaling.x * 0.5) ** 2 +
            (box2.scaling.y * 0.5) ** 2 +
            (box2.scaling.z * 0.5) ** 2
          );

          const dx = node2.position.x - node1.position.x;
          const dy = node2.position.y - node1.position.y;
          const dz = node2.position.z - node1.position.z;
          let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          let dirX = 0;
          let dirY = 0;
          let dirZ = 0;
          if (distance < 0.0001) {
            // Deterministic fallback for coincident centers.
            const fallbackX = ((i + 1) % 3) - 1;
            const fallbackY = ((j + 2) % 3) - 1;
            const fallbackZ = 1;
            const fallbackLen = Math.sqrt(fallbackX * fallbackX + fallbackY * fallbackY + fallbackZ * fallbackZ);
            dirX = fallbackX / fallbackLen;
            dirY = fallbackY / fallbackLen;
            dirZ = fallbackZ / fallbackLen;
            distance = 0.0001;
          } else {
            dirX = dx / distance;
            dirY = dy / distance;
            dirZ = dz / distance;
          }

          const requiredCenterDistance = radius1 + radius2 + minGap;
          if (distance < requiredCenterDistance) {
            const deficit = requiredCenterDistance - distance;
            const correction = (deficit / 2) + 0.1;

            node1.position.x -= dirX * correction;
            node1.position.y -= dirY * correction;
            node1.position.z -= dirZ * correction;

            node2.position.x += dirX * correction;
            node2.position.y += dirY * correction;
            node2.position.z += dirZ * correction;

            movedAny = true;
          }
        }
      }

      if (!movedAny) {
        break;
      }
    }

    // Sync corrected positions back onto meshes.
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = fileNodes.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  /**
   * Recenter each file's internal layout so local node coordinates are centered
   * around (0,0,0), which keeps file boxes naturally containing their children.
   */
  private recenterInternalLayouts(): void {
    // Target local half-extent: children should fit within ±TARGET of the unit box (±0.5 local).
    // This prevents world positions from exploding when parent scaling is applied.
    const TARGET_LOCAL_HALF_EXTENT = 0.40;

    for (const internalLayout of this.fileInternalLayouts.values()) {
      const nodes = Array.from(internalLayout.getNodes().values());
      if (nodes.length === 0) {
        continue;
      }

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        maxX = Math.max(maxX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxY = Math.max(maxY, node.position.y);
        minZ = Math.min(minZ, node.position.z);
        maxZ = Math.max(maxZ, node.position.z);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;

      for (const node of nodes) {
        node.position.x -= centerX;
        node.position.y -= centerY;
        node.position.z -= centerZ;
      }

      // Normalize positions so the max extent equals TARGET_LOCAL_HALF_EXTENT.
      // ForceDirectedLayout seeds positions at 5-20% of SPACE_SIZE (up to ±30 for internal
      // layouts), so without normalization child world positions = scaling * 30 = 600+, which
      // makes the scene span thousands of world units and renders nodes as sub-pixel dots.
      let maxExtent = 0;
      for (const node of nodes) {
        maxExtent = Math.max(
          maxExtent,
          Math.abs(node.position.x),
          Math.abs(node.position.y),
          Math.abs(node.position.z)
        );
      }
      if (maxExtent > 0.001) {
        const normScale = TARGET_LOCAL_HALF_EXTENT / maxExtent;
        for (const node of nodes) {
          node.position.x *= normScale;
          node.position.y *= normScale;
          node.position.z *= normScale;
        }
      }
    }
  }

  /**
   * Clamp child node meshes so they remain fully contained in their file box.
   */
  public clampNodesInsideFileBoxes(): void {
    for (const fileBox of this.fileBoxMeshes.values()) {
      if (fileBox.scaling.x <= 0 || fileBox.scaling.y <= 0 || fileBox.scaling.z <= 0) {
        continue;
      }

      fileBox.computeWorldMatrix(true);
      const localHalfExtent = 0.5;

      for (const child of fileBox.getChildren()) {
        const mesh = child as BABYLON.Mesh;
        if (!mesh.getBoundingInfo) {
          continue;
        }

        // Exported function nodes are intentionally placed on/outside faces.
        // Do not clamp them back inside the file box volume.
        const nodeData = (mesh as any).nodeData as GraphNode | undefined;
        if (nodeData?.isExported) {
          continue;
        }

        mesh.computeWorldMatrix(true);
        const radiusWorld = mesh.getBoundingInfo().boundingSphere.radiusWorld;
        const parentMaxScale = Math.max(fileBox.scaling.x, fileBox.scaling.y, fileBox.scaling.z);
        const radiusLocal = (radiusWorld / Math.max(parentMaxScale, 0.0001)) + 0.01;
        const maxOffset = Math.max(0, localHalfExtent - radiusLocal);

        mesh.position.x = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.x));
        mesh.position.y = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.y));
        mesh.position.z = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.z));
      }
    }
  }

  /**
   * Create wireframe boxes to outline each file's containing region
   * Sizes are calculated from actual laid-out node positions
   */
  private renderFileBoxes(): void {
    for (const file of this.fileNodeIds.keys()) {
      // Skip external modules
      if (file === 'external') continue;
      
      // Seed size before per-axis autosizing runs.
      const boxSize = 20.0;
      
      // Create a wireframe box for this file
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `filebox_${file}`,
        { size: 1 },
        this.scene
      );

      // Unit box uses scaling for dimensions; autosize updates this per-axis.
      boxMesh.scaling = new BABYLON.Vector3(boxSize, boxSize, boxSize);
      
      // Get file color and create transparent glass material
      const fileColor = this.getFileColor(file);
      const material = new BABYLON.StandardMaterial(`fileboxmat_${file}`, this.scene);
      // Tint the glass with the file's unique colour at low intensity
      material.diffuseColor = new BABYLON.Color3(
        fileColor.r * 0.3,
        fileColor.g * 0.3,
        fileColor.b * 0.3
      );
      // Subtle self-illumination so the tint is visible even without direct lighting
      material.emissiveColor = new BABYLON.Color3(
        fileColor.r * 0.08,
        fileColor.g * 0.08,
        fileColor.b * 0.08
      );
      // Strong specular highlight for a glassy look
      material.specularColor = new BABYLON.Color3(1, 1, 1);
      material.specularPower = 128;
      // Render both inner and outer faces for a solid-glass appearance
      material.backFaceCulling = false;
      // Transparency: mostly see-through, slight body
      material.alpha = 0.18;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      // Use refraction-style index of refraction for glass feel
      material.indexOfRefraction = 1.5;
      material.wireframe = false;
      
      boxMesh.material = material;
      boxMesh.parent = this.sceneRoot;
      
      // Initially position at origin, will be updated by physics loop
      boxMesh.position = BABYLON.Vector3.Zero();
      
      // Store reference for updates
      this.fileBoxMeshes.set(file, boxMesh);

      // Add a readable file-name plaque on each file box.
      this.createFileBoxLabel(file, boxMesh);
    }
  }

  /**
   * Create a label plaque for a file box.
   */
  private createFileBoxLabel(file: string, fileBox: BABYLON.Mesh): void {
    const labelTexture = new BABYLON.DynamicTexture(
      `fileLabelTexture_${file}`,
      { width: 1024, height: 256 },
      this.scene,
      false
    );
    const ctx = labelTexture.getContext() as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 1016, 248);

    const displayName = file.split(/[\\/]/).pop() || file;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 88px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayName, 512, 128);
    labelTexture.update();

    const label = BABYLON.MeshBuilder.CreatePlane(
      `filelabel_${file}`,
      { width: 8, height: 2 },
      this.scene
    );

    const labelMaterial = new BABYLON.StandardMaterial(`filelabelmat_${file}`, this.scene);
    labelMaterial.diffuseTexture = labelTexture;
    labelMaterial.emissiveColor = new BABYLON.Color3(0.85, 0.85, 0.85);
    labelMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    labelMaterial.backFaceCulling = false;
    labelMaterial.useAlphaFromDiffuseTexture = true;
    label.material = labelMaterial;

    label.parent = fileBox;
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

    this.updateFileBoxLabelTransform(label, fileBox);
  }

  /**
   * Keep file label offset and world size stable as file box scales.
   */
  private updateFileBoxLabelTransform(label: BABYLON.Mesh, fileBox: BABYLON.Mesh): void {
    const safeX = Math.max(0.0001, fileBox.scaling.x);
    const safeY = Math.max(0.0001, fileBox.scaling.y);
    const safeZ = Math.max(0.0001, fileBox.scaling.z);

    const worldOffsetAboveTop = 1.0;
    label.position = new BABYLON.Vector3(0, 0.5 + (worldOffsetAboveTop / safeY), 0);
    label.scaling = new BABYLON.Vector3(1 / safeX, 1 / safeY, 1 / safeZ);
  }

  /**
   * Calculate file box size from actual node positions
   */
  public calculateFileBoxSize(_file: string, internalLayout: ForceDirectedLayout | undefined): number {
    if (!internalLayout) {
      return 120.0;  // Default size if no layout
    }

    const nodes = internalLayout.getNodes();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    // Find bounds of all nodes in this file
    for (const node of nodes.values()) {
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y);
      minZ = Math.min(minZ, node.position.z);
      maxZ = Math.max(maxZ, node.position.z);
    }

    // Calculate dimensions
    const width = maxX === -Infinity ? 0 : maxX - minX;
    const height = maxY === -Infinity ? 0 : maxY - minY;
    const depth = maxZ === -Infinity ? 0 : maxZ - minZ;

    // Find max dimension and add padding
    const maxDim = Math.max(width, height, depth);
    const padding = 30.0;  // Extra space around nodes
    const boxSize = Math.max(120.0, maxDim + padding);  // Minimum 120 units

    return boxSize;
  }

  /**
   * Auto-size file boxes to fit their child nodes based on actual mesh bounds
   */
  public autosizeFileBoxes(): void {
    // Node world size as created by MeshFactory (Math.max(3.0, FUNCTION_BOX_SIZE)).
    const nodeWorldSize = Math.max(3.0, SceneConfig.FUNCTION_BOX_SIZE);

    for (const fileBox of this.fileBoxMeshes.values()) {
      const children = fileBox.getChildren().filter(
        c => !c.name?.startsWith('filelabel_') && (c as BABYLON.Mesh).getBoundingInfo
      ) as BABYLON.Mesh[];

      if (children.length === 0) {
        // Empty file box: keep a sensible minimum size.
        const minSize = nodeWorldSize * 4;
        fileBox.scaling = new BABYLON.Vector3(minSize, minSize, minSize);
        continue;
      }

      // ── Step 1: read LOCAL positions (child.position is already in parent-local space) ──
      // Do NOT use world→local inverse-transform because that inherits the current scaling
      // and then re-setting the scaling causes world positions to explode: a circular bug.
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const child of children) {
        minX = Math.min(minX, child.position.x);
        maxX = Math.max(maxX, child.position.x);
        minY = Math.min(minY, child.position.y);
        maxY = Math.max(maxY, child.position.y);
        minZ = Math.min(minZ, child.position.z);
        maxZ = Math.max(maxZ, child.position.z);
      }

      if (!Number.isFinite(minX)) {
        continue;
      }

      // ── Step 2: center children around the file-box local origin ──
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      for (const child of children) {
        child.position.x -= cx;
        child.position.y -= cy;
        child.position.z -= cz;
      }

      // ── Step 3: compute per-axis local extents of children ──
      const currentScaleX = fileBox.scaling.x;
      const currentScaleY = fileBox.scaling.y;
      const currentScaleZ = fileBox.scaling.z;
      let maxLocalExtentX = 0, maxLocalExtentY = 0, maxLocalExtentZ = 0;
      for (const child of children) {
        maxLocalExtentX = Math.max(maxLocalExtentX, Math.abs(child.position.x));
        maxLocalExtentY = Math.max(maxLocalExtentY, Math.abs(child.position.y));
        maxLocalExtentZ = Math.max(maxLocalExtentZ, Math.abs(child.position.z));
      }

      // ── Step 4: compute desired per-axis world scale ──
      // Each axis: scale = (worldHalfExtent + padding) * 2, minimum 4 node-widths.
      // Use 4× node size as per-axis padding so internal functions have generous spacing.
      const axisPadding = nodeWorldSize * 4;
      const desiredScaleX = Math.max(nodeWorldSize * 4, (maxLocalExtentX * currentScaleX + axisPadding) * 2);
      const desiredScaleY = Math.max(nodeWorldSize * 4, (maxLocalExtentY * currentScaleY + axisPadding) * 2);
      const desiredScaleZ = Math.max(nodeWorldSize * 4, (maxLocalExtentZ * currentScaleZ + axisPadding) * 2);

      // ── Step 5: rescale LOCAL positions per axis to preserve world positions ──
      // world = scale * local  →  new_local = old_local * (oldScale / newScale)
      // Skip exported functions here — they will be re-snapped to the face surface below.
      for (const child of children) {
        const nodeId = (child as any).nodeData?.id as string | undefined;
        const isExported = nodeId && this.graphNodeMap.get(nodeId)?.isExported;
        if (isExported) continue;
        if (desiredScaleX !== currentScaleX) child.position.x *= currentScaleX / desiredScaleX;
        if (desiredScaleY !== currentScaleY) child.position.y *= currentScaleY / desiredScaleY;
        if (desiredScaleZ !== currentScaleZ) child.position.z *= currentScaleZ / desiredScaleZ;
      }

      fileBox.scaling = new BABYLON.Vector3(desiredScaleX, desiredScaleY, desiredScaleZ);

      // ── Step 6: re-snap exported functions to the face they were on ──
      // Exported functions live at one of the 6 face centres (largest |local coord| = 0.5).
      // The face surface is always at ±0.5 in local space regardless of scaling.
      for (const child of children) {
        const nodeId = (child as any).nodeData?.id as string | undefined;
        if (!nodeId) continue;
        const node = this.graphNodeMap.get(nodeId);
        if (!node?.isExported) continue;

        const ax = Math.abs(child.position.x);
        const ay = Math.abs(child.position.y);
        const az = Math.abs(child.position.z);

        if (ax >= ay && ax >= az) {
          child.position.x = child.position.x >= 0 ? 0.5 : -0.5;
          child.position.y = 0;
          child.position.z = 0;
        } else if (ay >= ax && ay >= az) {
          child.position.x = 0;
          child.position.y = child.position.y >= 0 ? 0.5 : -0.5;
          child.position.z = 0;
        } else {
          child.position.x = 0;
          child.position.y = 0;
          child.position.z = child.position.z >= 0 ? 0.5 : -0.5;
        }
      }

      for (const child of fileBox.getChildren()) {
        const mesh = child as BABYLON.Mesh;
        if (mesh.name?.startsWith('filelabel_')) {
          this.updateFileBoxLabelTransform(mesh, fileBox);
          continue;
        }
        this.applyChildScaleCompensation(mesh, fileBox);
      }
    }
  }

  /**
   * Ensure exported function meshes are children of their file boxes.
   */
  public ensureExportedFunctionsParentedToFileBoxes(): void {
    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node) {
        continue;
      }

      if (node.type !== 'function' || !node.isExported) {
        continue;
      }

      const file = node.file;
      if (!file || file === 'external') {
        continue;
      }

      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) {
        continue;
      }

      // Enforce visibility for exported function meshes.
      mesh.isVisible = true;
      mesh.setEnabled(true);
      mesh.renderOutline = false;
      const meshMaterial = mesh.material as BABYLON.StandardMaterial | null;
      if (meshMaterial) {
        meshMaterial.alpha = 1.0;
        meshMaterial.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
        meshMaterial.disableLighting = true;
        meshMaterial.emissiveColor = new BABYLON.Color3(0.95, 0.95, 1.0);
      }

      if (mesh.parent !== fileBox) {
        // Preserve world transform while switching parent.
        const worldPos = mesh.getAbsolutePosition().clone();
        mesh.parent = fileBox;
        const localPos = BABYLON.Vector3.TransformCoordinates(
          worldPos,
          BABYLON.Matrix.Invert(fileBox.getWorldMatrix())
        );
        mesh.position = localPos;
      }

      // Keep exported function world size stable while parent file box scales.
      this.applyChildScaleCompensation(mesh, fileBox);
    }
  }

  /**
   * For each exported function node, find the face of its parent file box
   * whose centre minimises the total Euclidean distance to all connected nodes
   * in other files, then snap the node's local position to that face centre.
   *
   * The parent file box is a unit cube (local coords −0.5 → +0.5) scaled by
   * fileBox.scaling, so each face centre in LOCAL space is ±0.5 on one axis.
   * World position = fileBox.position + fileBox.scaling ⊙ localPos.
   */
  private placeExportedFunctionsOnOptimalFace(): void {
    // Build a quick lookup: nodeId → world positions of all cross-file neighbours.
    // We use file-box positions as a proxy for neighbours inside the same remote file
    // (the exported function of the target file hasn't been repositioned yet during
    // the same loop, so using the box centre is stable and avoids ordering issues).
    const crossFileNeighbours = new Map<string, BABYLON.Vector3[]>();

    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const from = edgeId.slice(0, arrow);
      const to   = edgeId.slice(arrow + 1);

      const fromFile = this.nodeToFile.get(from);
      const toFile   = this.nodeToFile.get(to);
      if (!fromFile || !toFile || fromFile === toFile) continue;

      // For the `from` side: neighbour world pos is the `to` node mesh world pos
      // (or its file box centre if the mesh is not available).
      const toMesh   = this.nodeMeshMap.get(to);
      const toBox    = this.fileBoxMeshes.get(toFile);
      const toWorld  = toMesh
        ? toMesh.getAbsolutePosition().clone()
        : (toBox ? toBox.position.clone() : null);
      if (toWorld) {
        if (!crossFileNeighbours.has(from)) crossFileNeighbours.set(from, []);
        crossFileNeighbours.get(from)!.push(toWorld);
      }

      // For the `to` side symmetrically.
      const fromMesh  = this.nodeMeshMap.get(from);
      const fromBox   = this.fileBoxMeshes.get(fromFile);
      const fromWorld = fromMesh
        ? fromMesh.getAbsolutePosition().clone()
        : (fromBox ? fromBox.position.clone() : null);
      if (fromWorld) {
        if (!crossFileNeighbours.has(to)) crossFileNeighbours.set(to, []);
        crossFileNeighbours.get(to)!.push(fromWorld);
      }
    }

    // The unit box has face centres at ±0.5 along each local axis.
    const faceCentresLocal: Array<BABYLON.Vector3> = [
      new BABYLON.Vector3( 0.5,  0,    0),
      new BABYLON.Vector3(-0.5,  0,    0),
      new BABYLON.Vector3( 0,    0.5,  0),
      new BABYLON.Vector3( 0,   -0.5,  0),
      new BABYLON.Vector3( 0,    0,    0.5),
      new BABYLON.Vector3( 0,    0,   -0.5),
    ];

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.type !== 'function' || !node.isExported) continue;

      const file = node.file;
      if (!file || file === 'external') continue;

      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) continue;

      const neighbours = crossFileNeighbours.get(nodeId);
      if (!neighbours || neighbours.length === 0) {
        // No cross-file neighbours: still force exported node onto a face.
        // Use the dominant local axis from its current placement.
        const lp = mesh.position;
        const ax = Math.abs(lp.x);
        const ay = Math.abs(lp.y);
        const az = Math.abs(lp.z);

        if (ax >= ay && ax >= az) {
          const sign = lp.x >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'x', sign);
          mesh.position = new BABYLON.Vector3(target, 0, 0);
        } else if (ay >= ax && ay >= az) {
          const sign = lp.y >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'y', sign);
          mesh.position = new BABYLON.Vector3(0, target, 0);
        } else {
          const sign = lp.z >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'z', sign);
          mesh.position = new BABYLON.Vector3(0, 0, target);
        }

        this.applyChildScaleCompensation(mesh, fileBox);
        continue;
      }

      // Find the face whose world centre has the smallest sum of distances to
      // all cross-file neighbours.
      let bestLocalPos = faceCentresLocal[0];
      let bestCost     = Infinity;

      for (const localFace of faceCentresLocal) {
        // world = boxPos + scaling ⊙ localPos  (component-wise, no rotation)
        const worldX = fileBox.position.x + fileBox.scaling.x * localFace.x;
        const worldY = fileBox.position.y + fileBox.scaling.y * localFace.y;
        const worldZ = fileBox.position.z + fileBox.scaling.z * localFace.z;

        let cost = 0;
        for (const nb of neighbours) {
          const dx = worldX - nb.x;
          const dy = worldY - nb.y;
          const dz = worldZ - nb.z;
          cost += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        if (cost < bestCost) {
          bestCost     = cost;
          bestLocalPos = localFace;
        }
      }

      // Move the mesh to the best face, protruding outside the file box.
      if (Math.abs(bestLocalPos.x) > 0) {
        const sign = bestLocalPos.x > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'x', sign);
        mesh.position = new BABYLON.Vector3(target, 0, 0);
      } else if (Math.abs(bestLocalPos.y) > 0) {
        const sign = bestLocalPos.y > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'y', sign);
        mesh.position = new BABYLON.Vector3(0, target, 0);
      } else {
        const sign = bestLocalPos.z > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'z', sign);
        mesh.position = new BABYLON.Vector3(0, 0, target);
      }
      this.applyChildScaleCompensation(mesh, fileBox);
    }
  }

  /**
   * Compute the local coordinate for an exported node centre so the node sits
   * just outside a file-box face on the given axis/sign.
   */
  private getExportedFaceLocalTarget(
    fileBox: BABYLON.Mesh,
    mesh: BABYLON.Mesh,
    axis: 'x' | 'y' | 'z',
    sign: number
  ): number {
    const boxScale = axis === 'x'
      ? Math.max(0.0001, fileBox.scaling.x)
      : axis === 'y'
        ? Math.max(0.0001, fileBox.scaling.y)
        : Math.max(0.0001, fileBox.scaling.z);

    const clearance = 0.01;

    // Test doubles may not implement full Babylon bounding APIs.
    if (typeof (mesh as any).getBoundingInfo !== 'function') {
      const exportedBoxSize = Math.max(6.0, SceneConfig.FUNCTION_BOX_SIZE);
      const worldHalf = exportedBoxSize * 0.5;
      const localProtrusion = worldHalf / boxScale;
      return (sign >= 0 ? 1 : -1) * (0.5 + localProtrusion + clearance);
    }

    if (typeof (mesh as any).computeWorldMatrix === 'function') {
      mesh.computeWorldMatrix(true);
    }
    const bbox = mesh.getBoundingInfo().boundingBox;

    const maxWorld = (bbox as any).maximumWorld ?? bbox.maximum;
    const minWorld = (bbox as any).minimumWorld ?? bbox.minimum;
    const worldHalf = axis === 'x'
      ? (maxWorld.x - minWorld.x) * 0.5
      : axis === 'y'
        ? (maxWorld.y - minWorld.y) * 0.5
        : (maxWorld.z - minWorld.z) * 0.5;

    const localProtrusion = worldHalf / boxScale;
    return (sign >= 0 ? 1 : -1) * (0.5 + localProtrusion + clearance);
  }

  /**
   * Push non-endpoint file boxes away from every cross-file edge path so
   * edges do not visually collide with unconnected file boxes.
   *
   * Algorithm (repeated up to `iterations` times):
   *   For each unique cross-file edge (boxA → boxB):
   *     For each other box C (not A or B):
   *       Find the closest point on segment A→B to C's centre.
   *       If the distance is less than C's bounding-sphere radius + padding,
   *       push C perpendicularly away from the segment by the deficit amount.
   *   After each full edge-obstruction pass, re-resolve any new overlaps.
   */
  private resolveEdgeObstructions(iterations: number = 30): void {
    // Collect unique cross-file edge pairs.
    const crossFileEdges: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const from = edgeId.slice(0, arrow);
      const to   = edgeId.slice(arrow + 1);
      const fromFile = this.nodeToFile.get(from);
      const toFile   = this.nodeToFile.get(to);
      if (!fromFile || !toFile || fromFile === toFile) continue;
      const key = fromFile < toFile
        ? `${fromFile}⟷${toFile}`
        : `${toFile}⟷${fromFile}`;
      if (!seen.has(key)) {
        seen.add(key);
        crossFileEdges.push([fromFile, toFile]);
      }
    }
    if (crossFileEdges.length === 0) return;

    const allFiles = Array.from(this.fileBoxMeshes.keys());
    const edgePadding = 6.0; // clearance beyond bounding-sphere radius

    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;

      for (const [fileA, fileB] of crossFileEdges) {
        const boxA = this.fileBoxMeshes.get(fileA);
        const boxB = this.fileBoxMeshes.get(fileB);
        if (!boxA || !boxB) continue;

        const Ax = boxA.position.x, Ay = boxA.position.y, Az = boxA.position.z;
        const Bx = boxB.position.x, By = boxB.position.y, Bz = boxB.position.z;
        const ABx = Bx - Ax, ABy = By - Ay, ABz = Bz - Az;
        const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
        if (AB2 < 0.0001) continue; // degenerate (same position)
        const ABlen = Math.sqrt(AB2);

        // Compute t-range that excludes the interiors of the endpoint boxes.
        const rA = Math.sqrt(
          (boxA.scaling.x * 0.5) ** 2 +
          (boxA.scaling.y * 0.5) ** 2 +
          (boxA.scaling.z * 0.5) ** 2
        );
        const rB = Math.sqrt(
          (boxB.scaling.x * 0.5) ** 2 +
          (boxB.scaling.y * 0.5) ** 2 +
          (boxB.scaling.z * 0.5) ** 2
        );
        const tMin = rA / ABlen;
        const tMax = 1.0 - rB / ABlen;
        if (tMin >= tMax) continue; // boxes are touching / overlapping

        for (const fileC of allFiles) {
          if (fileC === fileA || fileC === fileB) continue;
          const boxC = this.fileBoxMeshes.get(fileC);
          if (!boxC) continue;

          const Cx = boxC.position.x, Cy = boxC.position.y, Cz = boxC.position.z;

          // Closest point on segment AB to C, clamped to [tMin, tMax]
          const ACx = Cx - Ax, ACy = Cy - Ay, ACz = Cz - Az;
          const tRaw = (ACx * ABx + ACy * ABy + ACz * ABz) / AB2;
          const t = Math.max(tMin, Math.min(tMax, tRaw));

          const closestX = Ax + t * ABx;
          const closestY = Ay + t * ABy;
          const closestZ = Az + t * ABz;

          const dx = Cx - closestX;
          const dy = Cy - closestY;
          const dz = Cz - closestZ;
          const dist2 = dx * dx + dy * dy + dz * dz;

          const rC = Math.sqrt(
            (boxC.scaling.x * 0.5) ** 2 +
            (boxC.scaling.y * 0.5) ** 2 +
            (boxC.scaling.z * 0.5) ** 2
          );
          const required = rC + edgePadding;

          if (dist2 < required * required) {
            const dist    = Math.sqrt(dist2);
            const deficit = required - dist;

            let pushX: number, pushY: number, pushZ: number;
            if (dist < 0.001) {
              // Box centre lies exactly on the edge — push perpendicular to edge.
              const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
              // Cross with Y-up to get a perpendicular; fall back to X-right if parallel.
              let perpX = ey * 0 - ez * 1;   // cross(e, up=(0,1,0))
              let perpZ = ex * 1 - ey * 0;
              let perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
              if (perpLen < 0.001) { perpX = 1; perpZ = 0; perpLen = 1; }
              pushX = (perpX / perpLen) * required;
              pushY = 0;
              pushZ = (perpZ / perpLen) * required;
            } else {
              pushX = (dx / dist) * deficit;
              pushY = (dy / dist) * deficit;
              pushZ = (dz / dist) * deficit;
            }

            boxC.position.x += pushX;
            boxC.position.y += pushY;
            boxC.position.z += pushZ;
            moved = true;
          }
        }
      }

      // Re-resolve any overlaps created by the pushes before the next pass.
      this.resolveFileBoxOverlapsByMesh(3);

      if (!moved) break;
    }
  }

  /**
   * Resolve AABB overlaps between all file boxes working directly with mesh
   * positions (does not touch ForceDirectedLayout node data).
   */
  private resolveFileBoxOverlapsByMesh(maxPasses: number = 10): void {
    const files = Array.from(this.fileBoxMeshes.keys());
    const padding = 6.0;

    for (let pass = 0; pass < maxPasses; pass++) {
      let moved = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const box1 = this.fileBoxMeshes.get(files[i]);
          const box2 = this.fileBoxMeshes.get(files[j]);
          if (!box1 || !box2) continue;

          const dx = box2.position.x - box1.position.x;
          const dy = box2.position.y - box1.position.y;
          const dz = box2.position.z - box1.position.z;

          const overlapX = (box1.scaling.x * 0.5 + box2.scaling.x * 0.5 + padding) - Math.abs(dx);
          const overlapY = (box1.scaling.y * 0.5 + box2.scaling.y * 0.5 + padding) - Math.abs(dy);
          const overlapZ = (box1.scaling.z * 0.5 + box2.scaling.z * 0.5 + padding) - Math.abs(dz);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            let axis: 'x' | 'y' | 'z' = 'x';
            let penetration = overlapX;
            if (overlapY < penetration) { axis = 'y'; penetration = overlapY; }
            if (overlapZ < penetration) { axis = 'z'; penetration = overlapZ; }

            const correction = penetration * 0.5 + 0.5;
            if (axis === 'x') {
              const sign = dx >= 0 ? 1 : -1;
              box1.position.x -= sign * correction;
              box2.position.x += sign * correction;
            } else if (axis === 'y') {
              const sign = dy >= 0 ? 1 : -1;
              box1.position.y -= sign * correction;
              box2.position.y += sign * correction;
            } else {
              const sign = dz >= 0 ? 1 : -1;
              box1.position.z -= sign * correction;
              box2.position.z += sign * correction;
            }
            moved = true;
          }
        }
      }

      if (!moved) break;
    }
  }

  /**
   * For each exported function that has been placed on a file-box face, find all
   * internal (non-exported) nodes in the same file that share an edge with it and
   * slide them toward the same face surface (along the face-normal axis). This
   * creates a visual cluster of "incoming callers" near the gateway of each box.
   *
   * The pull target is LOCAL_PULL_TARGET (≈ ±0.38) — inside the face but close
   * enough to be visually adjacent to the exported box at ±0.5.
   * After pulling, internal-node collisions are resolved.
   */
  private pullInternalNodesToExportedFace(): void {
    const PULL_TARGET = 0.38; // local-space depth to pull toward (face is at ±0.5)
    const CENTER_PULL_FACTOR = 0.5; // keep only-internal nodes biased toward box centre
    type Axis = 'x' | 'y' | 'z';

    // Track connectivity for non-exported internal function nodes.
    // hasCrossFile=true means at least one edge crosses file boundaries.
    const internalConnectionStats = new Map<string, { hasAny: boolean; hasCrossFile: boolean }>();
    const markInternalConnection = (nodeId: string, isCrossFile: boolean): void => {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.isExported || node.type !== 'function') return;
      const stats = internalConnectionStats.get(nodeId) || { hasAny: false, hasCrossFile: false };
      stats.hasAny = true;
      if (isCrossFile) stats.hasCrossFile = true;
      internalConnectionStats.set(nodeId, stats);
    };

    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const fromId = edgeId.slice(0, arrow);
      const toId   = edgeId.slice(arrow + 1);

      const fromFile = this.nodeToFile.get(fromId);
      const toFile   = this.nodeToFile.get(toId);
      if (!fromFile || !toFile) continue;

      const isCrossFile = fromFile !== toFile;
      markInternalConnection(fromId, isCrossFile);
      markInternalConnection(toId, isCrossFile);
    }

    // Build pull targets from edges that connect non-exported internal nodes to
    // exported functions.
    // - Cross-file: pull toward the face that points at the exported target file.
    // - Same-file caller→exported: pull toward the SAME inside face as exported.
    // If multiple candidates exist for a node, choose the shortest edge.
    const pullTargets = new Map<string, {
      normalAxis: Axis;
      normalSign: number;
      edgeLength: number;
    }>();

    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const fromId = edgeId.slice(0, arrow);
      const toId   = edgeId.slice(arrow + 1);

      const fromFile = this.nodeToFile.get(fromId);
      const toFile   = this.nodeToFile.get(toId);
      if (!fromFile || !toFile) continue;
      const isCrossFile = fromFile !== toFile;

      const fromNode = this.graphNodeMap.get(fromId);
      const toNode   = this.graphNodeMap.get(toId);
      if (!fromNode || !toNode) continue;

      // Identify which side is the non-exported internal node and which is exported.
      let internalId:   string | null = null;
      let internalFile: string | null = null;
      let exportedId:   string | null = null;

      if (isCrossFile) {
        if (toNode.isExported && fromNode.type === 'function' && !fromNode.isExported) {
          internalId = fromId; internalFile = fromFile; exportedId = toId;
        } else if (fromNode.isExported && toNode.type === 'function' && !toNode.isExported) {
          internalId = toId;   internalFile = toFile;   exportedId = fromId;
        }
      } else {
        // Same-file caller -> exported callee.
        if (fromNode.type === 'function' && !fromNode.isExported && toNode.isExported) {
          internalId = fromId; internalFile = fromFile; exportedId = toId;
        }
      }
      if (!internalId || !internalFile || !exportedId) continue;

      // World position of the exported function (fall back to its file box centre).
      const exportedMesh = this.nodeMeshMap.get(exportedId);
      const exportedBox  = this.fileBoxMeshes.get(this.nodeToFile.get(exportedId) || '');
      const exportedWorld = exportedMesh
        ? exportedMesh.getAbsolutePosition().clone()
        : (exportedBox ? exportedBox.position.clone() : null);
      if (!exportedWorld) continue;

      // Direction from the internal node's file box centre to the exported node,
      // expressed in the file box's local space (divide by scaling, no rotation).
      const internalBox = this.fileBoxMeshes.get(internalFile);
      if (!internalBox) continue;

      const internalMesh = this.nodeMeshMap.get(internalId);
      const internalWorld = internalMesh
        ? internalMesh.getAbsolutePosition().clone()
        : internalBox.position.clone();

      // Use actual edge length (node-to-node in world space when available)
      // to choose the strongest pull target.
      const edgeLength = exportedWorld.subtract(internalWorld).length();

      let normalAxis: Axis = 'x';
      let normalSign = 1;

      if (!isCrossFile && exportedMesh) {
        // Same-file case: mirror exported function's current face axis/sign.
        const lp = exportedMesh.position;
        const ax = Math.abs(lp.x), ay = Math.abs(lp.y), az = Math.abs(lp.z);
        if (ax >= ay && ax >= az) {
          normalAxis = 'x';
          normalSign = lp.x >= 0 ? 1 : -1;
        } else if (ay >= ax && ay >= az) {
          normalAxis = 'y';
          normalSign = lp.y >= 0 ? 1 : -1;
        } else {
          normalAxis = 'z';
          normalSign = lp.z >= 0 ? 1 : -1;
        }
      } else {
        const dx = (exportedWorld.x - internalBox.position.x) / Math.max(0.0001, internalBox.scaling.x);
        const dy = (exportedWorld.y - internalBox.position.y) / Math.max(0.0001, internalBox.scaling.y);
        const dz = (exportedWorld.z - internalBox.position.z) / Math.max(0.0001, internalBox.scaling.z);

        // Cross-file case: face that points toward exported target.
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        normalAxis = 'x';
        normalSign = dx >= 0 ? 1 : -1;
        if (ay > ax && ay >= az) { normalAxis = 'y'; normalSign = dy >= 0 ? 1 : -1; }
        else if (az > ax && az > ay) { normalAxis = 'z'; normalSign = dz >= 0 ? 1 : -1; }
      }

      const existing = pullTargets.get(internalId);
      if (!existing || edgeLength < existing.edgeLength) {
        pullTargets.set(internalId, { normalAxis, normalSign, edgeLength });
      }
    }

    // Apply the pulls toward the chosen shortest-edge face target.
    for (const [internalId, { normalAxis, normalSign }] of pullTargets.entries()) {
      const mesh    = this.nodeMeshMap.get(internalId);
      if (!mesh) continue;
      const fileBox = this.fileBoxMeshes.get(this.nodeToFile.get(internalId) || '');
      if (!mesh.parent || mesh.parent !== fileBox) continue;

      const target  = normalSign * PULL_TARGET;
      (mesh.position as any)[normalAxis] = target;
    }

    // Internal nodes with only same-file connections should live closer to the
    // centre of their file box rather than near a face.
    for (const [nodeId, stats] of internalConnectionStats.entries()) {
      if (!stats.hasAny || stats.hasCrossFile) continue;
      if (pullTargets.has(nodeId)) continue;

      const mesh = this.nodeMeshMap.get(nodeId);
      if (!mesh) continue;
      const fileBox = this.fileBoxMeshes.get(this.nodeToFile.get(nodeId) || '');
      if (!mesh.parent || mesh.parent !== fileBox) continue;

      mesh.position.x *= CENTER_PULL_FACTOR;
      mesh.position.y *= CENTER_PULL_FACTOR;
      mesh.position.z *= CENTER_PULL_FACTOR;
    }

    this.clampNodesInsideFileBoxes();
    this.resolveInternalNodeCollisions(10);
  }

  /**
   * Push apart internal (non-exported) node meshes that sit in the same file box
   * and overlap in world space. Exported nodes are left pinned to their faces.
   * Operates in world space for push computation, converts result to local space.
   */
  private resolveInternalNodeCollisions(maxPasses: number = 10): void {
    // World-space minimum centre-to-centre separation.
    // Nodes have world size ≈ 1.0 after scale compensation.
    const minSepWorld = 2.0; // 1.0 diameter × 2, a small gap between boxes

    for (const [, fileBox] of this.fileBoxMeshes.entries()) {
      // Gather non-exported children of this file box.
      const children: BABYLON.Mesh[] = [];
      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.isExported) continue;
        if (mesh.parent !== fileBox) continue;
        children.push(mesh);
      }
      if (children.length < 2) continue;

      for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (let i = 0; i < children.length; i++) {
          for (let j = i + 1; j < children.length; j++) {
            const a = children[i];
            const b = children[j];
            const wa = a.getAbsolutePosition();
            const wb = b.getAbsolutePosition();
            const dx = wb.x - wa.x;
            const dy = wb.y - wa.y;
            const dz = wb.z - wa.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist >= minSepWorld) continue;

            const deficit = (minSepWorld - dist) * 0.5;
            let nx: number, ny: number, nz: number;
            if (dist < 0.001) {
              nx = 1; ny = 0; nz = 0;
            } else {
              nx = dx / dist; ny = dy / dist; nz = dz / dist;
            }

            // Convert world-space push to local space.
            const safeX = Math.max(0.0001, fileBox.scaling.x);
            const safeY = Math.max(0.0001, fileBox.scaling.y);
            const safeZ = Math.max(0.0001, fileBox.scaling.z);
            a.position.x -= (nx * deficit) / safeX;
            a.position.y -= (ny * deficit) / safeY;
            a.position.z -= (nz * deficit) / safeZ;
            b.position.x += (nx * deficit) / safeX;
            b.position.y += (ny * deficit) / safeY;
            b.position.z += (nz * deficit) / safeZ;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }

    this.clampNodesInsideFileBoxes();
  }

  /**
   * Slide exported function nodes along their pinned face to avoid edges
   * that pass too close. Movement is constrained to the face plane so the
  * node never leaves its face (face-normal local coordinate stays outside the
  * box at ±(0.5 + protrusion)).
   * The two tangential local axes are clamped to ±0.45 so the node stays
   * visibly on the face.
   */
  private resolveExportedFaceEdgeObstructions(iterations: number = 15): void {
    const nodeRadius = 0.5;
    const nodePadding = 5.0;
    const required = nodeRadius + nodePadding;
    const maxTangent = 0.45; // local-space limit along face tangent axes
    // Threshold at or above which a local axis is treated as the face normal.
    const faceThresh = 0.45;

    for (let iter = 0; iter < iterations; iter++) {
      // Rebuild world-space edge segments each pass.
      const segments: Array<{
        fromId: string; toId: string;
        from: BABYLON.Vector3; to: BABYLON.Vector3;
      }> = [];
      for (const edgeId of this.currentEdges) {
        const arrow = edgeId.indexOf('→');
        if (arrow < 0) continue;
        const fromId = edgeId.slice(0, arrow);
        const toId   = edgeId.slice(arrow + 1);
        const fromMesh = this.nodeMeshMap.get(fromId);
        const toMesh   = this.nodeMeshMap.get(toId);
        if (!fromMesh || !toMesh) continue;
        segments.push({
          fromId, toId,
          from: fromMesh.getAbsolutePosition().clone(),
          to:   toMesh.getAbsolutePosition().clone(),
        });
      }
      if (segments.length === 0) break;

      let moved = false;

      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || !node.isExported || node.type !== 'function') continue;

        const fileBox = this.fileBoxMeshes.get(node.file || '');
        if (!fileBox) continue;

        const lp = mesh.position; // local position in file-box space

        // Determine face normal axis (whichever local coord has |value| ≥ faceThresh).
        type Axis = 'x' | 'y' | 'z';
        let normalAxis: Axis | null = null;
        let normalSign = 1;
        if (Math.abs(lp.x) >= faceThresh) { normalAxis = 'x'; normalSign = Math.sign(lp.x); }
        else if (Math.abs(lp.y) >= faceThresh) { normalAxis = 'y'; normalSign = Math.sign(lp.y); }
        else if (Math.abs(lp.z) >= faceThresh) { normalAxis = 'z'; normalSign = Math.sign(lp.z); }
        if (!normalAxis) continue; // not yet face-placed

        const tangentAxes: Axis[] = (['x', 'y', 'z'] as Axis[]).filter(a => a !== normalAxis);

        const wp = mesh.getAbsolutePosition();

        for (const seg of segments) {
          if (seg.fromId === nodeId || seg.toId === nodeId) continue;

          const ABx = seg.to.x - seg.from.x;
          const ABy = seg.to.y - seg.from.y;
          const ABz = seg.to.z - seg.from.z;
          const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
          if (AB2 < 0.0001) continue;

          const t = Math.max(0, Math.min(1,
            ((wp.x - seg.from.x) * ABx +
             (wp.y - seg.from.y) * ABy +
             (wp.z - seg.from.z) * ABz) / AB2
          ));

          const cx = seg.from.x + t * ABx;
          const cy = seg.from.y + t * ABy;
          const cz = seg.from.z + t * ABz;

          const dx = wp.x - cx;
          const dy = wp.y - cy;
          const dz = wp.z - cz;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 >= required * required) continue;

          const dist    = Math.sqrt(dist2);
          const deficit = required - dist;

          let pushX: number, pushY: number, pushZ: number;
          if (dist < 0.001) {
            const ABlen = Math.sqrt(AB2);
            const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
            let perpX = ey * 0 - ez * 1;
            let perpZ = ex * 1 - ey * 0;
            const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
            if (perpLen > 0.001) { perpX /= perpLen; perpZ /= perpLen; } else { perpX = 1; perpZ = 0; }
            pushX = perpX * required;
            pushY = 0;
            pushZ = perpZ * required;
          } else {
            pushX = (dx / dist) * deficit;
            pushY = (dy / dist) * deficit;
            pushZ = (dz / dist) * deficit;
          }

          // Convert world push to local, zero out normal axis, apply tangents only.
          const push: Record<Axis, number> = {
            x: pushX / Math.max(0.0001, fileBox.scaling.x),
            y: pushY / Math.max(0.0001, fileBox.scaling.y),
            z: pushZ / Math.max(0.0001, fileBox.scaling.z),
          };
          push[normalAxis] = 0;

          for (const axis of tangentAxes) {
            (mesh.position as any)[axis] = Math.max(-maxTangent,
              Math.min(maxTangent, (mesh.position as any)[axis] + push[axis]));
          }
          // Keep normal axis pinned outside the chosen face.
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, normalAxis, normalSign);
          (mesh.position as any)[normalAxis] = target;

          moved = true;
        }
      }

      if (!moved) break;
    }
  }

  /**
   * Nudge non-exported internal function-node meshes away from any edge segment
   * to improve visual clarity. Exported functions are left in place because
   * they are pinned to their file-box face by placeExportedFunctionsOnOptimalFace.
   * After all nudges, nodes are re-clamped inside their parent file box.
   */
  private resolveNodeEdgeObstructions(iterations: number = 20): void {
    // Internal function nodes have world-space size ≈ 1.0 after scale compensation.
    const nodeRadius = 0.5;
    const nodePadding = 5.0; // additional world-space clearance around each node
    const required = nodeRadius + nodePadding;

    for (let iter = 0; iter < iterations; iter++) {
      // Rebuild segments each pass – endpoints may have shifted from prior nudges.
      const segments: Array<{
        fromId: string; toId: string;
        from: BABYLON.Vector3; to: BABYLON.Vector3;
      }> = [];

      for (const edgeId of this.currentEdges) {
        const arrow = edgeId.indexOf('→');
        if (arrow < 0) continue;
        const fromId = edgeId.slice(0, arrow);
        const toId   = edgeId.slice(arrow + 1);
        const fromMesh = this.nodeMeshMap.get(fromId);
        const toMesh   = this.nodeMeshMap.get(toId);
        if (!fromMesh || !toMesh) continue;
        segments.push({
          fromId, toId,
          from: fromMesh.getAbsolutePosition().clone(),
          to:   toMesh.getAbsolutePosition().clone(),
        });
      }

      if (segments.length === 0) break;

      let moved = false;

      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.type === 'variable' || node.type === 'external') continue;
        if (node.isExported) continue; // pinned to face – do not move

        const fileBox = this.fileBoxMeshes.get(node.file || '');
        if (!fileBox) continue;

        const wp = mesh.getAbsolutePosition();

        for (const seg of segments) {
          if (seg.fromId === nodeId || seg.toId === nodeId) continue;

          const ABx = seg.to.x - seg.from.x;
          const ABy = seg.to.y - seg.from.y;
          const ABz = seg.to.z - seg.from.z;
          const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
          if (AB2 < 0.0001) continue;

          const t = Math.max(0, Math.min(1,
            ((wp.x - seg.from.x) * ABx +
             (wp.y - seg.from.y) * ABy +
             (wp.z - seg.from.z) * ABz) / AB2
          ));

          const cx = seg.from.x + t * ABx;
          const cy = seg.from.y + t * ABy;
          const cz = seg.from.z + t * ABz;

          const dx = wp.x - cx;
          const dy = wp.y - cy;
          const dz = wp.z - cz;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 >= required * required) continue;

          const dist    = Math.sqrt(dist2);
          const deficit = required - dist;

          let pushX: number, pushY: number, pushZ: number;
          if (dist < 0.001) {
            // Node centre lies on the segment – push perpendicular to edge direction.
            const ABlen = Math.sqrt(AB2);
            const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
            let perpX = ey * 0 - ez * 1;
            let perpZ = ex * 1 - ey * 0;
            let perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
            if (perpLen < 0.001) { perpX = 1; perpZ = 0; perpLen = 1; }
            pushX = (perpX / perpLen) * required;
            pushY = 0;
            pushZ = (perpZ / perpLen) * required;
          } else {
            pushX = (dx / dist) * deficit;
            pushY = (dy / dist) * deficit;
            pushZ = (dz / dist) * deficit;
          }

          // Convert world-space push into parent file-box local space.
          mesh.position.x += pushX / fileBox.scaling.x;
          mesh.position.y += pushY / fileBox.scaling.y;
          mesh.position.z += pushZ / fileBox.scaling.z;
          moved = true;
        }
      }

      if (!moved) break;
    }

    // Re-clamp all nudged nodes to remain inside their parent file box.
    this.clampNodesInsideFileBoxes();
  }

  private renderEdges(): void {
    // Get the current graph edges in correct format for MeshFactory
    const graphEdges = Array.from(this.currentEdges).map(edgeId => {
      const [from, to] = edgeId.split('→');
      return { from, to };
    });
    
    // Build a map of node IDs to their exported status for edge material selection
    const nodeExportedMap = new Map<string, boolean>();
    if (this.currentGraphData && this.currentGraphData.nodes) {
      for (const node of this.currentGraphData.nodes) {
        nodeExportedMap.set(node.id, node.isExported || false);
      }
    }
    
    // Create edges - they'll be positioned by updateEdges() in the physics loop
    this.meshFactory.createEdges(graphEdges, new Map(), this.sceneRoot, nodeExportedMap);
  }

  /**
   * Position and target the camera so visible function meshes are in view.
   */
  private frameCameraToExportedFunctions(): void {
    const exportedPoints: BABYLON.Vector3[] = [];
    const functionPoints: BABYLON.Vector3[] = [];

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      const isFunctionNode = !!node && node.type !== 'variable' && node.type !== 'external';
      if (!node || !isFunctionNode) {
        continue;
      }
      if (!mesh.isVisible || !mesh.isEnabled()) {
        continue;
      }
      const p = mesh.getAbsolutePosition().clone();
      functionPoints.push(p);
      if (node.isExported) {
        exportedPoints.push(p);
      }
    }

    const points = functionPoints;
    const modeLabel = 'all';

    if (points.length === 0) {
      console.warn('⚠ No visible function meshes found for camera framing');
      this.camera.setTarget(BABYLON.Vector3.Zero());
      this.camera.position = new BABYLON.Vector3(0, 0, -20);
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      return;
    }

    const center = new BABYLON.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const radius = Math.max(1.0, Math.max(sizeX, sizeY, sizeZ) * 0.5);

    // Compute camera distance needed to fit the largest scene extent.
    const fov = Math.max(0.1, this.camera.fov);
    const distance = Math.max(20, (radius / Math.tan(fov * 0.5)) * 1.2);

    this.camera.setTarget(center);
    this.camera.position = new BABYLON.Vector3(center.x, center.y, center.z - distance);
    console.log(`👁 Framed camera to ${points.length} ${modeLabel} function meshes`);
  }

  /**
   * Place file boxes in a deterministic visible grid near the origin.
   */
  private positionFileBoxesInGrid(): void {
    const files = Array.from(this.fileBoxMeshes.keys()).sort();
    if (files.length === 0) {
      return;
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
    let maxHalfExtent = 0;
    for (const file of files) {
      const box = this.fileBoxMeshes.get(file);
      if (!box) {
        continue;
      }
      box.computeWorldMatrix(true);
      const bounds = box.getBoundingInfo().boundingBox;
      const extentX = (bounds.maximumWorld.x - bounds.minimumWorld.x) / 2;
      const extentY = (bounds.maximumWorld.y - bounds.minimumWorld.y) / 2;
      const extentZ = (bounds.maximumWorld.z - bounds.minimumWorld.z) / 2;
      maxHalfExtent = Math.max(maxHalfExtent, extentX, extentY, extentZ);
    }

    const minGap = 20; // guaranteed surface-to-surface separation
    const spacing = Math.max(34, (maxHalfExtent * 2) + minGap);
    const centerX = (columns - 1) * 0.5;
    const rows = Math.ceil(files.length / columns);
    const centerY = (rows - 1) * 0.5;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) {
        continue;
      }

      const row = Math.floor(i / columns);
      const col = i % columns;
      fileBox.position.x = (col - centerX) * spacing;
      fileBox.position.y = (centerY - row) * spacing;
      fileBox.position.z = 0;
    }
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
