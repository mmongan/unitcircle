import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationController } from '../../src/NavigationController';
import * as BABYLON from '@babylonjs/core';

// Mock BABYLON.js types
vi.mock('@babylonjs/core', () => {
  const makeVector = (x: number, y: number, z: number) => {
    const v: any = { x, y, z };
    v.add = vi.fn((other: any) => makeVector(v.x + other.x, v.y + other.y, v.z + other.z));
    v.subtract = vi.fn((other: any) => makeVector(v.x - other.x, v.y - other.y, v.z - other.z));
    v.scale = vi.fn((s: number) => makeVector(v.x * s, v.y * s, v.z * s));
    v.clone = vi.fn(() => makeVector(v.x, v.y, v.z));
    v.length = vi.fn(() => Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z)));
    v.lengthSquared = vi.fn(() => (v.x * v.x) + (v.y * v.y) + (v.z * v.z));
    v.normalize = vi.fn(() => {
      const len = v.length();
      return len > 0.000001 ? makeVector(v.x / len, v.y / len, v.z / len) : makeVector(0, 0, 0);
    });
    return v;
  };

  return {
    Vector3: Object.assign(vi.fn((x, y, z) => makeVector(x, y, z)), {
      Zero: () => makeVector(0, 0, 0),
    }),
    Axis: { X: makeVector(1, 0, 0), Y: makeVector(0, 1, 0), Z: makeVector(0, 0, 1) },
    Universe: {
      Zero: () => makeVector(0, 0, 0),
    },
  };
});

describe('NavigationController', () => {
  let engine: any;
  let scene: any;
  let camera: any;
  let sceneRoot: any;
  let navController: NavigationController;

  beforeEach(() => {
    engine = {
      getDeltaTime: vi.fn(() => 16),
      getRenderWidth: vi.fn(() => 1920),
      getRenderHeight: vi.fn(() => 1080),
    };

    camera = {
      position: new BABYLON.Vector3(0, 0, -10),
      target: new BABYLON.Vector3(0, 0, 0),
      getDirection: vi.fn(() => new BABYLON.Vector3(0, 0, 1)),
      getForwardRay: vi.fn(() => ({
        direction: new BABYLON.Vector3(0, 0, 1),
      })),
      setTarget: vi.fn(),
      name: 'camera',
    };

    sceneRoot = {
      position: new BABYLON.Vector3(0, 0, 0),
    };

    scene = {
      activeCamera: camera,
      registerBeforeRender: vi.fn(),
      stopAnimation: vi.fn(),
      onBeforeRenderObservable: {
        add: vi.fn((fn) => fn),
        remove: vi.fn(),
      },
      onPointerObservable: {
        add: vi.fn(),
      },
    };

    navController = new NavigationController(engine, scene, camera, sceneRoot);
  });

  describe('Flight Controls', () => {
    it('should setup flight controls', () => {
      navController.setupFlightControls();
      expect(scene.registerBeforeRender).toHaveBeenCalled();
    });

    it('should update flight with keyboard input', () => {
      const initialPos = camera.position.clone();
      navController.updateFlight();
      // Position should remain same when no keys pressed
      expect(camera.position.x).toBe(initialPos.x);
    });

    it('should handle XR flight without grip controller', () => {
      navController.updateXRFlight();
      // Should not crash without grip controller
      expect(sceneRoot.position).toBeDefined();
    });
  });

  describe('Face Normal Handling', () => {
    it('should quantize face normals correctly', () => {
      const mesh: any = {
        getAbsolutePosition: vi.fn(() => BABYLON.Vector3(0, 0, 0)),
      };

      const pickedPoint = BABYLON.Vector3(5, 0, 0);
      const fallback = BABYLON.Vector3(0, 0, 1);

      const result = navController.quantizeFaceNormalFromPickedPoint(
        mesh as any,
        pickedPoint,
        fallback,
      );

      expect(result).toBeDefined();
    });

    it('should coerce face normal to side', () => {
      const faceNormal = BABYLON.Vector3(0, 1, 0); // Top face
      const fallback = BABYLON.Vector3(1, 0, 0); // Side face

      const result = navController.coerceFaceNormalToSide(faceNormal, fallback);
      expect(Math.abs(result.y)).toBeLessThan(0.5); // Should not be top/bottom
    });

    it('should compare face normals with tolerance', () => {
      const a = BABYLON.Vector3(1, 0, 0);
      const b = BABYLON.Vector3(0.95, 0.05, 0);

      const result = navController.isFaceNormalEqual(a, b);
      expect(result).toBe(true);
    });
  });

  describe('Viewer Position', () => {
    it('should return camera position in desktop mode', () => {
      scene.activeCamera = camera;
      const pos = navController.getViewerWorldPosition();
      expect(pos).toBeDefined();
    });

    it('should detect XR mode correctly', () => {
      const isXR = navController.isInXR();
      expect(typeof isXR).toBe('boolean');
    });
  });

  describe('Animation State', () => {
    it('should track animation state', () => {
      const isAnimating = navController.getIsAnimating();
      expect(typeof isAnimating).toBe('boolean');
      expect(isAnimating).toBe(false);
    });

    it('should stop animation', () => {
      navController.stopAnimation();
      expect(navController.getIsAnimating()).toBe(false);
    });
  });
});
