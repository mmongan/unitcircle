import * as BABYLON from '@babylonjs/core';

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

    // Create a camera (default view)
    this.camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 1.6, -5), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.inertia = 0.5;
    this.camera.angularSensibility = 1000;

    // Create a simple ground
    this.createGround();

    // Create some basic objects
    this.createObjects();

    // Setup WebXR
    this.setupWebXR();

    // Handle window resize
    window.addEventListener('resize', () => this.engine.resize());
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, this.scene);
    ground.material = new BABYLON.StandardMaterial('groundMat', this.scene);
    (ground.material as BABYLON.StandardMaterial).emissiveColor = new BABYLON.Color3(0.2, 0.7, 0.2);
  }

  private createObjects(): void {
    // Create a sphere
    const sphere = BABYLON.MeshBuilder.CreateSphere('sphere', { diameter: 1 }, this.scene);
    sphere.position = new BABYLON.Vector3(0, 1, 0);
    const sphereMat = new BABYLON.StandardMaterial('sphereMat', this.scene);
    sphereMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
    sphere.material = sphereMat;

    // Create a box
    const box = BABYLON.MeshBuilder.CreateBox('box', { size: 1 }, this.scene);
    box.position = new BABYLON.Vector3(3, 0.5, 0);
    const boxMat = new BABYLON.StandardMaterial('boxMat', this.scene);
    boxMat.emissiveColor = new BABYLON.Color3(0, 0, 1);
    box.material = boxMat;

    // Create a cylinder
    const cylinder = BABYLON.MeshBuilder.CreateCylinder('cylinder', { height: 2, diameter: 0.5 }, this.scene);
    cylinder.position = new BABYLON.Vector3(-3, 1, 0);
    const cylMat = new BABYLON.StandardMaterial('cylMat', this.scene);
    cylMat.emissiveColor = new BABYLON.Color3(1, 1, 0);
    cylinder.material = cylMat;
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
