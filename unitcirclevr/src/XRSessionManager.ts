import * as BABYLON from '@babylonjs/core';
import { Quest3GripController, type GripGesture } from './Quest3GripController';
import type { SceneState } from './SceneState';

export class XRSessionManager {
  public xrExperience: BABYLON.WebXRDefaultExperience | null = null;
  public gripController: Quest3GripController | null = null;
  private scene: BABYLON.Scene;
  private state: SceneState;
  private onRecenterGraph: () => void;
  private onGripGesture: (gesture: GripGesture) => void;

  constructor(
    scene: BABYLON.Scene,
    state: SceneState,
    onRecenterGraph: () => void,
    onGripGesture: (gesture: GripGesture) => void,
  ) {
    this.scene = scene;
    this.state = state;
    this.onRecenterGraph = onRecenterGraph;
    this.onGripGesture = onGripGesture;
  }

  isInXR(): boolean {
    return this.xrExperience?.baseExperience.state === BABYLON.WebXRState.IN_XR;
  }

  // ── Loading panel ───────────────────────────────────────────────────────────

  createXRLoadingPanel(): void {
    const panel = BABYLON.MeshBuilder.CreatePlane(
      'xrLoadingPanel',
      { width: 3.2, height: 0.8 },
      this.scene,
    );
    panel.isPickable = false;
    panel.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    panel.setEnabled(false);

    const texture = new BABYLON.DynamicTexture(
      'xrLoadingTexture',
      { width: 1024, height: 256 },
      this.scene,
      true,
    );
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial('xrLoadingMaterial', this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    material.disableLighting = true;
    material.backFaceCulling = false;
    panel.material = material;

    this.state.xrLoadingPanel = panel;
    this.state.xrLoadingTexture = texture;
    this.updateXRLoadingPanelText(0);

    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.state.xrLoadingVisible || !this.state.xrLoadingPanel) return;

      const activeCamera = this.scene.activeCamera;
      if (!activeCamera) return;

      const forward = activeCamera.getForwardRay().direction.normalize();
      const targetPosition = activeCamera.globalPosition.add(forward.scale(2.2));
      this.state.xrLoadingPanel.position.copyFrom(targetPosition);
      this.updateXRLoadingPanelText(Math.floor(performance.now() / 400) % 4);
    });
  }

  setXRLoadingPanelVisible(visible: boolean): void {
    this.state.xrLoadingVisible = visible;
    if (this.state.xrLoadingPanel) {
      this.state.xrLoadingPanel.setEnabled(visible);
    }
  }

  // ── WebXR bootstrap ─────────────────────────────────────────────────────────

  async setupWebXR(): Promise<void> {
    this.setXRLoadingPanelVisible(false);
    try {
      const xrNavigator = (navigator as any).xr as {
        isSessionSupported?: (mode: string) => Promise<boolean>;
      } | undefined;

      if (!xrNavigator || typeof xrNavigator.isSessionSupported !== 'function') {
        console.log('WebXR API not available in this browser context; running desktop mode.');
        return;
      }

      const supportsImmersiveVR = await xrNavigator.isSessionSupported('immersive-vr');
      if (!supportsImmersiveVR) {
        console.log('WebXR immersive-vr is not supported here; running desktop mode.');
        return;
      }

      this.xrExperience = await this.scene.createDefaultXRExperienceAsync();
      console.log('WebXR experience created successfully');

      this.gripController = new Quest3GripController(this.scene);
      const xrInput = this.xrExperience.input;
      this.gripController.initializeFromXRInput(xrInput);
      this.gripController.onGripGesture((gesture) => {
        this.onGripGesture(gesture);
      });

      xrInput.onControllerAddedObservable.add((controller) => {
        console.log(`VR Controller connected: ${controller.inputSource.handedness}`);
      });
      xrInput.onControllerRemovedObservable.add((controller) => {
        console.log(`VR Controller disconnected: ${controller.inputSource.handedness}`);
      });

      this.xrExperience.baseExperience.onStateChangedObservable.add((state) => {
        if (this.state.xrLoadingHideTimer !== null) {
          window.clearTimeout(this.state.xrLoadingHideTimer);
          this.state.xrLoadingHideTimer = null;
        }

        if (state === BABYLON.WebXRState.ENTERING_XR) {
          this.setXRLoadingPanelVisible(false);
          return;
        }

        if (state === BABYLON.WebXRState.IN_XR) {
          this.onRecenterGraph();
          this.setXRLoadingPanelVisible(true);
          this.state.xrLoadingHideTimer = window.setTimeout(() => {
            this.setXRLoadingPanelVisible(false);
            this.state.xrLoadingHideTimer = null;
          }, 1200);
          return;
        }

        if (state === BABYLON.WebXRState.NOT_IN_XR) {
          this.setXRLoadingPanelVisible(false);
        }
      });

      this.setXRLoadingPanelVisible(false);
    } catch (error) {
      this.setXRLoadingPanelVisible(false);
      console.warn('WebXR not available or failed to initialize:', error);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private updateXRLoadingPanelText(dotCount: number): void {
    if (!this.state.xrLoadingTexture) return;

    const ctx = this.state.xrLoadingTexture.getContext() as CanvasRenderingContext2D;
    const width = 1024;
    const height = 256;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(6, 8, 13, 0.88)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(188, 228, 255, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.fillStyle = '#eef3ff';
    ctx.font = '600 96px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`imagining${'.'.repeat(dotCount)}`, width / 2, height / 2);
    this.state.xrLoadingTexture.update();
  }

  dispose(): void {
    this.state.xrLoadingPanel?.dispose();
    this.state.xrLoadingTexture?.dispose();
    this.state.xrLoadingPanel = null;
    this.state.xrLoadingTexture = null;
    if (this.state.xrLoadingHideTimer !== null) {
      window.clearTimeout(this.state.xrLoadingHideTimer);
      this.state.xrLoadingHideTimer = null;
    }
  }
}
