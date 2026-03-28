import * as BABYLON from '@babylonjs/core';
import { Quest3GripController } from './Quest3GripController';

/**
 * NavigationController manages all camera movement and locomotion
 * - Desktop: Keyboard/mouse WASD flight controls
 * - VR: Thumbstick locomotion via sceneRoot movement
 * - Animation: Smooth transitions to function positions
 */
export class NavigationController {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera: BABYLON.UniversalCamera;
  private sceneRoot: BABYLON.TransformNode;
  private gripController: Quest3GripController | null = null;

  private flightSpeed = 100;  // Units per second
  private keysPressed: Map<string, boolean> = new Map();
  private isFlying = false;
  private isAnimating = false;
  private flyObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

  constructor(
    engine: BABYLON.Engine,
    scene: BABYLON.Scene,
    camera: BABYLON.UniversalCamera,
    sceneRoot: BABYLON.TransformNode,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.camera = camera;
    this.sceneRoot = sceneRoot;
  }

  public setGripController(gripController: Quest3GripController): void {
    this.gripController = gripController;
  }

  public setupFlightControls(): void {
    // Keyboard event listeners for WASD movement
    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'shift', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        this.keysPressed.set(key, true);
        this.isFlying = true;
        // Cancel any in-progress fly-to animation so manual flight takes over
        // immediately instead of fighting the tween.
        if (this.isAnimating) {
          this.scene.stopAnimation(this.camera);
          if (this.flyObserver) {
            this.scene.onBeforeRenderObservable.remove(this.flyObserver);
            this.flyObserver = null;
          }
          this.isAnimating = false;
        }
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
        if (this.isInXR()) {
          this.updateXRFlight();
        } else if (this.isFlying) {
          this.updateFlight();
        }
      });
    }
  }

  /**
   * Update XR locomotion from controller thumbsticks by moving the sceneRoot.
   * In immersive mode the headset owns the camera, so locomotion must move the world.
   */
  public updateXRFlight(): void {
    if (!this.gripController) {
      return;
    }

    const leftGrip = this.gripController.getGripState('left');
    const rightGrip = this.gripController.getGripState('right');
    const deadzone = 0.15;

    const strafeInput = Math.abs(leftGrip.thumbstickX) > deadzone ? leftGrip.thumbstickX : 0;
    const forwardInput = Math.abs(leftGrip.thumbstickY) > deadzone ? -leftGrip.thumbstickY : 0;
    const verticalInput = Math.abs(rightGrip.thumbstickY) > deadzone ? rightGrip.thumbstickY : 0;

    if (strafeInput === 0 && forwardInput === 0 && verticalInput === 0) {
      return;
    }

    // Manual thumbstick locomotion must override any in-progress XR fly animation.
    if (this.isAnimating) {
      this.scene.stopAnimation(this.sceneRoot);
      this.isAnimating = false;
    }

    const deltaTime = Math.min(this.engine.getDeltaTime() / 1000, 1 / 30);
    const distance = this.flightSpeed * deltaTime;
    const activeCamera = this.scene.activeCamera;
    if (!activeCamera) {
      return;
    }

    const cameraForward = activeCamera.getForwardRay().direction;
    const flatForward = new BABYLON.Vector3(cameraForward.x, 0, cameraForward.z);
    const forward = flatForward.lengthSquared() > 0.0001
      ? flatForward.normalize()
      : new BABYLON.Vector3(0, 0, 1);
    const right = new BABYLON.Vector3(forward.z, 0, -forward.x);
    const up = BABYLON.Axis.Y;

    const desiredMovement = BABYLON.Vector3.Zero();
    desiredMovement.addInPlace(forward.scale(forwardInput * distance));
    desiredMovement.addInPlace(right.scale(strafeInput * distance));
    desiredMovement.addInPlace(up.scale(verticalInput * distance));

    if (desiredMovement.lengthSquared() === 0) {
      return;
    }

    // Move the world opposite the user's intended locomotion.
    this.sceneRoot.position.subtractInPlace(desiredMovement);
  }

  /**
   * Update camera position based on keyboard input for free flight
   */
  public updateFlight(): void {
    // Clamp delta to avoid large per-frame movement spikes that look like vibration.
    const deltaTime = Math.min(this.engine.getDeltaTime() / 1000, 1 / 30);
    const distance = this.flightSpeed * deltaTime;

    // Get camera direction vectors
    const forward = this.camera.getDirection(BABYLON.Axis.Z);
    const right = this.camera.getDirection(BABYLON.Axis.X);
    const up = BABYLON.Axis.Y;

    const movement = BABYLON.Vector3.Zero();

    // Process keyboard input
    if (this.keysPressed.get('w') || this.keysPressed.get('arrowup')) {
      // Move forward
      movement.addInPlace(forward.scale(distance));
    }
    if (this.keysPressed.get('s') || this.keysPressed.get('arrowdown')) {
      // Move backward
      movement.addInPlace(forward.scale(-distance));
    }
    if (this.keysPressed.get('a') || this.keysPressed.get('arrowleft')) {
      // Move left
      movement.addInPlace(right.scale(-distance));
    }
    if (this.keysPressed.get('d') || this.keysPressed.get('arrowright')) {
      // Move right
      movement.addInPlace(right.scale(distance));
    }
    if (this.keysPressed.get(' ')) {
      // Move up
      movement.addInPlace(up.scale(distance));
    }
    if (this.keysPressed.get('shift') || this.keysPressed.get('control')) {
      // Move down
      movement.addInPlace(up.scale(-distance));
    }

    if (movement.lengthSquared() > 0) {
      this.camera.position.addInPlace(movement);
    }
  }

  /**
   * Animate camera to a world position with easing
   */
  public flyToWorldPosition(targetPosition: BABYLON.Vector3, targetMesh: BABYLON.Mesh): void {
    if (this.isInXR()) {
      this.flyToViaSceneRoot(targetPosition, targetMesh);
    } else {
      this.flyToViaCamera(targetPosition, targetMesh);
    }
  }

  /**
   * Desktop: Animate camera to position with easing
   */
  private flyToViaCamera(targetPosition: BABYLON.Vector3, targetMesh: BABYLON.Mesh): void {
    if (!this.camera) return;

    const startPos = this.camera.position.clone();
    const distance = BABYLON.Vector3.Distance(startPos, targetPosition);
    const duration = Math.max(300, Math.min(1500, distance * 5));

    this.isAnimating = true;
    let elapsedTime = 0;

    if (this.flyObserver) {
      this.scene.onBeforeRenderObservable.remove(this.flyObserver);
    }

    this.flyObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.isAnimating) {
        if (this.flyObserver) {
          this.scene.onBeforeRenderObservable.remove(this.flyObserver);
          this.flyObserver = null;
        }
        return;
      }

      elapsedTime += this.engine.getDeltaTime();
      const progress = Math.min(elapsedTime / duration, 1.0);

      // Easing function: ease-out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      this.camera.position = BABYLON.Vector3.Lerp(startPos, targetPosition, easeProgress);
      this.camera.target = targetMesh.getAbsolutePosition();

      if (progress >= 1.0) {
        this.isAnimating = false;
        this.camera.position = targetPosition;
        this.camera.target = targetMesh.getAbsolutePosition();
      }
    });
  }

  /**
   * XR: Animate sceneRoot so target reaches gaze point
   */
  private flyToViaSceneRoot(targetPosition: BABYLON.Vector3, _targetMesh: BABYLON.Mesh): void {
    const activeCamera = this.scene.activeCamera;
    if (!activeCamera) return;

    const cameraForward = activeCamera.getForwardRay().direction;
    const gazeDistance = 2.0;
    const gazePoint = activeCamera.globalPosition.add(cameraForward.scale(gazeDistance));

    const startPos = this.sceneRoot.position.clone();
    const offset = gazePoint.subtract(targetPosition);
    const endPos = this.sceneRoot.position.add(offset);

    const distance = BABYLON.Vector3.Distance(startPos, endPos);
    const duration = Math.max(300, Math.min(1500, distance * 5));

    this.isAnimating = true;
    let elapsedTime = 0;

    if (this.flyObserver) {
      this.scene.onBeforeRenderObservable.remove(this.flyObserver);
    }

    this.flyObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.isAnimating) {
        if (this.flyObserver) {
          this.scene.onBeforeRenderObservable.remove(this.flyObserver);
          this.flyObserver = null;
        }
        return;
      }

      elapsedTime += this.engine.getDeltaTime();
      const progress = Math.min(elapsedTime / duration, 1.0);

      // Easing function: ease-out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      this.sceneRoot.position = BABYLON.Vector3.Lerp(startPos, endPos, easeProgress);

      if (progress >= 1.0) {
        this.isAnimating = false;
        this.sceneRoot.position = endPos;
      }
    });
  }

  /**
   * Slide camera to display a specific cube face
   */
  public slideFaceView(faceNormal: BABYLON.Vector3, targetMesh: BABYLON.Mesh): void {
    const meshCenter = targetMesh.getAbsolutePosition();
    const scaling = targetMesh.scaling;
    const distance = Math.max(scaling.x, scaling.y, scaling.z) * 1.5;

    let viewOffset = faceNormal.scale(distance);
    
    // Add small vertical offset to show the face better
    viewOffset.y += distance * 0.3;

    const targetPos = meshCenter.add(viewOffset);
    this.flyToWorldPosition(targetPos, targetMesh);
  }

  /**
   * Determine which cube face was clicked based on picked point
   */
  public quantizeFaceNormalFromPickedPoint(
    mesh: BABYLON.Mesh,
    pickedPoint: BABYLON.Vector3 | null,
    fallbackNormal: BABYLON.Vector3,
  ): BABYLON.Vector3 {
    if (!pickedPoint) {
      return fallbackNormal.clone();
    }

    const center = mesh.getAbsolutePosition();
    const delta = pickedPoint.subtract(center);
    if (!Number.isFinite(delta.length()) || delta.lengthSquared() < 0.000001) {
      return fallbackNormal.clone();
    }

    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    const absZ = Math.abs(delta.z);
    let quantized: BABYLON.Vector3;
    if (absX >= absY && absX >= absZ) {
      quantized = new BABYLON.Vector3(delta.x >= 0 ? 1 : -1, 0, 0);
    } else if (absY >= absX && absY >= absZ) {
      quantized = new BABYLON.Vector3(0, delta.y >= 0 ? 1 : -1, 0);
    } else {
      quantized = new BABYLON.Vector3(0, 0, delta.z >= 0 ? 1 : -1);
    }

    return this.coerceFaceNormalToSide(quantized, fallbackNormal);
  }

  /**
   * Coerce normal to side face (not top/bottom)
   */
  public coerceFaceNormalToSide(
    faceNormal: BABYLON.Vector3,
    fallbackNormal: BABYLON.Vector3,
  ): BABYLON.Vector3 {
    // Code view is only shown on side faces (+/-X, +/-Z), never top/bottom.
    if (Math.abs(faceNormal.y) < 0.5) {
      return faceNormal.clone();
    }

    const absFallbackX = Math.abs(fallbackNormal.x);
    const absFallbackZ = Math.abs(fallbackNormal.z);
    if (absFallbackX >= absFallbackZ) {
      return new BABYLON.Vector3(fallbackNormal.x >= 0 ? 1 : -1, 0, 0);
    }
    return new BABYLON.Vector3(0, 0, fallbackNormal.z >= 0 ? 1 : -1);
  }

  /**
   * Compare two face normals with floating-point tolerance
   */
  public isFaceNormalEqual(a: BABYLON.Vector3 | null, b: BABYLON.Vector3 | null): boolean {
    if (!a || !b) return false;
    const tolerance = 0.1;
    return (
      Math.abs(a.x - b.x) < tolerance &&
      Math.abs(a.y - b.y) < tolerance &&
      Math.abs(a.z - b.z) < tolerance
    );
  }

  /**
   * Get current camera/viewer position
   */
  public getViewerWorldPosition(): BABYLON.Vector3 {
    return this.isInXR()
      ? this.scene.activeCamera?.globalPosition || BABYLON.Vector3.Zero()
      : this.camera.position;
  }

  /**
   * Check if in XR mode
   */
  public isInXR(): boolean {
    return this.scene.activeCamera?.name === 'webxr' || false;
  }

  /**
   * Get animation state
   */
  public getIsAnimating(): boolean {
    return this.isAnimating;
  }

  /**
   * Stop current animation
   */
  public stopAnimation(): void {
    if (this.flyObserver) {
      this.scene.onBeforeRenderObservable.remove(this.flyObserver);
      this.flyObserver = null;
    }
    this.isAnimating = false;
  }
}
