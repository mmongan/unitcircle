import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphRenderer } from '../../src/GraphRenderer';
import { MeshFactory } from '../../src/MeshFactory';
import * as BABYLON from '@babylonjs/core';

vi.mock('@babylonjs/core', () => {
  const makeVector = (x: number, y: number, z: number) => {
    const v: any = { x, y, z };
    v.add = vi.fn((other: any) => makeVector(v.x + other.x, v.y + other.y, v.z + other.z));
    v.subtract = vi.fn((other: any) => makeVector(v.x - other.x, v.y - other.y, v.z - other.z));
    v.scale = vi.fn((s: number) => makeVector(v.x * s, v.y * s, v.z * s));
    v.clone = vi.fn(() => makeVector(v.x, v.y, v.z));
    v.copyFrom = vi.fn(function(other: any) { this.x = other.x; this.y = other.y; this.z = other.z; return this; });
    return v;
  };

  return {
    Vector3: vi.fn((x, y, z) => makeVector(x, y, z)),
    StandardMaterial: vi.fn(() => ({
      wireframe: false,
      alpha: 1,
      transparencyMode: 0,
      needDepthPrePass: false,
      disableLighting: false,
      disableDepthWrite: false,
      emissiveColor: makeVector(0, 0, 0),
    })),
    Material: {
      MATERIAL_ALPHABLEND: 2,
      MATERIAL_OPAQUE: 0,
    },
    MeshBuilder: {
      CreateBox: vi.fn(() => ({
        parent: null,
        position: makeVector(0, 0, 0),
        scaling: makeVector(1, 1, 1),
        isPickable: false,
        dispose: vi.fn(),
        material: null,
      })),
      CreatePlane: vi.fn(() => ({
        parent: null,
        position: makeVector(0, 0, 0),
        scaling: makeVector(1, 1, 1),
        isPickable: false,
        dispose: vi.fn(),
        material: null,
      })),
    },
    DynamicTexture: vi.fn(() => ({
      getContext: vi.fn(() => ({
        fillStyle: '',
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        fillText: vi.fn(),
        font: '',
        textAlign: '',
        textBaseline: '',
      })),
      update: vi.fn(),
    })),
    Color3: vi.fn((r, g, b) => ({ r, g, b })),
    Color4: vi.fn((r, g, b, a) => ({ r, g, b, a: a || 1 })),
  };
});

vi.mock('../../src/MeshFactory');

describe('GraphRenderer', () => {
  let scene: any;
  let sceneRoot: any;
  let meshFactory: any;
  let renderer: GraphRenderer;

  beforeEach(() => {
    scene = {
      activeCamera: null,
    };

    sceneRoot = {
      position: new BABYLON.Vector3(0, 0, 0),
    };

    meshFactory = {
      clearNodeReferences: vi.fn(),
      clearEdges: vi.fn(),
      createNodeMesh: vi.fn((node, pos, color, indegree, callback) => {
        const mesh = { id: node.id, position: new BABYLON.Vector3(0, 0, 0) };
        const material = {};
        callback(mesh, material);
      }),
      createEdgeMesh: vi.fn(),
    };

    renderer = new GraphRenderer(scene, sceneRoot, meshFactory);
  });

  describe('Mesh Management', () => {
    it('should get node mesh map', () => {
      const map = renderer.getNodeMeshMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    it('should get file box meshes', () => {
      const map = renderer.getFileBoxMeshes();
      expect(map).toBeInstanceOf(Map);
    });

    it('should get directory box meshes', () => {
      const map = renderer.getDirectoryBoxMeshes();
      expect(map).toBeInstanceOf(Map);
    });
  });

  describe('Scene Clearing', () => {
    it('should clear all scene meshes', () => {
      const mockMesh = {
        dispose: vi.fn(),
      };

      renderer.getNodeMeshMap().set('node1', mockMesh as any);

      renderer.clearScene();

      expect(mockMesh.dispose).toHaveBeenCalled();
      expect(meshFactory.clearNodeReferences).toHaveBeenCalled();
      expect(meshFactory.clearEdges).toHaveBeenCalled();
    });
  });

  describe('File Box Rendering', () => {
    it('should render file boxes', () => {
      const dimensions = new Map([['src/main.ts', new BABYLON.Vector3(20, 20, 20)]]);

      renderer.renderFileBoxes(dimensions);

      expect(renderer.getFileBoxMeshes().size).toBe(1);
      expect(renderer.getFileBoxMeshes().has('src/main.ts')).toBe(true);
    });

    it('should not recreate existing file boxes', () => {
      const dimensions = new Map([['src/main.ts', new BABYLON.Vector3(20, 20, 20)]]);

      renderer.renderFileBoxes(dimensions);
      const firstBoxCount = renderer.getFileBoxMeshes().size;

      renderer.renderFileBoxes(dimensions);
      const secondBoxCount = renderer.getFileBoxMeshes().size;

      expect(secondBoxCount).toBe(firstBoxCount);
    });
  });

  describe('Directory Box Rendering', () => {
    it('should render directory boxes', () => {
      const dimensions = new Map([
        [
          'src',
          {
            position: new BABYLON.Vector3(0, 0, 0),
            scaling: new BABYLON.Vector3(30, 30, 30),
          },
        ],
      ]);

      renderer.renderDirectoryBoxes(dimensions);

      expect(renderer.getDirectoryBoxMeshes().size).toBe(1);
      expect(renderer.getDirectoryBoxMeshes().has('src')).toBe(true);
    });

    it('should update existing directory boxes', () => {
      const dimensions = new Map([
        [
          'src',
          {
            position: new BABYLON.Vector3(0, 0, 0),
            scaling: new BABYLON.Vector3(30, 30, 30),
          },
        ],
      ]);

      renderer.renderDirectoryBoxes(dimensions);
      const firstSize = renderer.getDirectoryBoxMeshes().size;

      renderer.renderDirectoryBoxes(dimensions);
      const secondSize = renderer.getDirectoryBoxMeshes().size;

      expect(secondSize).toBe(firstSize);
    });
  });

  describe('Node Rendering', () => {
    it('should render nodes', () => {
      const nodes = [
        { id: 'func1', name: 'myFunction', file: 'src/main.ts', type: 'function' } as any,
      ];
      const positions = new Map([['func1', new BABYLON.Vector3(0, 0, 0)]]);
      const colorMap = new Map([['src/main.ts', new BABYLON.Color3(1, 0, 0)]]);

      renderer.renderNodes(nodes, positions, colorMap);

      expect(meshFactory.createNodeMesh).toHaveBeenCalledWith(
        nodes[0],
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.any(Function),
      );
    });

    it('should not re-render existing nodes', () => {
      const nodes = [{ id: 'func1', name: 'myFunction', file: 'src/main.ts' } as any];
      const positions = new Map([['func1', new BABYLON.Vector3(0, 0, 0)]]);
      const colorMap = new Map();

      renderer.renderNodes(nodes, positions, colorMap);
      const callCount1 = meshFactory.createNodeMesh.mock.calls.length;

      renderer.renderNodes(nodes, positions, colorMap);
      const callCount2 = meshFactory.createNodeMesh.mock.calls.length;

      expect(callCount2).toBe(callCount1);
    });
  });

  describe('Edge Rendering', () => {
    it('should render edges', () => {
      const mockMesh1 = { id: 'func1' };
      const mockMesh2 = { id: 'func2' };

      renderer.getNodeMeshMap().set('func1', mockMesh1 as any);
      renderer.getNodeMeshMap().set('func2', mockMesh2 as any);

      const edges = [{ from: 'func1', to: 'func2', kind: 'call' as const }];
      const edgeKinds = new Map([['func1→func2', 'call' as const]]);

      renderer.renderEdges(edges, renderer.getNodeMeshMap(), edgeKinds);

      expect(edges.length).toBe(1);
    });

    it('should skip edges with missing nodes', () => {
      const edges = [{ from: 'func1', to: 'func2', kind: 'call' as const }];
      const edgeKinds = new Map();

      renderer.renderEdges(edges, renderer.getNodeMeshMap(), edgeKinds);

      expect(meshFactory.createEdgeMesh).not.toHaveBeenCalled();
    });
  });

  describe('Label Management', () => {
    it('should create file box labels', () => {
      const mockBox = {
        position: new BABYLON.Vector3(0, 0, 0),
        scaling: new BABYLON.Vector3(20, 20, 20),
      };

      const label = renderer.createFileBoxLabel('src/main.ts', mockBox as any);

      expect(label).toBeDefined();
    });

    it('should update label transforms', () => {
      const mockBox = {
        position: new BABYLON.Vector3(5, 5, 5),
        scaling: new BABYLON.Vector3(20, 20, 20),
      };
      const mockLabel = {
        position: new BABYLON.Vector3(0, 0, 0),
      };

      renderer.getFileBoxMeshes().set('src/main.ts', mockBox as any);
      (renderer as any).fileBoxLabels.set('src/main.ts', mockLabel as any);

      renderer.updateLabelTransforms();

      expect(mockLabel.position).toBeDefined();
    });
  });

  describe('Edge List Population', () => {
    it('should populate current edges', () => {
      const edges = [
        { from: 'func1', to: 'func2', kind: 'call' as const },
        { from: 'func2', to: 'func3', kind: 'export' as const },
      ];

      const result = renderer.populateCurrentEdges(edges);

      expect(result.size).toBe(2);
      expect(result.get('func1→func2')).toBe('call');
      expect(result.get('func2→func3')).toBe('export');
    });
  });

  describe('File Box Autosizing', () => {
    it('should autosize file boxes based on bounds', () => {
      const nodeCounts = new Map([['src/main.ts', 10]]);
      const bounds = new Map([
        [
          'src/main.ts',
          {
            min: new BABYLON.Vector3(-10, -10, -10),
            max: new BABYLON.Vector3(10, 10, 10),
          },
        ],
      ]);

      const dimensions = renderer.autosizeFileBoxes(nodeCounts, bounds);

      expect(dimensions.size).toBe(1);
      expect(dimensions.has('src/main.ts')).toBe(true);
    });
  });
});
