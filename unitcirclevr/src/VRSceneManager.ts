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
   * Set up per-frame physics updates for two-level hierarchical layout
   * Level 1: File-level layout positions file boxes
   * Level 2: File-internal layouts position nodes within their boxes
   */
  private setupPhysicsLoop(): void {
    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.physicsActive && this.fileLayout && this.fileInternalLayouts.size > 0) {
          // Step 1: Update file-level layout (positions the file boxes)
          this.fileLayout.updateFrame();
          const filePositions = this.fileLayout.getNodes();
          
          // Debug: log available file positions on first frame
          if (this.physicsIterationCount === 0) {
            console.log(`  Available file positions: ${Array.from(filePositions.keys()).map(k => `"${k}"`).join(', ')}`);
            console.log(`  File boxes to update: ${Array.from(this.fileBoxMeshes.keys()).map(k => `"${k}"`).join(', ')}`);
          }
          
          // Step 2: Update each file's internal layout (positions nodes within the file)
          for (const [_file, internalLayout] of this.fileInternalLayouts.entries()) {
            internalLayout.updateFrame();
          }
          
          // Step 3: Position nodes based on composite positioning (file position + local position)
          for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
            const file = this.nodeToFile.get(nodeId);
            if (!file) continue;
            
            const internalLayout = this.fileInternalLayouts.get(file);
            if (!internalLayout) continue;
            
            const internalNode = internalLayout.getNodes().get(nodeId);
            if (!internalNode) continue;
            
            const fileNode = filePositions.get(file);
            if (!fileNode) continue;
            
            // Position is: file position + local position within file
            mesh.position.x = fileNode.position.x + internalNode.position.x;
            mesh.position.y = fileNode.position.y + internalNode.position.y;
            mesh.position.z = fileNode.position.z + internalNode.position.z;
          }

          // Step 3: Update file box positions and sizes based on file-level layout
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) {
              console.warn(`⚠ File node not found in layout for file: ${file}`);
              continue;
            }
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
              
              // Log first few iterations to debug positioning
              if (this.physicsIterationCount === 1 || this.physicsIterationCount === 10 || this.physicsIterationCount === 50) {
                console.log(`  Frame ${this.physicsIterationCount}: ${file} at [${fileNode.position.x.toFixed(1)}, ${fileNode.position.y.toFixed(1)}, ${fileNode.position.z.toFixed(1)}]`);
              }
            
            // Update file box size to fit all its nodes
            const nodeIds = this.fileNodeIds.get(file);
            if (nodeIds && nodeIds.size > 0) {
              const bounds = this.calculateNodeGroupBounds(nodeIds);
              if (bounds) {
                // Add padding to the bounds
                const padding = 5.0;  // Extra space around nodes
                const size = Math.max(bounds.width, bounds.height, bounds.depth) + padding * 2;
                // Scale the 1x1x1 box to the desired size
                fileBox.scaling = new BABYLON.Vector3(size, size, size);
              }
            }
          }
          
          // Step 3b: Apply repulsive forces to prevent file box intersections
          this.applyFileBoxRepulsion(this.fileLayout);
          
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
    // Store all graph nodes
    for (const node of graph.nodes) {
      this.graphNodeMap.set(node.id, node);
    }

    // Build file map for layout creation
    const fileMap = new Map<string, string>();
    for (const node of graph.nodes) {
      if (node.file) {
        fileMap.set(node.id, node.file);
        this.nodeToFile.set(node.id, node.file);
        if (!this.fileNodeIds.has(node.file)) {
          this.fileNodeIds.set(node.file, new Set());
        }
        this.fileNodeIds.get(node.file)!.add(node.id);
      }
    }

    // Step 1: Create file-level layout
    // Files are "nodes" positioned by cross-file reference edges
    const files = Array.from(this.fileNodeIds.keys());
    const crossFileEdges = this.buildCrossFileEdges(graph.edges, fileMap);
    console.log(`📍 File-level layout: ${files.length} files, ${crossFileEdges.length} cross-file edges`);
    console.log(`   Files: ${files.join(', ')}`);
    console.log(`   Cross-file edges: ${crossFileEdges.map(e => `${e.source}->${e.target}`).join(', ')}`);
    this.fileLayout = new ForceDirectedLayout(files, crossFileEdges);

    // Step 2: Create file-internal layouts for each file
    const allEdges = this.buildEdgeList(graph.edges);
    for (const [file, nodeIds] of this.fileNodeIds.entries()) {
      const nodeArray = Array.from(nodeIds);
      // Filter edges to only those within this file
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

    // Step 3: Calculate indegree for visualization
    const indegreeMap = this.calculateIndegree(graph.edges);

    // Step 4: Render nodes at initial positions from their file's internal layout
    this.renderNodes(graph.nodes, indegreeMap);

    // Step 4: Populate edge list and create edges
    this.currentEdges.clear();
    for (const edge of graph.edges) {
      this.currentEdges.add(`${edge.from}→${edge.to}`);
    }
    this.renderEdges();
    this.meshFactory.updateEdges();

    // Step 4.5: Create file box outlines
    this.renderFileBoxes();

    // Step 5: Start physics updates
    this.physicsActive = true;
    this.physicsIterationCount = 0;
    this.setupPhysicsLoop();

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions in ${files.length} files and ${graph.edges.length} calls`);
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
    for (const node of nodes) {
      const file = node.file || 'external';
      const fileLayout = this.fileInternalLayouts.get(file);
      
      // Get position from file's internal layout
      let position: BABYLON.Vector3;
      if (fileLayout) {
        const layoutNode = fileLayout.getNodes().get(node.id);
        if (layoutNode) {
          position = new BABYLON.Vector3(
            layoutNode.position.x,
            layoutNode.position.y,
            layoutNode.position.z
          );
        } else {
          position = BABYLON.Vector3.Zero();
        }
      } else {
        position = BABYLON.Vector3.Zero();
      }

      // Get or generate color for this file
      const fileColor = file ? this.getFileColor(file) : null;
      const indegree = indegreeMap.get(node.id) || 0;

      this.meshFactory.createNodeMesh(node, position, fileColor, indegree, (mesh, material, n) => {
        this.setupNodeInteraction(mesh, material, n);
        // Track mesh for physics updates
        this.nodeMeshMap.set(node.id, mesh);
      });
    }
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
   * Calculate bounding box dimensions for a group of nodes
   */
  private calculateNodeGroupBounds(nodeIds: Set<string>): { width: number; height: number; depth: number } | null {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let hasNodes = false;

    for (const nodeId of nodeIds) {
      const mesh = this.nodeMeshMap.get(nodeId);
      if (mesh) {
        hasNodes = true;
        const halfSize = SceneConfig.FUNCTION_BOX_SIZE / 2;
        minX = Math.min(minX, mesh.position.x - halfSize);
        maxX = Math.max(maxX, mesh.position.x + halfSize);
        minY = Math.min(minY, mesh.position.y - halfSize);
        maxY = Math.max(maxY, mesh.position.y + halfSize);
        minZ = Math.min(minZ, mesh.position.z - halfSize);
        maxZ = Math.max(maxZ, mesh.position.z + halfSize);
      }
    }

    if (!hasNodes) return null;

    return {
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ
    };
  }

  /**
   * Apply repulsive forces between file boxes to prevent intersections
   */
  private applyFileBoxRepulsion(layout: ForceDirectedLayout | null): void {
    if (!layout) return;

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = layout.getNodes();
    const repulsionStrength = 50.0;  // Force strength for box separation
    const minSeparationPadding = 15.0;  // Minimum distance padding between boxes

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

        // Calculate bounding sphere radii (half of max dimension of scaled box)
        const maxDim1 = Math.max(box1.scaling.x, box1.scaling.y, box1.scaling.z) / 2;
        const maxDim2 = Math.max(box2.scaling.x, box2.scaling.y, box2.scaling.z) / 2;
        const radius1 = maxDim1;
        const radius2 = maxDim2;

        const pos1 = new BABYLON.Vector3(node1.position.x, node1.position.y, node1.position.z);
        const pos2 = new BABYLON.Vector3(node2.position.x, node2.position.y, node2.position.z);
        const distance = BABYLON.Vector3.Distance(pos1, pos2);

        // Required distance to prevent intersection with padding
        const requiredDistance = radius1 + radius2 + minSeparationPadding;

        // If boxes are intersecting or too close, push them apart
        if (distance < requiredDistance && distance > 0.01) {
          const direction = pos2.subtract(pos1).normalize();
          const pushDistance = Math.max(0, requiredDistance - distance);

          // Apply force to both file nodes in the layout
          const repulsionForce = pushDistance * repulsionStrength;
          
          // Push file1 away from file2
          node1.velocity.x -= direction.x * repulsionForce;
          node1.velocity.y -= direction.y * repulsionForce;
          node1.velocity.z -= direction.z * repulsionForce;

          // Push file2 away from file1
          node2.velocity.x += direction.x * repulsionForce;
          node2.velocity.y += direction.y * repulsionForce;
          node2.velocity.z += direction.z * repulsionForce;
        }
      }
    }
  }

  private renderEdges(): void {
    // Get the current graph edges in correct format for MeshFactory
    const graphEdges = Array.from(this.currentEdges).map(edgeId => {
      const [from, to] = edgeId.split('→');
      return { from, to };
    });
    
    // Create edges - they'll be positioned by updateEdges() in the physics loop
    this.meshFactory.createEdges(graphEdges, new Map(), this.sceneRoot);
  }

  /**
   * Create wireframe boxes to outline each file's containing region
   */
  private renderFileBoxes(): void {
    for (const file of this.fileNodeIds.keys()) {
      // Skip external modules
      if (file === 'external') continue;
      
      // Create a wireframe box for this file
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `filebox_${file}`,
        { size: 1 },  // Start with unit box, will be scaled by physics loop
        this.scene
      );
      
      // Get file color and create wireframe material
      const fileColor = this.getFileColor(file);
      const material = new BABYLON.StandardMaterial(`fileboxmat_${file}`, this.scene);
      material.emissiveColor = fileColor;
      material.wireframe = true;
      material.backFaceCulling = false;
      material.alpha = 0.8;
      
      boxMesh.material = material;
      boxMesh.parent = this.sceneRoot;
      
      // Initially position at origin, will be updated by physics loop
      boxMesh.position = BABYLON.Vector3.Zero();
      
      // Store reference for updates
      this.fileBoxMeshes.set(file, boxMesh);
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
