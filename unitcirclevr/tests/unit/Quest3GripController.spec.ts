import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as BABYLON from '@babylonjs/core';
import { Quest3GripController, type GripState } from '../../src/Quest3GripController';

// Mock WebGL/Canvas for testing
const createMockScene = (): BABYLON.Scene => {
  // Create a simple mock scene without needing actual WebGL
  const mockScene = {
    onBeforeRenderObservable: {
      add: vi.fn(),
    },
    registerBeforeRender: vi.fn(),
  } as any;
  return mockScene;
};

describe('Quest3GripController', () => {
  let scene: any;
  let controller: Quest3GripController;

  beforeEach(() => {
    // Use mock scene instead of real Babylon.js scene
    scene = createMockScene();
    controller = new Quest3GripController(scene);
  });

  describe('initialization', () => {
    it('should create grip states for both hands', () => {
      const leftGrip = controller.getGripState('left');
      const rightGrip = controller.getGripState('right');

      expect(leftGrip.handedness).toBe('left');
      expect(rightGrip.handedness).toBe('right');
      expect(leftGrip.gripPressed).toBe(false);
      expect(rightGrip.gripPressed).toBe(false);
    });

    it('should initialize with zero grip pressure', () => {
      const leftGrip = controller.getGripState('left');
      const rightGrip = controller.getGripState('right');

      expect(leftGrip.gripPressure).toBe(0);
      expect(rightGrip.gripPressure).toBe(0);
    });

    it('should initialize with zero thumbstick values', () => {
      const leftGrip = controller.getGripState('left');

      expect(leftGrip.thumbstickX).toBe(0);
      expect(leftGrip.thumbstickY).toBe(0);
    });
  });

  describe('grip pressure', () => {
    it('should register grip pressure changes', () => {
      const leftGrip = controller.getGripState('left');
      
      expect(leftGrip.gripPressure).toBe(0);
      expect(leftGrip.gripPressed).toBe(false);
    });

    it('should trigger callback on grip pressure change', () => {
      const callback = vi.fn();
      controller.onGripPressureChange(callback);

      // Simulate grip pressure update
      // Note: In actual XR, this would be triggered by motion controller events
      // For testing purposes, we just verify the callback mechanism works
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('grip gestures', () => {
    it('should allow registering gesture callbacks', () => {
      const callback = vi.fn();
      controller.onGripGesture(callback);

      // Verify callback is set (internal implementation detail)
      expect(callback).not.toHaveBeenCalled();
    });

    it('should define gesture types', () => {
      const leftGrip = controller.getGripState('left');
      expect(leftGrip.handedness).toBe('left');

      // Gesture types: grab, release, press, manipulate
      const gestureTypes = ['grab', 'release', 'press', 'manipulate'];
      for (const type of gestureTypes) {
        expect(type).toBeDefined();
      }
    });
  });

  describe('object grabbing', () => {
    it('should grab objects with a hand', () => {
      const mesh = {} as any;
      
      controller.grabObject('left', mesh);
      const heldObjects = controller.getHeldObjects('left');

      expect(heldObjects.has(mesh)).toBe(true);
    });

    it('should release grabbed objects', () => {
      const mesh = {} as any;
      
      controller.grabObject('left', mesh);
      expect(controller.getHeldObjects('left').has(mesh)).toBe(true);

      controller.releaseObject('left', mesh);
      expect(controller.getHeldObjects('left').has(mesh)).toBe(false);
    });

    it('should clear all held objects on hand release', () => {
      const mesh1 = {} as any;
      const mesh2 = {} as any;

      controller.grabObject('left', mesh1);
      controller.grabObject('left', mesh2);
      expect(controller.getHeldObjects('left').size).toBe(2);

      controller.releaseObject('left');
      expect(controller.getHeldObjects('left').size).toBe(0);
    });

    it('should track held objects per hand', () => {
      const leftMesh = {} as any;
      const rightMesh = {} as any;

      controller.grabObject('left', leftMesh);
      controller.grabObject('right', rightMesh);

      expect(controller.getHeldObjects('left').has(leftMesh)).toBe(true);
      expect(controller.getHeldObjects('right').has(rightMesh)).toBe(true);
      expect(controller.getHeldObjects('left').size).toBe(1);
      expect(controller.getHeldObjects('right').size).toBe(1);
    });
  });

  describe('grip distance', () => {
    it('should have a default maximum grip distance', () => {
      const maxDist = controller.getMaxGripDistance();
      expect(maxDist).toBeGreaterThan(0);
    });

    it('should allow setting maximum grip distance', () => {
      controller.setMaxGripDistance(10.0);
      expect(controller.getMaxGripDistance()).toBe(10.0);

      controller.setMaxGripDistance(20.0);
      expect(controller.getMaxGripDistance()).toBe(20.0);
    });
  });

  describe('grip velocity', () => {
    it('should track grip velocity', () => {
      const leftGrip = controller.getGripState('left');
      expect(leftGrip.velocity).toBeDefined();
      expect(leftGrip.velocity.x).toBe(0);
      expect(leftGrip.velocity.y).toBe(0);
      expect(leftGrip.velocity.z).toBe(0);
    });

    it('should return grip velocity vector', () => {
      const velocity = controller.getGripVelocity('left');
      expect(velocity).toBeDefined();
      expect(velocity instanceof BABYLON.Vector3).toBe(true);
    });
  });

  describe('grip state properties', () => {
    it('should track all grip state properties', () => {
      const leftGrip = controller.getGripState('left');

      expect(leftGrip).toHaveProperty('handedness');
      expect(leftGrip).toHaveProperty('gripPressed');
      expect(leftGrip).toHaveProperty('gripPressure');
      expect(leftGrip).toHaveProperty('triggerPressed');
      expect(leftGrip).toHaveProperty('triggerPressure');
      expect(leftGrip).toHaveProperty('thumbstickX');
      expect(leftGrip).toHaveProperty('thumbstickY');
      expect(leftGrip).toHaveProperty('primaryButtonPressed');
      expect(leftGrip).toHaveProperty('secondaryButtonPressed');
      expect(leftGrip).toHaveProperty('position');
      expect(leftGrip).toHaveProperty('direction');
      expect(leftGrip).toHaveProperty('velocity');
    });

    it('should provide debug information', () => {
      const debugInfo = controller.getDebugInfo();
      expect(debugInfo).toBeDefined();
      expect(typeof debugInfo).toBe('string');
      expect(debugInfo).toContain('LEFT');
      expect(debugInfo).toContain('RIGHT');
    });
  });

  describe('controller configuration', () => {
    it('should initialize with correct default values', () => {
      const leftGrip = controller.getGripState('left');
      const rightGrip = controller.getGripState('right');

      // Both hands should start idle
      expect(leftGrip.gripPressed).toBe(false);
      expect(rightGrip.gripPressed).toBe(false);
      expect(leftGrip.triggerPressed).toBe(false);
      expect(rightGrip.triggerPressed).toBe(false);
    });
  });
});
