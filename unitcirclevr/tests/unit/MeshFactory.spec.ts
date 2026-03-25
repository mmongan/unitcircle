import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshFactory } from '../../src/MeshFactory';
import { SceneConfig } from '../../src/SceneConfig';
import * as BABYLON from '@babylonjs/core';

vi.mock('@babylonjs/core', () => {
  const makeMesh = () => ({
    isPickable: false,
    parent: null,
    material: null,
    position: { x: 0, y: 0, z: 0 },
    scaling: { x: 1, y: 1, z: 1 },
    billboardMode: 0,
    isVisible: true,
    setEnabled: vi.fn(),
    renderOutline: false,
    getBoundingInfo: vi.fn(() => ({
      boundingBox: {
        maximum: { x: 2, y: 2, z: 2 },
        minimum: { x: -2, y: -2, z: -2 },
      },
      boundingSphere: { radiusWorld: 1.5 },
    })),
    getAbsolutePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    computeWorldMatrix: vi.fn(),
    getChildren: vi.fn(() => []),
  });

  return {
    StandardMaterial: vi.fn(() => ({
      emissiveColor: { r: 0, g: 0, b: 0, clone: vi.fn(() => ({ r: 0, g: 0, b: 0 })) },
      diffuseColor: { r: 1, g: 1, b: 1 },
      specularColor: { r: 0, g: 0, b: 0 },
      specularPower: 0,
      alpha: 1.0,
      transparencyMode: null,
      wireframe: false,
      diffuseTexture: null,
      emissiveTexture: null,
      backFaceCulling: true,
      useAlphaFromDiffuseTexture: false,
      disableLighting: false,
    })),
    Material: { MATERIAL_ALPHABLEND: 2, MATERIAL_OPAQUE: 0 },
    Color3: vi.fn((r: number, g: number, b: number) => ({
      r, g, b,
      clone: vi.fn(() => ({ r, g, b })),
    })),
    MeshBuilder: {
      CreateBox: vi.fn(makeMesh),
      CreateCylinder: vi.fn(makeMesh),
      CreateSphere: vi.fn(makeMesh),
      CreatePlane: vi.fn(makeMesh),
    },
    DynamicTexture: vi.fn(() => ({
      getContext: vi.fn(() => ({
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
      })),
      update: vi.fn(),
      uScale: 1,
      vScale: 1,
      uOffset: 0,
      vOffset: 0,
    })),
    Vector3: Object.assign(
      vi.fn((x: number, y: number, z: number) => {
        const v: any = { x, y, z, add: vi.fn(), subtract: vi.fn() };
        v.clone = vi.fn(() => ({ x: v.x, y: v.y, z: v.z }));
        return v;
      }),
      { Zero: vi.fn(() => ({ x: 0, y: 0, z: 0 })) }
    ),
    ActionManager: Object.assign(
      vi.fn(() => ({ registerAction: vi.fn() })),
      { OnPointerOverTrigger: 0, OnPointerOutTrigger: 1 }
    ),
    ExecuteCodeAction: vi.fn(() => {}),
    Mesh: { BILLBOARDMODE_ALL: 7 },
  };
});

describe('MeshFactory', () => {
  let factory: MeshFactory;
  const mockScene = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new MeshFactory(mockScene);
  });

  describe('createEdges – cylinder diameter', () => {
    it('creates a thinner cylinder for same-file (internal) edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map()
      );

      expect(vi.mocked(BABYLON.MeshBuilder.CreateCylinder)).toHaveBeenCalledWith(
        expect.stringContaining('edge_'),
        expect.objectContaining({ diameter: SceneConfig.INTERNAL_EDGE_RADIUS * 2 }),
        mockScene
      );
    });

    it('creates a standard-width cylinder for cross-file edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map()
      );

      expect(vi.mocked(BABYLON.MeshBuilder.CreateCylinder)).toHaveBeenCalledWith(
        expect.stringContaining('edge_'),
        expect.objectContaining({ diameter: SceneConfig.EDGE_RADIUS * 2 }),
        mockScene
      );
    });

    it('creates a standard-width cylinder for exported-function edges', () => {
      const exportedMap = new Map([['funcB@src/fileB.ts', true]]);
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map(),
        undefined,
        exportedMap
      );

      expect(vi.mocked(BABYLON.MeshBuilder.CreateCylinder)).toHaveBeenCalledWith(
        expect.stringContaining('edge_'),
        expect.objectContaining({ diameter: SceneConfig.EDGE_RADIUS * 2 }),
        mockScene
      );
    });

    it('INTERNAL_EDGE_RADIUS diameter is less than EDGE_RADIUS diameter', () => {
      expect(SceneConfig.INTERNAL_EDGE_RADIUS * 2).toBeLessThan(SceneConfig.EDGE_RADIUS * 2);
    });
  });

  describe('createEdges – material visibility', () => {
    it('same-file edge material has alpha > 0 (visible)', () => {
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map()
      );

      // First StandardMaterial created = sameFileEdgeMaterial
      const sameFileMat = vi.mocked(BABYLON.StandardMaterial).mock.results[0].value;
      expect(sameFileMat.alpha).toBeGreaterThan(0);
    });

    it('same-file edge material alpha is 0.4', () => {
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map()
      );

      const sameFileMat = vi.mocked(BABYLON.StandardMaterial).mock.results[0].value;
      expect(sameFileMat.alpha).toBe(0.4);
    });

    it('cross-file edge material remains hidden (alpha 0)', () => {
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map()
      );

      // Second StandardMaterial created = crossFileEdgeMaterial
      const crossFileMat = vi.mocked(BABYLON.StandardMaterial).mock.results[1].value;
      expect(crossFileMat.alpha).toBe(0);
    });
  });

  describe('createEdges – general behaviour', () => {
    it('creates one cylinder per edge', () => {
      factory.createEdges(
        [
          { from: 'funcA@src/a.ts', to: 'funcB@src/a.ts' },
          { from: 'funcC@src/c.ts', to: 'funcD@src/d.ts' },
        ],
        new Map()
      );

      expect(vi.mocked(BABYLON.MeshBuilder.CreateCylinder)).toHaveBeenCalledTimes(2);
    });

    it('handles an empty edge list without throwing', () => {
      expect(() => factory.createEdges([], new Map())).not.toThrow();
    });
  });
});
