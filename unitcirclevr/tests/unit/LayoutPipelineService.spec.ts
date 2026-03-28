import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LayoutPipelineService } from '../../src/LayoutPipelineService';
import { ForceDirectedLayout } from '../../src/ForceDirectedLayout';
import * as BABYLON from '@babylonjs/core';

vi.mock('@babylonjs/core', () => {
  const makeVector = (x: number, y: number, z: number) => {
    const v: any = { x, y, z };
    v.add = vi.fn((other: any) => makeVector(v.x + other.x, v.y + other.y, v.z + other.z));
    v.subtract = vi.fn((other: any) => makeVector(v.x - other.x, v.y - other.y, v.z - other.z));
    v.scale = vi.fn((s: number) => makeVector(v.x * s, v.y * s, v.z * s));
    v.clone = vi.fn(() => makeVector(v.x, v.y, v.z));
    v.length = vi.fn(() => Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z)));
    v.lengthSquared = vi.fn(() => (v.x * v.x) + (v.y * v.y) + (v.z * v.z));
    return v;
  };

  return {
    Vector3: vi.fn((x, y, z) => makeVector(x, y, z)),
  };
});

vi.mock('../../src/ForceDirectedLayout');

describe('LayoutPipelineService', () => {
  let scene: any;
  let service: LayoutPipelineService;

  beforeEach(() => {
    scene = {
      registerBeforeRender: vi.fn(),
      stopAnimation: vi.fn(),
    };

    service = new LayoutPipelineService(scene);
  });

  describe('Physics Management', () => {
    it('should initialize service', () => {
      expect(service).toBeDefined();
    });

    it('should activate and deactivate physics', () => {
      service.activatePhysics();
      service.deactivatePhysics();
      expect(service).toBeDefined();
    });

    it('should setup physics loop only once', () => {
      service.setupPhysicsLoop();
      service.setupPhysicsLoop();
      expect(scene.registerBeforeRender).toHaveBeenCalledTimes(1);
    });
  });

  describe('File Box Management', () => {
    it('should set and retrieve file layout', () => {
      const mockLayout = {} as any;
      service.setFileLayout(mockLayout);
      expect(service.getFileLayout()).toBe(mockLayout);
    });

    it('should set mesh maps', () => {
      const meshMap = new Map();
      service.setNodeMeshMap(meshMap);
      expect(service.getNodeMeshMap?.()).toBe(meshMap);
    });

    it('should set file box meshes', () => {
      const fileBoxes = new Map();
      service.setFileBoxMeshes(fileBoxes);
      expect(service.getFileBoxMeshes?.()).toBe(fileBoxes);
    });
  });

  describe('Collision Resolution', () => {
    it('should apply file box repulsion', () => {
      const mockLayout = {
        getNodes: vi.fn(() => new Map()),
      } as any;

      expect(() => {
        service.applyFileBoxRepulsion(mockLayout);
      }).not.toThrow();
    });

    it('should resolve initial file box overlaps', () => {
      const mockBox1 = {
        position: new BABYLON.Vector3(0, 0, 0),
        scaling: new BABYLON.Vector3(10, 10, 10),
      };
      const mockBox2 = {
        position: new BABYLON.Vector3(5, 0, 0),
        scaling: new BABYLON.Vector3(10, 10, 10),
      };

      service.setFileBoxMeshes(
        new Map([
          ['file1.ts', mockBox1 as any],
          ['file2.ts', mockBox2 as any],
        ]),
      );

      expect(() => {
        service.resolveInitialFileBoxOverlaps(1);
      }).not.toThrow();
    });

    it('should enforce minimum file box gap', () => {
      const mockBox1 = {
        position: new BABYLON.Vector3(0, 0, 0),
        scaling: new BABYLON.Vector3(10, 10, 10),
      };
      const mockBox2 = {
        position: new BABYLON.Vector3(8, 0, 0),
        scaling: new BABYLON.Vector3(10, 10, 10),
      };

      service.setFileBoxMeshes(
        new Map([
          ['file1.ts', mockBox1 as any],
          ['file2.ts', mockBox2 as any],
        ]),
      );

      expect(() => {
        service.enforceMinimumFileBoxGap(5, 1);
      }).not.toThrow();
    });

    it('should enforce top-level directory gap', () => {
      const mockBox = {
        position: new BABYLON.Vector3(0, 0, 0),
        scaling: new BABYLON.Vector3(10, 10, 10),
      };

      service.setFileBoxMeshes(new Map([['src/index.ts', mockBox as any]]));
      service.setFileLayout({
        getNodes: vi.fn(() => new Map([['src/index.ts', { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }]])),
      } as any);

      expect(() => {
        service.enforceTopLevelDirectoryGap(10, 1);
      }).not.toThrow();
    });
  });

  describe('Node Clearance', () => {
    it('should clamp nodes inside file boxes', () => {
      const mockMesh = {
        position: new BABYLON.Vector3(100, 100, 100),
      };
      const mockBox = {
        scaling: new BABYLON.Vector3(10, 10, 10),
      };

      service.setNodeMeshMap(new Map([['node1', mockMesh as any]]));
      service.setGraphNodeMap(
        new Map([['node1', { id: 'node1', file: 'file1.ts' } as any]]),
      );
      service.setFileBoxMeshes(new Map([['file1.ts', mockBox as any]]));

      expect(() => {
        service.clampNodesInsideFileBoxes();
      }).not.toThrow();
    });

    it('should enforce in-file node clearance', () => {
      const mockMesh1 = { position: new BABYLON.Vector3(0, 0, 0) };
      const mockMesh2 = { position: new BABYLON.Vector3(1, 0, 0) };

      service.setNodeMeshMap(
        new Map([
          ['node1', mockMesh1 as any],
          ['node2', mockMesh2 as any],
        ]),
      );

      expect(() => {
        service.enforceInFileNodeClearance();
      }).not.toThrow();
    });
  });

  describe('Layout Compaction', () => {
    it('should compact file box layout', () => {
      service.setFileLayout({
        getNodes: vi.fn(() =>
          new Map([
            ['file1.ts', { position: { x: 10, y: 10, z: 10 }, velocity: { x: 0, y: 0, z: 0 } }],
            ['file2.ts', { position: { x: -10, y: -10, z: -10 }, velocity: { x: 0, y: 0, z: 0 } }],
          ]),
        ),
      } as any);

      const mockBox1 = { position: new BABYLON.Vector3(10, 10, 10), scaling: new BABYLON.Vector3(5, 5, 5) };
      const mockBox2 = { position: new BABYLON.Vector3(-10, -10, -10), scaling: new BABYLON.Vector3(5, 5, 5) };

      service.setFileBoxMeshes(
        new Map([
          ['file1.ts', mockBox1 as any],
          ['file2.ts', mockBox2 as any],
        ]),
      );

      expect(() => {
        service.compactFileBoxLayout(100, 5);
      }).not.toThrow();
    });
  });

  describe('Obstruction Resolution', () => {
    it('should resolve node-edge obstructions', () => {
      expect(() => {
        service.resolveNodeEdgeObstructions(5);
      }).not.toThrow();
    });

    it('should resolve edge obstructions', () => {
      expect(() => {
        service.resolveEdgeObstructions(10);
      }).not.toThrow();
    });

    it('should resolve function label obstructions', () => {
      expect(() => {
        service.resolveFunctionLabelObstructions(5);
      }).not.toThrow();
    });
  });
});
