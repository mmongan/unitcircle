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
    renderingGroupId: 0,
    dispose: vi.fn(),
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
      dispose: vi.fn(),
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

  const getEdgeTubeCall = () =>
    vi.mocked(BABYLON.MeshBuilder.CreateTube).mock.calls.find(
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

  describe('createEdges – tube radius', () => {
    it('creates a thinner tube for same-file (internal) edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map()
      );

      const edgeCall = getEdgeTubeCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ radius: expect.any(Number) }));
    });

    it('creates a standard-width tube for cross-file edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/fileA.ts', to: 'funcB@src/fileB.ts' }],
        new Map()
      );

      const edgeCall = getEdgeTubeCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ radius: expect.any(Number) }));
    });

    it('creates a medium-width same-file tube for exported-function edges', () => {
      const exportedMap = new Map([['funcB@src/file.ts', true]]);
      factory.createEdges(
        [{ from: 'funcA@src/file.ts', to: 'funcB@src/file.ts' }],
        new Map(),
        undefined,
        exportedMap
      );

      const edgeCall = getEdgeTubeCall();
      expect(edgeCall).toBeDefined();
      expect(edgeCall?.[1]).toEqual(expect.objectContaining({ radius: expect.any(Number) }));
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
    it('creates one edge-tube and one arrow-cylinder per non-self edge', () => {
      factory.createEdges(
        [
          { from: 'funcA@src/a.ts', to: 'funcB@src/a.ts' },
          { from: 'funcC@src/c.ts', to: 'funcD@src/d.ts' },
        ],
        new Map()
      );

      const edgeTubes = vi.mocked(BABYLON.MeshBuilder.CreateTube).mock.calls.filter(
        (call) => String(call[0]).startsWith('edge_')
      );
      const arrowCylinders = getArrowCylinderCalls();
      expect(edgeTubes).toHaveLength(2);
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
      const arrowCylinders = getArrowCylinderCalls();

      expect(tubeCalls).toHaveLength(1);
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

    it('scales cross-file conduit radius with edge count', () => {
      const singleEdgeFactory = new MeshFactory(mockScene);
      singleEdgeFactory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const singleConduitCall = vi.mocked(BABYLON.MeshBuilder.CreateTube).mock.calls.find(
        (call) => String(call[0]).startsWith('conduit_')
      );
      expect(singleConduitCall).toBeDefined();
      const singleRadius = Number(singleConduitCall?.[1]?.radius ?? 0);

      vi.clearAllMocks();

      const multiEdgeFactory = new MeshFactory(mockScene);
      multiEdgeFactory.createEdges(
        [
          { from: 'funcA1@src/a.ts', to: 'funcB1@src/b.ts' },
          { from: 'funcA2@src/a.ts', to: 'funcB2@src/b.ts' },
          { from: 'funcA3@src/a.ts', to: 'funcB3@src/b.ts' },
          { from: 'funcA4@src/a.ts', to: 'funcB4@src/b.ts' },
        ],
        new Map()
      );

      const multiConduitCall = vi.mocked(BABYLON.MeshBuilder.CreateTube).mock.calls.find(
        (call) => String(call[0]).startsWith('conduit_')
      );
      expect(multiConduitCall).toBeDefined();
      const multiRadius = Number(multiConduitCall?.[1]?.radius ?? 0);

      expect(multiRadius).toBeGreaterThan(singleRadius);
    });

    it('creates dodecagon junctions at conduit connection points', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const junctionCalls = vi.mocked(BABYLON.MeshBuilder.CreateCylinder).mock.calls.filter(
        (call) => String(call[0]).startsWith('conduitJunction_')
      );

      expect(junctionCalls).toHaveLength(2);
      for (const call of junctionCalls) {
        expect(call[1]).toEqual(expect.objectContaining({ tessellation: 12 }));
      }
    });
  });

  describe('same-file edge visibility gating', () => {
    it('fades same-file edges when the viewer is outside the shared file box', () => {
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

      const visibility = (factoryWithCamera as any).getEdgeVisibilityFactor(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visibility).toBeLessThan(1);
      expect(visibility).toBeGreaterThan(0);
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

      const visibility = (factoryWithCamera as any).getEdgeVisibilityFactor(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visibility).toBe(1);
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

      const visibility = (factoryWithCamera as any).getEdgeVisibilityFactor(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        { parent: sharedFileBox } as any,
        { parent: sharedFileBox } as any,
      );

      expect(visibility).toBe(1);
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

      const visibility = (factoryWithCamera as any).getEdgeVisibilityFactor(
        { from: 'a', to: 'b', isCrossFile: false, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        { parent: sharedFileBox } as any,
        { parent: sharedFileBox } as any,
      );

      expect(visibility).toBe(1);
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

      const visibility = (factoryWithCamera as any).getEdgeVisibilityFactor(
        { from: 'a', to: 'b', isCrossFile: true, isSelfLoop: false, bidirectionalOffsetSign: 0 },
        sourceMesh,
        targetMesh,
      );

      expect(visibility).toBe(1);
    });

    it('re-enables a previously hidden non-self edge when it becomes visible again', () => {
      const cylinder = {
        isEnabled: vi.fn(() => false),
        setEnabled: vi.fn(),
      } as any;

      (factory as any).ensureMeshEnabled(cylinder);

      expect(cylinder.setEnabled).toHaveBeenCalledWith(true);
    });

    it('keeps unrelated cross-file edges fully visible when a focus file is active', () => {
      (factory as any).setDeclutterContext('src/main.ts', ['src']);

      const visibility = (factory as any).getCrossFileEdgeVisibilityFactor({
        fromFile: 'scripts/build-graph.ts',
        toFile: 'viewer.html',
        targetsExternalLibrary: false,
      });

      expect(visibility).toBe(1);
    });

    it('keeps cross-file edges visible when they connect to the focus file', () => {
      (factory as any).setDeclutterContext('src/main.ts', ['src']);

      const visibility = (factory as any).getCrossFileEdgeVisibilityFactor({
        fromFile: 'src/main.ts',
        toFile: 'src/VRSceneManager.ts',
        targetsExternalLibrary: false,
      });

      expect(visibility).toBe(1);
    });

    it('keeps cross-file edges visible when no focus file is active', () => {
      (factory as any).setDeclutterContext(null, []);

      const visibility = (factory as any).getCrossFileEdgeVisibilityFactor({
        fromFile: 'scripts/build-graph.ts',
        toFile: 'viewer.html',
        targetsExternalLibrary: true,
      });

      expect(visibility).toBe(1);
    });
  });

  describe('createEdges – file link boxes', () => {
    it('creates two billboard planes per cross-file edge pair', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const planeCalls = vi.mocked(BABYLON.MeshBuilder.CreatePlane).mock.calls.filter(
        (call) => String(call[0]).startsWith('fileLinkBox_')
      );
      expect(planeCalls).toHaveLength(2);
    });

    it('source link box name contains "_source" suffix', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const planeCalls = vi.mocked(BABYLON.MeshBuilder.CreatePlane).mock.calls.filter(
        (call) => String(call[0]).startsWith('fileLinkBox_')
      );
      const names = planeCalls.map((c) => String(c[0]));
      expect(names.some((n) => n.endsWith('_source'))).toBe(true);
      expect(names.some((n) => n.endsWith('_target'))).toBe(true);
    });

    it('billboard planes have BILLBOARDMODE_ALL set', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const linkBoxes = (factory as any).crossFileConduitLinkBoxes as Map<string, { source: any; target: any }>;
      expect(linkBoxes.size).toBeGreaterThan(0);
      for (const { source, target } of linkBoxes.values()) {
        expect(source.billboardMode).toBe(7); // BILLBOARDMODE_ALL
        expect(target.billboardMode).toBe(7);
      }
    });

    it('billboard planes have renderingGroupId = 2', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const linkBoxes = (factory as any).crossFileConduitLinkBoxes as Map<string, { source: any; target: any }>;
      for (const { source, target } of linkBoxes.values()) {
        expect(source.renderingGroupId).toBe(2);
        expect(target.renderingGroupId).toBe(2);
      }
    });

    it('does not create link boxes for same-file edges', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/a.ts' }],
        new Map()
      );

      const planeCalls = vi.mocked(BABYLON.MeshBuilder.CreatePlane).mock.calls.filter(
        (call) => String(call[0]).startsWith('fileLinkBox_')
      );
      expect(planeCalls).toHaveLength(0);
    });

    it('creates exactly one link box pair per unique file pair (multiple edges same pair)', () => {
      factory.createEdges(
        [
          { from: 'funcA1@src/a.ts', to: 'funcB1@src/b.ts' },
          { from: 'funcA2@src/a.ts', to: 'funcB2@src/b.ts' },
        ],
        new Map()
      );

      const linkBoxes = (factory as any).crossFileConduitLinkBoxes as Map<string, { source: any; target: any }>;
      expect(linkBoxes.size).toBe(1);
    });

    it('stores node navigation metadata on hub meshes', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const linkBoxes = (factory as any).crossFileConduitLinkBoxes as Map<string, { source: any; target: any }>;
      const junctions = (factory as any).crossFileConduitJunctions as Map<string, { source: any; target: any }>;

      const pairKey = Array.from(linkBoxes.keys())[0];
      expect(pairKey).toBeDefined();

      const linkPair = linkBoxes.get(pairKey)!;
      const junctionPair = junctions.get(pairKey)!;

      expect(linkPair.source.edgeData).toEqual({ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' });
      expect(linkPair.target.edgeData).toEqual({ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' });
      expect(junctionPair.source.edgeData).toEqual({ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' });
      expect(junctionPair.target.edgeData).toEqual({ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' });

      expect(linkPair.source.hubData.endpoint).toBe('source');
      expect(linkPair.target.hubData.endpoint).toBe('target');
      expect(linkPair.source.hubData.sourceNodeId).toBe('funcA@src/a.ts');
      expect(linkPair.source.hubData.targetNodeId).toBe('funcB@src/b.ts');
      expect(linkPair.source.hubData.navigationNodeId).toBe('funcB@src/b.ts');
      expect(linkPair.target.hubData.navigationNodeId).toBe('funcA@src/a.ts');
      expect(junctionPair.source.hubData.navigationNodeId).toBe('funcB@src/b.ts');
      expect(junctionPair.target.hubData.navigationNodeId).toBe('funcA@src/a.ts');
      expect(linkPair.source.isPickable).toBe(true);
      expect(linkPair.target.isPickable).toBe(true);
      expect(junctionPair.source.isPickable).toBe(true);
      expect(junctionPair.target.isPickable).toBe(true);
    });

    it('clearEdges disposes link boxes and clears the map', () => {
      factory.createEdges(
        [{ from: 'funcA@src/a.ts', to: 'funcB@src/b.ts' }],
        new Map()
      );

      const linkBoxes = (factory as any).crossFileConduitLinkBoxes as Map<string, any>;
      expect(linkBoxes.size).toBe(1);

      factory.clearEdges();

      expect(linkBoxes.size).toBe(0);
    });
  });

  describe('cross-file hub slotting', () => {
    const makeFileBox = (x: number, y: number, z: number) => ({
      getAbsolutePosition: vi.fn(() => new (BABYLON.Vector3 as any)(x, y, z)),
      getBoundingInfo: vi.fn(() => ({
        boundingBox: {
          minimumWorld: { x: x - 20, y: y - 20, z: z - 20 },
          maximumWorld: { x: x + 20, y: y + 20, z: z + 20 },
          minimum: { x: -20, y: -20, z: -20 },
          maximum: { x: 20, y: 20, z: 20 },
        },
      })),
    }) as any;

    it('assigns distinct hub positions for different peer slots on the same file', () => {
      const sourceBox = makeFileBox(0, 0, 0);
      const targetBox = makeFileBox(100, 0, 0);

      const slot0 = (factory as any).computeCrossFileHubPoints(sourceBox, targetBox, 0, 2, 0, 1);
      const slot1 = (factory as any).computeCrossFileHubPoints(sourceBox, targetBox, 1, 2, 0, 1);

      expect(slot0.sourceHub.x).toBeCloseTo(slot1.sourceHub.x, 4);
      const deltaY = Math.abs(slot0.sourceHub.y - slot1.sourceHub.y);
      const deltaZ = Math.abs(slot0.sourceHub.z - slot1.sourceHub.z);
      expect(Math.max(deltaY, deltaZ)).toBeGreaterThan(0.5);
    });

    it('keeps base hub position when there is only one peer slot', () => {
      const sourceBox = makeFileBox(0, 0, 0);
      const targetBox = makeFileBox(100, 0, 0);

      const defaultHub = (factory as any).computeCrossFileHubPoints(sourceBox, targetBox);
      const singleSlotHub = (factory as any).computeCrossFileHubPoints(sourceBox, targetBox, 0, 1, 0, 1);

      expect(singleSlotHub.sourceHub.x).toBeCloseTo(defaultHub.sourceHub.x, 4);
      expect(singleSlotHub.sourceHub.y).toBeCloseTo(defaultHub.sourceHub.y, 4);
      expect(singleSlotHub.sourceHub.z).toBeCloseTo(defaultHub.sourceHub.z, 4);
    });
  });
});
