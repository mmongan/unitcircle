/**
 * Quest 3 Grip Controller - Handles hand grips, pressure, and gestures
 */
import * as BABYLON from '@babylonjs/core';

export interface GripState {
  handedness: 'left' | 'right';
  gripPressed: boolean;
  gripPressure: number; // 0-1
  triggerPressed: boolean;
  triggerPressure: number; // 0-1
  thumbstickX: number;
  thumbstickY: number;
  primaryButtonPressed: boolean;
  secondaryButtonPressed: boolean;
  position: BABYLON.Vector3;
  direction: BABYLON.Vector3;
  velocity: BABYLON.Vector3; // For grip velocity calculations
}

export interface GripGesture {
  type: 'grab' | 'release' | 'press' | 'manipulate';
  hand: 'left' | 'right';
  intensity: number; // 0-1
  heldObject?: BABYLON.Mesh;
}

export class Quest3GripController {
  private scene: BABYLON.Scene;
  private leftGripState: GripState;
  private rightGripState: GripState;
  private previousLeftGripPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private previousRightGripPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private heldObjectsLeft: Set<BABYLON.Mesh> = new Set();
  private heldObjectsRight: Set<BABYLON.Mesh> = new Set();
  private maxGripDistance = 5.0; // Maximum distance to grab objects
  private onGripGestureCallback: ((gesture: GripGesture) => void) | null = null;
  private onGripPressureChangeCallback: ((hand: 'left' | 'right', pressure: number) => void) | null = null;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.leftGripState = this.createEmptyGripState('left');
    this.rightGripState = this.createEmptyGripState('right');
  }

  /**
   * Initialize Quest 3 grip tracking from WebXR input
   */
  public initializeFromXRInput(xrInput: BABYLON.WebXRInput): void {
    xrInput.onControllerAddedObservable.add((controller) => {
      controller.onMotionControllerInitObservable.add((motionController) => {
        const handedness = controller.inputSource.handedness as 'left' | 'right';
        console.log(`Quest 3 ${handedness} controller initialized`);

        // Setup squeeze/grip button
        const squeezeComponent = motionController.getComponent('xr-standard-squeeze');
        if (squeezeComponent) {
          squeezeComponent.onButtonStateChangedObservable.add(() => {
            this.updateGripState(handedness, squeezeComponent);
          });
        }

        // Setup trigger button
        const triggerComponent = motionController.getComponent('xr-standard-trigger');
        if (triggerComponent) {
          triggerComponent.onButtonStateChangedObservable.add(() => {
            this.updateTriggerState(handedness, triggerComponent);
          });
        }

        // Setup primary button (X/A)
        const primaryComponent = motionController.getComponent('xr-standard-primary');
        if (primaryComponent) {
          primaryComponent.onButtonStateChangedObservable.add(() => {
            const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
            gripState.primaryButtonPressed = primaryComponent.pressed;
          });
        }

        // Setup secondary button (Y/B)
        const secondaryComponent = motionController.getComponent('xr-standard-secondary');
        if (secondaryComponent) {
          secondaryComponent.onButtonStateChangedObservable.add(() => {
            const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
            gripState.secondaryButtonPressed = secondaryComponent.pressed;
          });
        }

        // Setup thumbstick
        const thumbstickComponent = motionController.getComponent('xr-standard-thumbstick');
        if (thumbstickComponent) {
          thumbstickComponent.onAxisValueChangedObservable.add((value) => {
            const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
            gripState.thumbstickX = value.x ?? 0;
            gripState.thumbstickY = value.y ?? 0;
          });
        }
      });

      // Update position and direction every frame
      this.scene.onBeforeRenderObservable.add(() => {
        this.updateGripPositions(controller);
      });
    });
  }

  /**
   * Update grip state from squeeze component
   */
  private updateGripState(
    handedness: 'left' | 'right',
    component: BABYLON.WebXRControllerComponent
  ): void {
    const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
    const wasPressed = gripState.gripPressed;
    
    gripState.gripPressed = component.pressed;
    gripState.gripPressure = component.value ?? (component.pressed ? 1 : 0);

    // Emit gesture on state change
    if (gripState.gripPressed && !wasPressed) {
      this.emitGripGesture({
        type: 'grab',
        hand: handedness,
        intensity: gripState.gripPressure,
      });
    } else if (!gripState.gripPressed && wasPressed) {
      this.emitGripGesture({
        type: 'release',
        hand: handedness,
        intensity: 0,
      });
    }

    // Notify pressure change
    if (this.onGripPressureChangeCallback) {
      this.onGripPressureChangeCallback(handedness, gripState.gripPressure);
    }
  }

  /**
   * Update trigger state from trigger component
   */
  private updateTriggerState(
    handedness: 'left' | 'right',
    component: BABYLON.WebXRControllerComponent
  ): void {
    const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
    gripState.triggerPressed = component.pressed;
    gripState.triggerPressure = component.value ?? (component.pressed ? 1 : 0);
  }

  /**
   * Update grip positions and velocities each frame
   */
  private updateGripPositions(controller: BABYLON.WebXRInputSource): void {
    const handedness = controller.inputSource.handedness as 'left' | 'right';
    const gripState = handedness === 'left' ? this.leftGripState : this.rightGripState;
    const previousPosition = handedness === 'left' ? this.previousLeftGripPosition : this.previousRightGripPosition;

    if (controller.pointer) {
      const newPosition = controller.pointer.position.clone();
      
      // Calculate velocity
      gripState.velocity = newPosition.subtract(previousPosition).scale(60); // Assuming 60 FPS
      gripState.position = newPosition;
      gripState.direction = BABYLON.Vector3.Normalize(
        controller.pointer.getDirection(BABYLON.Axis.Z)
      );

      // Update previous position for next frame
      if (handedness === 'left') {
        this.previousLeftGripPosition = newPosition;
      } else {
        this.previousRightGripPosition = newPosition;
      }
    }
  }

  /**
   * Emit grip gesture callback
   */
  private emitGripGesture(gesture: GripGesture): void {
    console.log(`Grip Gesture - ${gesture.hand}: ${gesture.type} (intensity: ${gesture.intensity})`);
    if (this.onGripGestureCallback) {
      this.onGripGestureCallback(gesture);
    }
  }

  /**
   * Get grip state for hand
   */
  public getGripState(hand: 'left' | 'right'): GripState {
    return hand === 'left' ? this.leftGripState : this.rightGripState;
  }

  /**
   * Register callback for grip gestures
   */
  public onGripGesture(callback: (gesture: GripGesture) => void): void {
    this.onGripGestureCallback = callback;
  }

  /**
   * Register callback for grip pressure changes
   */
  public onGripPressureChange(callback: (hand: 'left' | 'right', pressure: number) => void): void {
    this.onGripPressureChangeCallback = callback;
  }

  /**
   * Grab an object with a hand
   */
  public grabObject(hand: 'left' | 'right', mesh: BABYLON.Mesh): void {
    const heldObjects = hand === 'left' ? this.heldObjectsLeft : this.heldObjectsRight;
    heldObjects.add(mesh);
    console.log(`Object grabbed by ${hand} hand`);
  }

  /**
   * Release an object
   */
  public releaseObject(hand: 'left' | 'right', mesh?: BABYLON.Mesh): void {
    const heldObjects = hand === 'left' ? this.heldObjectsLeft : this.heldObjectsRight;
    if (mesh) {
      heldObjects.delete(mesh);
    } else {
      heldObjects.clear();
    }
    console.log(`Object released by ${hand} hand`);
  }

  /**
   * Get objects held by hand
   */
  public getHeldObjects(hand: 'left' | 'right'): Set<BABYLON.Mesh> {
    return hand === 'left' ? this.heldObjectsLeft : this.heldObjectsRight;
  }

  /**
   * Set maximum grab distance
   */
  public setMaxGripDistance(distance: number): void {
    this.maxGripDistance = distance;
  }

  /**
   * Get maximum grab distance
   */
  public getMaxGripDistance(): number {
    return this.maxGripDistance;
  }

  /**
   * Get grip velocity (useful for physics calculations)
   */
  public getGripVelocity(hand: 'left' | 'right'): BABYLON.Vector3 {
    const gripState = hand === 'left' ? this.leftGripState : this.rightGripState;
    return gripState.velocity;
  }

  /**
   * Create empty grip state
   */
  private createEmptyGripState(handedness: 'left' | 'right'): GripState {
    return {
      handedness,
      gripPressed: false,
      gripPressure: 0,
      triggerPressed: false,
      triggerPressure: 0,
      thumbstickX: 0,
      thumbstickY: 0,
      primaryButtonPressed: false,
      secondaryButtonPressed: false,
      position: BABYLON.Vector3.Zero(),
      direction: BABYLON.Axis.Z.negate(),
      velocity: BABYLON.Vector3.Zero(),
    };
  }

  /**
   * Get debug info for UI
   */
  public getDebugInfo(): string {
    const left = this.leftGripState;
    const right = this.rightGripState;
    return `
      LEFT: grip=${left.gripPressure.toFixed(2)} trigger=${left.triggerPressure.toFixed(2)} thumb=(${left.thumbstickX.toFixed(2)},${left.thumbstickY.toFixed(2)})
      RIGHT: grip=${right.gripPressure.toFixed(2)} trigger=${right.triggerPressure.toFixed(2)} thumb=(${right.thumbstickX.toFixed(2)},${right.thumbstickY.toFixed(2)})
    `;
  }
}
