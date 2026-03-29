import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshFactory } from '../../src/MeshFactory';
import { SceneConfig } from '../../src/SceneConfig';
import * as BABYLON from '@babylonjs/core';

vi.mock('@babylonjs/core', () => {
  const makeVector = (x: number, y: number, z: number) => {
    const v: any = { x, y, z };
    v.add = vi.fn((other: any) => makeVector(v.x + other.x, v.y + other.y, v.z + other.z));
    v.subtract = vi.fn((other: any) => makeVector(v.x - other.x, v.y - other.y, v.z - other.z));
    v.scale = vi.fn((s: number) => makeVector(v.x * s, v.y * s, v.z * s));
    v.clone = vi.fn(() => makeVector(v.x, v.y, v.z));
    v.length = vi.fn(() => Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z)));
    v.normalize = vi.fn(() => {
      const len = v.length();
      return len > 0.000001 ? makeVector(v.x / len, v.y / len, v.z / len) : makeVector(0, 0, 0);
    });
    return v;
  };

  const makeMesh = () => ({
    isPickable: false,
    parent: null,
    material: null,
    position: makeVector(0, 0, 0),
    scaling: makeVector(1, 1, 1),
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
    getAbsolutePosition: vi.fn(() => makeVector(0, 0, 0)),
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
    Color4: vi.fn((r: number, g: number, b: number, a: number) => ({
      r, g, b, a,
      clone: vi.fn(() => ({ r, g, b, a })),
    })),
    MeshBuilder: {
      CreateBox: vi.fn(makeMesh),
      CreateCylinder: vi.fn(makeMesh),
      CreateTube: vi.fn(makeMesh),
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
        return makeVector(x, y, z);
      }),
      { Zero: vi.fn(() => makeVector(0, 0, 0)) }
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

  const getEdgeCylinderCall = () =>
    vi.mocked(BABYLON.MeshBuilder.CreateCylinder).mock.calls.find(
      (call) => String(call[0]).startsWith('edge_')
    );

  const getArrowCylinderCalls = () =>
    vi.mocked(BABYLON.MeshBuilder.CreateCylinder).mock.calls.filter(
      (call) => String(call[0]).startsWith('arrow_')
    );

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

      const edgeCall = getEdgeCylinderCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ diameter: SceneConfig.INTERNAL_EDGE_RADIUS * 2 }));
    });

    it('creates a standard-width cylinder for cross-file edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map()
      );

      const edgeCall = getEdgeCylinderCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ diameter: SceneConfig.EDGE_RADIUS * 2 }));
    });

    it('creates a medium-width same-file cylinder for exported-function edges', () => {
      const exportedMap = new Map([['funcB@src/file.ts', true]]);
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map(),
        undefined,
        exportedMap
      );

      const edgeCall = getEdgeCylinderCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ diameter: SceneConfig.INTERNAL_EDGE_RADIUS * 4 }));
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

    it('same-file edge material alpha is 0.9', () => {
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map()
      );

      const sameFileMat = vi.mocked(BABYLON.StandardMaterial).mock.results[0].value;
      expect(sameFileMat.alpha).toBe(0.9);
    });

    it('cross-file edge material remains fully visible (alpha 1)', () => {
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map()
      );

      const crossFileMat = vi.mocked(BABYLON.StandardMaterial).mock.results[0].value;
      expect(crossFileMat.alpha).toBe(1.0);
    });
  });

  describe('createEdges – general behaviour', () => {
    it('creates one edge-cylinder and one arrow-cylinder per non-self edge', () => {
      factory.createEdges(
        [
          { from: 'funcA@src/a.ts', to: 'funcB@src/a.ts' },
          { from: 'funcC@src/c.ts', to: 'funcD@src/d.ts' },
        ],
        new Map()
      );

      const edgeCylinders = vi.mocked(BABYLON.MeshBuilder.CreateCylinder).mock.calls.filter(
        (call) => String(call[0]).startsWith('edge_')
      );
      const arrowCylinders = getArrowCylinderCalls();
      expect(edgeCylinders).toHaveLength(2);
      expect(arrowCylinders).toHaveLength(2);
    });

    it('handles an empty edge list without throwing', () => {
      expect(() => factory.createEdges([], new Map())).not.toThrow();
    });

    it('creates a tube edge for self-loops and still creates an arrow', () => {
      factory.createEdges(
        [{ from: 'recursive@src/r.ts', to: 'recursive@src/r.ts' }],
        new Map()
      );

      const tubeCalls = vi.mocked(BABYLON.MeshBuilder.CreateTube).mock.calls.filter(
        (call) => String(call[0]).startsWith('edge_')
      );
      const edgeCylinders = vi.mocked(BABYLON.MeshBuilder.CreateCylinder).mock.calls.filter(
        (call) => String(call[0]).startsWith('edge_')
      );
      const arrowCylinders = getArrowCylinderCalls();

      expect(tubeCalls).toHaveLength(1);
      expect(edgeCylinders).toHaveLength(0);
      expect(arrowCylinders).toHaveLength(1);

      const metadata = (factory as any).edgeMetadata as Map<string, any>;
      const entry = Array.from(metadata.values())[0];
      expect(entry.isSelfLoop).toBe(true);
    });

    it('assigns opposite lateral offset signs for bidirectional edges', () => {
      factory.createEdges(
        [
          { from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' },
          { from: 'funcB@src/b.ts', to: 'funcA@src/a.ts' },
        ],
        new Map()
      );

      const metadata = Array.from(((factory as any).edgeMetadata as Map<string, any>).values());
      const ab = metadata.find((m) => m.from === 'funcA@src/a.ts' && m.to === 'funcB@src/b.ts');
      const ba = metadata.find((m) => m.from === 'funcB@src/b.ts' && m.to === 'funcA@src/a.ts');

      expect(ab).toBeDefined();
      expect(ba).toBeDefined();
      expect(ab.bidirectionalOffsetSign).toBe(1);
      expect(ba.bidirectionalOffsetSign).toBe(-1);
    });

    it('keeps lateral offset sign at zero for single-direction edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const metadata = Array.from(((factory as any).edgeMetadata as Map<string, any>).values());
      expect(metadata[0].bidirectionalOffsetSign).toBe(0);
    });
  });

  describe('same-file edge visibility gating', () => {
    it('hides same-file edges when the viewer is outside the shared file box', () => {
      const factoryWithCamera = new MeshFactory({
        activeCamera: {
          position: { x: 40, y: 0, z: 0, clone: vi.fn(() => ({ x: 40, y: 0, z: 0 })) },
        },
      } as any);

      const sharedFileBox = {
        getBoundingInfo: vi.fn(() => ({
          boundingBox: {
            intersectsPoint: vi.fn(() => false),
          },
        })),
      } as any;

      const sourceMesh = { parent: sharedFileBox } as any;
      const targetMesh = { parent: sharedFileBox } as any;

      const visible = (factoryWithCamera as any).shouldRenderEdge(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visible).toBe(false);
    });

    it('shows same-file edges when the viewer is inside the shared file box', () => {
      const factoryWithCamera = new MeshFactory({
        activeCamera: {
          position: { x: 0, y: 0, z: 0, clone: vi.fn(() => ({ x: 0, y: 0, z: 0 })) },
        },
      } as any);

      const sharedFileBox = {
        getBoundingInfo: vi.fn(() => ({
          boundingBox: {
            intersectsPoint: vi.fn(() => true),
          },
        })),
      } as any;

      const sourceMesh = { parent: sharedFileBox } as any;
      const targetMesh = { parent: sharedFileBox } as any;

      const visible = (factoryWithCamera as any).shouldRenderEdge(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visible).toBe(true);
    });

    it('refreshes the shared file box world matrix before checking containment', () => {
      const factoryWithCamera = new MeshFactory({
        activeCamera: {
          position: { x: 0, y: 0, z: 0, clone: vi.fn(() => ({ x: 0, y: 0, z: 0 })) },
        },
      } as any);

      const sharedFileBox = {
        computeWorldMatrix: vi.fn(),
        getBoundingInfo: vi.fn(() => ({
          boundingBox: {
            intersectsPoint: vi.fn(() => true),
          },
        })),
      } as any;

      const visible = (factoryWithCamera as any).shouldRenderEdge(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        { parent: sharedFileBox } as any,
        { parent: sharedFileBox } as any,
      );

      expect(visible).toBe(true);
      expect(sharedFileBox.computeWorldMatrix).toHaveBeenCalledWith(true);
    });

    it('falls back to world min/max bounds when intersectsPoint is unavailable', () => {
      const factoryWithCamera = new MeshFactory({
        activeCamera: {
          position: { x: 1, y: 1, z: 1, clone: vi.fn(() => ({ x: 1, y: 1, z: 1 })) },
        },
      } as any);

      const sharedFileBox = {
        computeWorldMatrix: vi.fn(),
        getBoundingInfo: vi.fn(() => ({
          boundingBox: {
            minimumWorld: { x: -2, y: -2, z: -2 },
            maximumWorld: { x: 2, y: 2, z: 2 },
          },
        })),
      } as any;

      const visible = (factoryWithCamera as any).shouldRenderEdge(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        { parent: sharedFileBox } as any,
        { parent: sharedFileBox } as any,
      );

      expect(visible).toBe(true);
    });

    it('keeps cross-file edges visible even when the viewer is outside a file box', () => {
      const factoryWithCamera = new MeshFactory({
        activeCamera: {
          position: { x: 40, y: 0, z: 0, clone: vi.fn(() => ({ x: 40, y: 0, z: 0 })) },
        },
      } as any);

      const sharedFileBox = {
        getBoundingInfo: vi.fn(() => ({
          boundingBox: {
            intersectsPoint: vi.fn(() => false),
          },
        })),
      } as any;

      const sourceMesh = { parent: sharedFileBox } as any;
      const targetMesh = { parent: sharedFileBox } as any;

      const visible = (factoryWithCamera as any).shouldRenderEdge(
        { from: 'a', to: 'b', isCrossFile: true, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visible).toBe(true);
    });

    it('re-enables a previously hidden non-self edge when it becomes visible again', () => {
      const cylinder = {
        isEnabled: vi.fn(() => false),
        setEnabled: vi.fn(),
      } as any;

      (factory as any).ensureMeshEnabled(cylinder);

      expect(cylinder.setEnabled).toHaveBeenCalledWith(true);
    });

    it('hides unrelated cross-file edges when a focus file is active', () => {
      (factory as any).setDeclutterContext('src/main.ts', ['src']);

      const visible = (factory as any).shouldRenderCrossFileEdge({
        fromFile: 'scripts/build-graph.ts',
        toFile: 'viewer.html',
        targetsExternalLibrary: false,
      });

      expect(visible).toBe(false);
    });

    it('keeps cross-file edges visible when they connect to the focus file', () => {
      (factory as any).setDeclutterContext('src/main.ts', ['src']);

      const visible = (factory as any).shouldRenderCrossFileEdge({
        fromFile: 'src/main.ts',
        toFile: 'src/VRSceneManager.ts',
        targetsExternalLibrary: false,
      });

      expect(visible).toBe(true);
    });
  });
});
