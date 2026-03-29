import { describe, it, expect, vi } from 'vitest';
import { computeDesktopCameraDestination } from '../../src/CameraFlightPlanner';
import type { CameraFlightPlanInput } from '../../src/CameraFlightPlanner';

vi.mock('@babylonjs/core', () => {
  const makeVec = (x: number, y: number, z: number) => {
    const v: any = { x, y, z };
    v.add = vi.fn((o: any) => makeVec(v.x + o.x, v.y + o.y, v.z + o.z));
    v.subtract = vi.fn((o: any) => makeVec(v.x - o.x, v.y - o.y, v.z - o.z));
    v.scale = vi.fn((s: number) => makeVec(v.x * s, v.y * s, v.z * s));
    v.clone = vi.fn(() => makeVec(v.x, v.y, v.z));
    v.length = vi.fn(() => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
    v.lengthSquared = vi.fn(() => v.x * v.x + v.y * v.y + v.z * v.z);
    v.normalize = vi.fn(() => {
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      return len > 0.000001 ? makeVec(v.x / len, v.y / len, v.z / len) : makeVec(0, 0, 1);
    });
    return v;
  };

  return {
    Vector3: Object.assign(vi.fn((x: number, y: number, z: number) => makeVec(x, y, z)), {
      Zero: () => makeVec(0, 0, 0),
    }),
  };
});

import * as BABYLON from '@babylonjs/core';

function vec(x: number, y: number, z: number) {
  return new BABYLON.Vector3(x, y, z);
}

function baseInput(overrides: Partial<CameraFlightPlanInput> = {}): CameraFlightPlanInput {
  return {
    targetWorldPos: vec(0, 0, 0),
    cameraPosition: vec(0, 0, -10),
    cameraTarget: vec(0, 0, 0),
    fallbackFov: 0.8,
    renderWidth: 1920,
    renderHeight: 1080,
    editorWorldWidthScale: 1.75,
    editorWorldHeightScale: 1.08,
    ...overrides,
  };
}

describe('CameraFlightPlanner', () => {
  describe('computeDesktopCameraDestination', () => {
    // ── Label standoff mode ────────────────────────────────────────────────

    describe('labelStandoff mode', () => {
      it('returns a position offset toward the camera from the target', () => {
        const result = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -20),
            labelStandoff: 15,
          }),
        );
        // Camera is at z=-20, target at z=0; toCamera points in -z direction
        // so destination should have negative z
        expect(result.z).toBeLessThan(0);
      });

      it('uses at least the provided labelStandoff distance (clamped to min 8)', () => {
        const result = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -100),
            labelStandoff: 20,
          }),
        );
        // Destination z should be at most 0 and at least -20
        expect(result.z).toBeLessThanOrEqual(0);
        expect(result.z).toBeGreaterThanOrEqual(-21);
      });

      it('clamps to minimum standoff of 8 when labelStandoff < 8', () => {
        const small = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -50),
            labelStandoff: 2, // below minimum of 8
          }),
        );
        const large = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -50),
            labelStandoff: 20,
          }),
        );
        // Both move camera toward target but min=8 constraint applies for small
        expect(Math.abs(small.z)).toBeGreaterThanOrEqual(8);
        expect(Math.abs(large.z)).toBeGreaterThanOrEqual(20);
      });

      it('accounts for label mesh bounding sphere radius', () => {
        const withBigMesh = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -50),
            labelStandoff: 5,
            targetMesh: {
              getBoundingInfo: () => ({
                boundingSphere: { radiusWorld: 30 },
              }),
            } as any,
          }),
        );
        // effectiveLabelStandoff = max(5, 8, (30*1.35)+5) = max(5,8,45.5) = 45.5
        expect(Math.abs(withBigMesh.z)).toBeCloseTo(45.5, 0);
      });
    });

    // ── Face normal mode ───────────────────────────────────────────────────

    describe('faceNormal mode', () => {
      it('offsets the camera along the face normal', () => {
        const result = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            faceNormal: vec(0, 0, -1), // pointing toward the camera
            activeFov: 0.8,
          }),
        );
        // Camera should be positioned in front of the face (negative z)
        expect(result.z).toBeLessThan(0);
      });

      it('uses fallbackFov when activeFov is not provided', () => {
        const withActive = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            faceNormal: vec(0, 0, -1),
            activeFov: 0.8,
          }),
        );
        const withFallback = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            faceNormal: vec(0, 0, -1),
            fallbackFov: 0.8,
          }),
        );
        // Same fov value should yield the same standoff distance
        expect(withActive.z).toBeCloseTo(withFallback.z, 1);
      });

      it('wider FOV produces a closer standoff distance', () => {
        // Use a large mesh so requiredPanelDistance exceeds the 4.0 minimum gap
        // and FOV differences are not masked by the clamp.
        const bigMesh = {
          getBoundingInfo: () => ({ boundingSphere: { radiusWorld: 20 } }),
        } as any;
        const narrow = computeDesktopCameraDestination(
          baseInput({
            faceNormal: vec(0, 0, -1),
            activeFov: 0.45,
            targetMesh: bigMesh,
          }),
        );
        const wide = computeDesktopCameraDestination(
          baseInput({
            faceNormal: vec(0, 0, -1),
            activeFov: 1.2,
            targetMesh: bigMesh,
          }),
        );
        // Wide FOV → smaller required distance to fill viewport
        expect(Math.abs(wide.z)).toBeLessThan(Math.abs(narrow.z));
      });

      it('uses boxSize from mesh userData when available', () => {
        const meshWithBox = {
          boxSize: 30,
          getBoundingInfo: () => ({ boundingSphere: { radiusWorld: 5 } }),
        } as any;
        const result = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            faceNormal: vec(0, 0, -1),
            activeFov: 0.8,
            targetMesh: meshWithBox,
          }),
        );
        expect(result.z).toBeLessThan(0);
      });
    });

    // ── Fallback (default) mode ────────────────────────────────────────────

    describe('fallback mode (no labelStandoff, no faceNormal)', () => {
      it('returns a position offset away from the current camera direction', () => {
        // Camera looking toward +z (cameraTarget - cameraPosition = z+ direction)
        const result = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 10),
            cameraPosition: vec(0, 0, -10),
            cameraTarget: vec(0, 0, 10),
          }),
        );
        // currentDir is +z; result = target - currentDir*standoff → negative z offset from target
        expect(result.z).toBeLessThan(10);
      });

      it('uses mesh bounding sphere radius for standoff', () => {
        const small = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            cameraTarget: vec(0, 0, 0),
            targetMesh: {
              getBoundingInfo: () => ({ boundingSphere: { radiusWorld: 1 } }),
            } as any,
          }),
        );
        const large = computeDesktopCameraDestination(
          baseInput({
            targetWorldPos: vec(0, 0, 0),
            cameraPosition: vec(0, 0, -10),
            cameraTarget: vec(0, 0, 0),
            targetMesh: {
              getBoundingInfo: () => ({ boundingSphere: { radiusWorld: 10 } }),
            } as any,
          }),
        );
        // Larger mesh → further standoff
        expect(Math.abs(large.z)).toBeGreaterThan(Math.abs(small.z));
      });

      it('returns a finite position', () => {
        const result = computeDesktopCameraDestination(baseInput());
        expect(Number.isFinite(result.x)).toBe(true);
        expect(Number.isFinite(result.y)).toBe(true);
        expect(Number.isFinite(result.z)).toBe(true);
      });
    });
  });
});
