import * as BABYLON from '@babylonjs/core';
import { CodeParser } from './CodeParser';
import { ForceDirectedLayout } from './ForceDirectedLayout';

export class VRSceneManager {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera: BABYLON.UniversalCamera;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Setup lighting
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
    light.intensity = 0.7;

    // Add a point light for dynamic shadows
    const pointLight = new BABYLON.PointLight('pointLight', new BABYLON.Vector3(5, 10, 5), this.scene);
    pointLight.intensity = 0.5;

    // Create a camera with wider view
    this.camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 0, -30), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.inertia = 0.5;
    this.camera.angularSensibility = 1000;

    // Create a simple ground
    this.createGround();

    // Initialize code visualization
    this.initializeCodeVisualization();

    // Setup WebXR
    this.setupWebXR();

    // Handle window resize
    window.addEventListener('resize', () => this.engine.resize());
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 150, height: 150 }, this.scene);
    ground.material = new BABYLON.StandardMaterial('groundMat', this.scene);
    (ground.material as BABYLON.StandardMaterial).emissiveColor = new BABYLON.Color3(0.2, 0.7, 0.2);
  }

  private async initializeCodeVisualization(): Promise<void> {
    try {
      // Load source files
      const fileContents = await this.loadSourceFiles();

      if (fileContents.size === 0) {
        console.warn('No source files loaded');
        return;
      }

      // Parse code structure
      const codeGraph = await CodeParser.parseSourceFiles(fileContents);

      if (codeGraph.functions.size === 0) {
        console.warn('No functions found in source files');
        return;
      }

      // Create force-directed layout
      const edges = Array.from(codeGraph.calls.entries()).flatMap(([caller, callees]) =>
        Array.from(callees).map(callee => ({ source: caller, target: callee }))
      );

      const layout = new ForceDirectedLayout(Array.from(codeGraph.functions.keys()), edges);
      const layoutNodes = layout.simulate(200);

      // Render the graph
      this.renderCodeGraph(layoutNodes, edges);
    } catch (error) {
      console.error('Error initializing code visualization:', error);
    }
  }

  private async loadSourceFiles(): Promise<Map<string, string>> {
    const fileContents = new Map<string, string>();

    // List of source files to load
    const sourceFiles = [
      '/src/main.ts',
      '/src/VRSceneManager.ts',
      '/src/CodeParser.ts',
      '/src/ForceDirectedLayout.ts',
      '/src/counter.ts'
    ];

    for (const filePath of sourceFiles) {
      try {
        const response = await fetch(filePath);
        if (response.ok) {
          const content = await response.text();
          fileContents.set(filePath, content);
        }
      } catch (error) {
        console.warn(`Could not load ${filePath}:`, error);
      }
    }

    return fileContents;
  }

  private renderCodeGraph(
    layoutNodes: Map<string, { position: { x: number; y: number; z: number }; label: string }>,
    edges: Array<{ source: string; target: string }>
  ): void {
    const colors = [
      new BABYLON.Color3(1, 0.2, 0.2), // Red
      new BABYLON.Color3(0.2, 1, 0.2), // Green
      new BABYLON.Color3(0.2, 0.2, 1), // Blue
      new BABYLON.Color3(1, 1, 0.2), // Yellow
      new BABYLON.Color3(1, 0.2, 1), // Magenta
      new BABYLON.Color3(0.2, 1, 1)  // Cyan
    ];

    let colorIndex = 0;
    const nodeBoxes = new Map<string, BABYLON.Mesh>();

    // Create boxes for each function
    for (const [id, node] of layoutNodes) {
      const box = BABYLON.MeshBuilder.CreateBox(`func_${id}`, { size: 0.8 }, this.scene);
      box.position = new BABYLON.Vector3(node.position.x, node.position.y, node.position.z);

      const material = new BABYLON.StandardMaterial(`mat_${id}`, this.scene);
      material.emissiveColor = colors[colorIndex % colors.length];
      material.wireframe = false;
      box.material = material;

      // Add hover effect
      let originalColor = material.emissiveColor.clone();
      box.actionManager = new BABYLON.ActionManager(this.scene);
      box.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
          material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        })
      );
      box.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
          material.emissiveColor = originalColor.clone();
        })
      );

      nodeBoxes.set(id, box);
      colorIndex++;
    }

    // Draw edges (function calls)
    const edgeMaterial = new BABYLON.StandardMaterial('edgeMaterial', this.scene);
    edgeMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);

    let edgeIndex = 0;
    for (const edge of edges) {
      const sourceNode = layoutNodes.get(edge.source);
      const targetNode = layoutNodes.get(edge.target);

      if (sourceNode && targetNode) {
        const points = [
          new BABYLON.Vector3(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z),
          new BABYLON.Vector3(targetNode.position.x, targetNode.position.y, targetNode.position.z)
        ];

        // Create tube for edge visualization
        const tube = BABYLON.MeshBuilder.CreateTube(`edge_${edgeIndex}`, {
          path: points,
          radius: 0.08
        });
        tube.material = edgeMaterial;
        edgeIndex++;
      }
    }

    console.log(`Rendered code graph with ${layoutNodes.size} functions and ${edges.length} call relationships`);
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
