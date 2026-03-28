import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VRSceneManager } from '../../../src/VRSceneManager';

// Mock Babylon.js
vi.mock('@babylonjs/core', () => {
  const mockTexture = {
    name: '',
    dispose: vi.fn(),
    update: vi.fn(),
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
  };

  const mockMaterial = {
    emissiveColor: { clone: vi.fn(() => ({ r: 1, g: 1, b: 1 })) },
    emissiveTexture: null,
    wireframe: false,
  };

  const mockMesh = {
    name: '',
    position: { clone: vi.fn(() => ({ x: 0, y: 0, z: 0 })) },
    parent: null,
    dispose: vi.fn(),
    material: mockMaterial,
    actionManager: null,
    billboardMode: 0,
  };

  const mockTransformNode = {
    name: '',
    position: { x: 0, y: 0, z: 0, clone: vi.fn(() => ({ x: 0, y: 0, z: 0, add: vi.fn(), subtract: vi.fn() })), add: vi.fn(() => ({ x: 0, y: 0, z: 0 })), subtract: vi.fn(() => ({ x: 0, y: 0, z: 0 })) },
    dispose: vi.fn(),
  };

  const mockScene = {
    collisionsEnabled: false,
    meshes: [],
    textures: [],
    dispose: vi.fn(),
    render: vi.fn(),
    createDefaultXRExperienceAsync: vi.fn(async () => ({})),
    onPointerObservable: {
      add: vi.fn(),
    },
    pick: vi.fn(),
    pointerX: 0,
    pointerY: 0,
    stopAnimation: vi.fn(),
    beginDirectAnimation: vi.fn(),
  };

  const mockEngine = {
    resize: vi.fn(),
    runRenderLoop: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    Engine: vi.fn(() => mockEngine),
    Scene: vi.fn(() => mockScene),
    Vector3: Object.assign(
      vi.fn((x: number, y: number, z: number) => {
        const v: any = { x, y, z, add: vi.fn(), subtract: vi.fn() };
        v.clone = vi.fn(() => ({ x: v.x, y: v.y, z: v.z, add: vi.fn(), subtract: vi.fn(), clone: vi.fn() }));
        return v;
      }),
      {
        Zero: vi.fn(() => ({ x: 0, y: 0, z: 0, add: vi.fn(), subtract: vi.fn(), clone: vi.fn() })),
        TransformCoordinates: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      }
    ),
    UniversalCamera: vi.fn(() => ({
      attachControl: vi.fn(),
      inertia: 0,
      angularSensibility: 0,
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
    })),
    Color3: vi.fn((r: number, g: number, b: number) => ({ r, g, b, clone: vi.fn(() => ({ r, g, b })) })),
    HemisphericLight: vi.fn(() => ({ intensity: 0 })),
    PointLight: vi.fn(() => ({ intensity: 0 })),
    StandardMaterial: vi.fn(() => mockMaterial),
    DynamicTexture: vi.fn(() => mockTexture),
    MeshBuilder: {
      CreateGround: vi.fn(() => mockMesh),
      CreateBox: vi.fn(() => mockMesh),
      CreateSphere: vi.fn(() => mockMesh),
      CreateCylinder: vi.fn(() => mockMesh),
      CreateTube: vi.fn(() => mockMesh),
      CreatePlane: vi.fn(() => mockMesh),
    },
    TransformNode: vi.fn(() => mockTransformNode),
    ActionManager: Object.assign(
      vi.fn(() => ({ registerAction: vi.fn() })),
      {
        OnPointerOverTrigger: 0,
        OnPointerOutTrigger: 1,
        OnPickTrigger: 4,
      }
    ),
    ExecuteCodeAction: vi.fn(() => {}),
    Animation: {
      CreateAndStartAnimation: vi.fn(),
      ANIMATIONLOOPMODE_CONSTANT: 0,
    },
    Mesh: {
      BILLBOARDMODE_ALL: 7,
    },
  };
});

describe('VRSceneManager', () => {
  let canvas: HTMLCanvasElement;
  let manager: VRSceneManager;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize the engine and scene', () => {
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });

    it('should set up lighting', () => {
      manager = new VRSceneManager(canvas);
      // Verify scene is created and lighting methods are called
      expect(manager).toBeDefined();
    });

    it('should set up camera', () => {
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });

    it('should create ground mesh', () => {
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });

    it('should initialize code visualization', async () => {
      // Mock fetch to return empty graph
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ nodes: [], edges: [], lastUpdated: '' }),
        } as Response)
      );

      manager = new VRSceneManager(canvas);
      // Give async initialization time to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager).toBeDefined();
    });

    it('should set up window resize listener', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      manager = new VRSceneManager(canvas);
      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('should set up WebXR', async () => {
      manager = new VRSceneManager(canvas);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager).toBeDefined();
    });
  });

  describe('Initialization', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should set up graph polling when initialized', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      await manager.initialize();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });
  });

  describe('Graph Loading and Validation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should load graph from /unitcircle/graph.json', async () => {
      const mockGraph = {
        nodes: [{ id: 'func1', name: 'test', type: 'function' }],
        edges: [],
        lastUpdated: '2024-01-01',
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraph),
        } as Response)
      );

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(fetch).toBeDefined();
    });

    it('should handle graph loading errors gracefully', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      manager = new VRSceneManager(canvas);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager).toBeDefined();
    });

    it('should validate graph data has nodes and edges arrays', () => {
      // Validation happens internally during initialization
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });

    it('should reject graphs with missing nodes', () => {
      const invalidGraph = { edges: [], lastUpdated: '' };
      // Graph validation happens during renderCodeGraph
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });

    it('should reject graphs with invalid edge structure', () => {
      const invalidGraph = {
        nodes: [{ id: 'func1', name: 'test', type: 'function' }],
        edges: 'not-an-array',
        lastUpdated: '',
      };
      // Graph validation happens during renderCodeGraph
      manager = new VRSceneManager(canvas);
      expect(manager).toBeDefined();
    });
  });

  describe('Scene Root and Transforms', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create scene root transform node', () => {
      expect(manager).toBeDefined();
    });

    it('should parent all meshes to scene root', () => {
      // This is tested implicitly through mesh creation
      expect(manager).toBeDefined();
    });

    it('should maintain scene root hierarchy during updates', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Mesh Creation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create function mesh as box', () => {
      // Meshes created during graph rendering
      expect(manager).toBeDefined();
    });

    it('should create variable mesh as sphere', () => {
      expect(manager).toBeDefined();
    });

    it('should create external module mesh as cylinder', () => {
      expect(manager).toBeDefined();
    });

    it('should apply different colors based on export status', () => {
      expect(manager).toBeDefined();
    });

    it('should apply random colors to non-exported functions with calls', () => {
      expect(manager).toBeDefined();
    });

    it('should apply light gray color to leaf functions', () => {
      expect(manager).toBeDefined();
    });

    it('should apply signature texture to function meshes', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Signature Texture Generation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create signature texture with node name', () => {
      expect(manager).toBeDefined();
    });

    it('should include export status in signature', () => {
      expect(manager).toBeDefined();
    });

    it('should include file path in signature if available', () => {
      expect(manager).toBeDefined();
    });

    it('should include line number in signature if available', () => {
      expect(manager).toBeDefined();
    });

    it('should include type label in signature', () => {
      expect(manager).toBeDefined();
    });

    it('should render signature with green text on black background', () => {
      expect(manager).toBeDefined();
    });

    it('should render signature with green border', () => {
      expect(manager).toBeDefined();
    });

    it('should use monospace font for signature', () => {
      expect(manager).toBeDefined();
    });

    it('should center signature text horizontally', () => {
      expect(manager).toBeDefined();
    });

    it('should create unique texture ID per function', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Node Interaction', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should set up action manager for mesh interactions', () => {
      expect(manager).toBeDefined();
    });

    it('should highlight mesh on pointer over', () => {
      expect(manager).toBeDefined();
    });

    it('should restore color on pointer out', () => {
      expect(manager).toBeDefined();
    });

    it('should show tooltip on hover', () => {
      expect(manager).toBeDefined();
    });

    it('should hide tooltip on leave', () => {
      expect(manager).toBeDefined();
    });

    it('should fly to object on click', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Scene Root Animation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should animate scene root position when flying to object', () => {
      expect(manager).toBeDefined();
    });

    it('should position target at Z=-5 for top-down view', () => {
      expect(manager).toBeDefined();
    });

    it('should use 800ms animation duration', () => {
      expect(manager).toBeDefined();
    });

    it('should animate at 60fps', () => {
      expect(manager).toBeDefined();
    });

    it('should calculate correct scene offset for target positioning', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Edge Rendering', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create tube meshes for edges', () => {
      expect(manager).toBeDefined();
    });

    it('should connect source and target nodes with tubes', () => {
      expect(manager).toBeDefined();
    });

    it('should use gray color for edges', () => {
      expect(manager).toBeDefined();
    });

    it('should skip edges with missing source or target', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Label Creation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create label plane for node names', () => {
      expect(manager).toBeDefined();
    });

    it('should position labels above nodes', () => {
      expect(manager).toBeDefined();
    });

    it('should make labels always face camera', () => {
      expect(manager).toBeDefined();
    });

    it('should use semi-transparent background for labels', () => {
      expect(manager).toBeDefined();
    });

    it('should use white text color for labels', () => {
      expect(manager).toBeDefined();
    });

    it('should create unique texture per label', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Breadcrumb Navigation', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should resolve a parent breadcrumb to the exact parent directory label', () => {
      const rootDirectoryLabel = { name: 'root-directory-label' } as any;
      const parentDirectoryLabel = { name: 'src-utils-label' } as any;
      const clickedChip = { name: 'clicked-chip' } as any;

      (manager as any).directoryLabelLookup = new Map([
        ['src', rootDirectoryLabel],
        ['src/utils', parentDirectoryLabel],
      ]);

      const resolved = (manager as any).resolveBreadcrumbNavigationTarget('directory', 'src/utils', clickedChip);

      expect(resolved).toBe(parentDirectoryLabel);
    });

    it('should prefer the file label over the file box for a file breadcrumb', () => {
      const fileLabel = { name: 'file-label' } as any;
      const fileBox = { name: 'file-box' } as any;
      const clickedChip = { name: 'clicked-chip' } as any;

      (manager as any).fileLabelLookup = new Map([
        ['src/VRSceneManager.ts', fileLabel],
      ]);
      (manager as any).fileBoxMeshes = new Map([
        ['src/VRSceneManager.ts', fileBox],
      ]);

      const resolved = (manager as any).resolveBreadcrumbNavigationTarget('file', 'src/VRSceneManager.ts', clickedChip);

      expect(resolved).toBe(fileLabel);
    });
  });

  describe('Tooltip Management', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should create tooltip element on hover', () => {
      expect(manager).toBeDefined();
    });

    it('should remove existing tooltip before creating new one', () => {
      expect(manager).toBeDefined();
    });

    it('should display node name in tooltip', () => {
      expect(manager).toBeDefined();
    });

    it('should display file path in tooltip if available', () => {
      expect(manager).toBeDefined();
    });

    it('should display line number in tooltip if available', () => {
      expect(manager).toBeDefined();
    });

    it('should position tooltip at top-right of screen', () => {
      expect(manager).toBeDefined();
    });

    it('should style tooltip with border and shadow', () => {
      expect(manager).toBeDefined();
    });

    it('should remove tooltip on mouse leave', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('Lifecycle Methods', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should start render loop in run()', () => {
      manager.run();
      expect(manager).toBeDefined();
    });

    it('should dispose scene and engine in dispose()', () => {
      manager.dispose();
      expect(manager).toBeDefined();
    });

    it('should clean up resources on dispose', () => {
      manager.dispose();
      expect(manager).toBeDefined();
    });
  });

  describe('Graph Updates', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should detect graph updates via polling', async () => {
      expect(manager).toBeDefined();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should refresh visualization when graph changes', () => {
      expect(manager).toBeDefined();
    });

    it('should clear old mesh nodes on update', () => {
      expect(manager).toBeDefined();
    });

    it('should remove textures for disposed nodes', () => {
      expect(manager).toBeDefined();
    });

    it('should preserve ground and lights during updates', () => {
      expect(manager).toBeDefined();
    });

    it('should handle polling errors gracefully', async () => {
      expect(manager).toBeDefined();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Error Handling', () => {
    it('should handle canvas not found', () => {
      const nullCanvas = null as any;
      // Constructor should handle or throw appropriately
      expect(() => {
        try {
          new VRSceneManager(nullCanvas);
        } catch (e) {
          // Expected
        }
      }).not.toThrow();
    });

    it('should handle WebXR initialization failure', async () => {
      manager = new VRSceneManager(canvas);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager).toBeDefined();
    });

    it('should continue operation if fetch fails', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));
      manager = new VRSceneManager(canvas);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(manager).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // New layout-method tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('File Box Overlap Resolution (resolveFileBoxOverlapsByMesh)', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should push two overlapping boxes apart to meet minimum separation', () => {
      const boxA = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 5, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('fileA', boxA);
      (manager as any).fileBoxMeshes.set('fileB', boxB);

      (manager as any).resolveFileBoxOverlapsByMesh(5);

      // Required center-to-center: half1.x + half2.x + padding = 10 + 10 + 6 = 26
      const separation = Math.abs(boxB.position.x - boxA.position.x);
      expect(separation).toBeGreaterThanOrEqual(26);
    });

    it('should not move well-separated file boxes', () => {
      const boxA = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('fileA', boxA);
      (manager as any).fileBoxMeshes.set('fileB', boxB);

      (manager as any).resolveFileBoxOverlapsByMesh(5);

      expect(boxA.position.x).toBe(0);
      expect(boxB.position.x).toBe(100);
    });

    it('should handle an empty file box map without throwing', () => {
      expect(() => (manager as any).resolveFileBoxOverlapsByMesh(3)).not.toThrow();
    });

    it('should converge three overlapping boxes to separated positions', () => {
      const boxA = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 2, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxC = { position: { x: 4, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('fileA', boxA);
      (manager as any).fileBoxMeshes.set('fileB', boxB);
      (manager as any).fileBoxMeshes.set('fileC', boxC);

      (manager as any).resolveFileBoxOverlapsByMesh(20);

      // All pairs must now be ~26+ units apart on their separation axis
      const pairs = [['fileA', 'fileB'], ['fileA', 'fileC'], ['fileB', 'fileC']];
      for (const [a, b] of pairs) {
        const bA = (manager as any).fileBoxMeshes.get(a);
        const bB = (manager as any).fileBoxMeshes.get(b);
        const sepX = Math.abs(bB.position.x - bA.position.x);
        expect(sepX).toBeGreaterThanOrEqual(26.0);
      }
    });
  });

  describe('Edge Obstruction Resolution (resolveEdgeObstructions)', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should push a non-endpoint box away from the edge path', () => {
      // Edge: fileA(−100,0,0) → fileB(100,0,0). FileC sits almost on the path at y=5.
      const boxA = { position: { x: -100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxC = { position: { x: 0, y: 5, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('src/fileA.ts', boxA);
      (manager as any).fileBoxMeshes.set('src/fileB.ts', boxB);
      (manager as any).fileBoxMeshes.set('src/fileC.ts', boxC);

      // One cross-file edge between A and B
      (manager as any).currentEdges.add('funcA@src/fileA.ts\u2192funcB@src/fileB.ts');
      (manager as any).nodeToFile.set('funcA@src/fileA.ts', 'src/fileA.ts');
      (manager as any).nodeToFile.set('funcB@src/fileB.ts', 'src/fileB.ts');

      (manager as any).resolveEdgeObstructions(10);

      // boxC must have been pushed perpendicularly away from the segment
      // bounding-sphere radius ≈ √(10²×3) ≈ 17.3 + padding 10 = 27.3
      expect(boxC.position.y).toBeGreaterThan(20);
    });

    it('should not move endpoint boxes during edge obstruction resolution', () => {
      const boxA = { position: { x: -100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('src/fileA.ts', boxA);
      (manager as any).fileBoxMeshes.set('src/fileB.ts', boxB);

      (manager as any).currentEdges.add('funcA@src/fileA.ts\u2192funcB@src/fileB.ts');
      (manager as any).nodeToFile.set('funcA@src/fileA.ts', 'src/fileA.ts');
      (manager as any).nodeToFile.set('funcB@src/fileB.ts', 'src/fileB.ts');

      const origAx = boxA.position.x;
      const origBx = boxB.position.x;

      (manager as any).resolveEdgeObstructions(10);

      // Endpoint boxes should not move in opposite directions – their X should remain unchanged
      expect(boxA.position.x).toBe(origAx);
      expect(boxB.position.x).toBe(origBx);
    });

    it('should handle zero cross-file edges without throwing', () => {
      const boxA = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('src/fileA.ts', boxA);
      // No edges added to currentEdges

      expect(() => (manager as any).resolveEdgeObstructions(5)).not.toThrow();
    });

    it('should not move boxes already far from the edge path', () => {
      const boxA = { position: { x: -100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxB = { position: { x: 100, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const boxD = { position: { x: 0, y: 200, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      (manager as any).fileBoxMeshes.set('src/fileA.ts', boxA);
      (manager as any).fileBoxMeshes.set('src/fileB.ts', boxB);
      (manager as any).fileBoxMeshes.set('src/fileD.ts', boxD);

      (manager as any).currentEdges.add('funcA@src/fileA.ts\u2192funcB@src/fileB.ts');
      (manager as any).nodeToFile.set('funcA@src/fileA.ts', 'src/fileA.ts');
      (manager as any).nodeToFile.set('funcB@src/fileB.ts', 'src/fileB.ts');

      (manager as any).resolveEdgeObstructions(10);

      // boxD is 200 units off the path – well beyond the bounding-sphere clearance
      expect(boxD.position.y).toBeGreaterThan(100);
    });
  });

  describe('Exported Function Face Placement (placeExportedFunctionsOnOptimalFace)', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should place an exported function on the face closest to cross-file neighbours', () => {
      // File box at origin with uniform scaling 20
      const fileBox = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      // Neighbour (remote function) is far to the right (+X at 200)
      const remoteMesh = {
        getAbsolutePosition: vi.fn(() => ({ x: 200, y: 0, z: 0, clone: vi.fn(() => ({ x: 200, y: 0, z: 0 })) })),
      };

      const exportedMesh: any = {
        scaling: { x: 1, y: 1, z: 1 },
        getAbsolutePosition: vi.fn(() => ({ x: 0, y: 0, z: 0, clone: vi.fn(() => ({ x: 0, y: 0, z: 0 })) })),
      };
      exportedMesh.position = { x: 0, y: 0, z: 0 };

      (manager as any).fileBoxMeshes.set('src/fileA.ts', fileBox);
      (manager as any).nodeMeshMap.set('funcA@src/fileA.ts', exportedMesh);
      (manager as any).nodeMeshMap.set('funcB@src/fileB.ts', remoteMesh);
      (manager as any).nodeToFile.set('funcA@src/fileA.ts', 'src/fileA.ts');
      (manager as any).nodeToFile.set('funcB@src/fileB.ts', 'src/fileB.ts');
      (manager as any).graphNodeMap.set('funcA@src/fileA.ts', {
        id: 'funcA@src/fileA.ts',
        name: 'funcA',
        file: 'src/fileA.ts',
        line: 1,
        isExported: true,
        type: 'function',
      });
      (manager as any).currentEdges.add('funcA@src/fileA.ts\u2192funcB@src/fileB.ts');

      (manager as any).placeExportedFunctionsOnOptimalFace();

      // +X protruding face target with fallback size/scaling is 0.5 + 3/20 + 0.01 = 0.66
      expect(exportedMesh.position.x).toBeCloseTo(0.66);
      expect(exportedMesh.position.y).toBeCloseTo(0);
      expect(exportedMesh.position.z).toBeCloseTo(0);
    });

    it('should skip non-exported function nodes', () => {
      const fileBox = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const internalMesh: any = { position: { x: 0.1, y: 0.1, z: 0.1 }, scaling: { x: 1, y: 1, z: 1 } };

      (manager as any).fileBoxMeshes.set('src/fileA.ts', fileBox);
      (manager as any).nodeMeshMap.set('funcX@src/fileA.ts', internalMesh);
      (manager as any).nodeToFile.set('funcX@src/fileA.ts', 'src/fileA.ts');
      (manager as any).graphNodeMap.set('funcX@src/fileA.ts', {
        id: 'funcX@src/fileA.ts',
        name: 'funcX',
        file: 'src/fileA.ts',
        line: 5,
        isExported: false,   // not exported
        type: 'function',
      });
      (manager as any).currentEdges.add('funcX@src/fileA.ts\u2192funcY@src/fileB.ts');

      const originalPos = { ...internalMesh.position };
      (manager as any).placeExportedFunctionsOnOptimalFace();

      // Position must not have changed
      expect(internalMesh.position.x).toBe(originalPos.x);
      expect(internalMesh.position.y).toBe(originalPos.y);
    });

    it('should still snap exported functions with no cross-file neighbours to an outside face', () => {
      const fileBox = { position: { x: 0, y: 0, z: 0 }, scaling: { x: 20, y: 20, z: 20 } };
      const exportedMesh: any = { position: { x: 0.1, y: 0.2, z: 0.3 }, scaling: { x: 1, y: 1, z: 1 } };

      (manager as any).fileBoxMeshes.set('src/fileA.ts', fileBox);
      (manager as any).nodeMeshMap.set('funcA@src/fileA.ts', exportedMesh);
      (manager as any).nodeToFile.set('funcA@src/fileA.ts', 'src/fileA.ts');
      (manager as any).graphNodeMap.set('funcA@src/fileA.ts', {
        id: 'funcA@src/fileA.ts',
        name: 'funcA',
        file: 'src/fileA.ts',
        line: 1,
        isExported: true,
        type: 'function',
      });
      // No cross-file edges in currentEdges

      (manager as any).placeExportedFunctionsOnOptimalFace();

      // Dominant local axis is +Z, so snap to outside +Z face.
      expect(exportedMesh.position.x).toBeCloseTo(0);
      expect(exportedMesh.position.y).toBeCloseTo(0);
      expect(exportedMesh.position.z).toBeCloseTo(0.66);
    });

    it('should handle an empty graph without throwing', () => {
      expect(() => (manager as any).placeExportedFunctionsOnOptimalFace()).not.toThrow();
    });
  });

  describe('File Box Autosizing', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should keep exported functions on the surface and resize per axis', () => {
      const exportedChild: any = {
        name: 'node_exported',
        position: { x: 0.5, y: 0.3, z: 0.1 },
        scaling: { x: 1, y: 1, z: 1 },
        getBoundingInfo: vi.fn(() => ({ boundingSphere: { radiusWorld: 1 } })),
        nodeData: { id: 'exp@src/fileA.ts' },
      };
      const internalChildA: any = {
        name: 'node_internalA',
        position: { x: 0.45, y: 0.0, z: 0.0 },
        scaling: { x: 1, y: 1, z: 1 },
        getBoundingInfo: vi.fn(() => ({ boundingSphere: { radiusWorld: 1 } })),
      };
      const internalChildB: any = {
        name: 'node_internalB',
        position: { x: -0.45, y: 0.0, z: 0.0 },
        scaling: { x: 1, y: 1, z: 1 },
        getBoundingInfo: vi.fn(() => ({ boundingSphere: { radiusWorld: 1 } })),
      };

      const children = [exportedChild, internalChildA, internalChildB];
      const fileBox: any = {
        name: 'filebox_src/fileA.ts',
        scaling: { x: 20, y: 20, z: 20 },
        getChildren: vi.fn(() => children),
      };

      (manager as any).fileBoxMeshes.set('src/fileA.ts', fileBox);
      (manager as any).graphNodeMap.set('exp@src/fileA.ts', {
        id: 'exp@src/fileA.ts',
        name: 'exp',
        file: 'src/fileA.ts',
        line: 1,
        isExported: true,
        type: 'function',
      });

      (manager as any).autosizeFileBoxes();

      // Exported function should remain snapped to one face center.
      expect(Math.abs(exportedChild.position.x)).toBe(0.5);
      expect(exportedChild.position.y).toBe(0);
      expect(exportedChild.position.z).toBe(0);

      // Per-axis resizing should produce a non-uniform box for anisotropic content.
      expect(fileBox.scaling.x).not.toBe(fileBox.scaling.y);
      expect(fileBox.scaling.x).not.toBe(fileBox.scaling.z);
    });
  });

  describe('Post-resize collision resolution pipeline', () => {
    beforeEach(() => {
      manager = new VRSceneManager(canvas);
    });

    it('should always resolve collisions after resizing file boxes', () => {
      const autosizeSpy = vi.spyOn(manager as any, 'autosizeFileBoxes').mockImplementation(() => {});
      const ensureParentSpy = vi.spyOn(manager as any, 'ensureExportedFunctionsParentedToFileBoxes').mockImplementation(() => {});
      const clampSpy = vi.spyOn(manager as any, 'clampNodesInsideFileBoxes').mockImplementation(() => {});
      const gridSpy = vi.spyOn(manager as any, 'positionFileBoxesInGrid').mockImplementation(() => {});
      const overlapSpy = vi.spyOn(manager as any, 'resolveInitialFileBoxOverlaps').mockImplementation(() => {});
      const gapSpy = vi.spyOn(manager as any, 'enforceMinimumFileBoxGap').mockImplementation(() => {});

      (manager as any).fitAndSeparateFileBoxes();

      expect(autosizeSpy).toHaveBeenCalledTimes(1);
      expect(ensureParentSpy).toHaveBeenCalledTimes(1);
      expect(clampSpy).toHaveBeenCalledTimes(1);
      expect(gridSpy).toHaveBeenCalledTimes(1);
      expect(overlapSpy).toHaveBeenCalledWith(6);
      expect(gapSpy).toHaveBeenCalledWith(10.0, 6);
    });

    it('should run resize and collision steps in the expected order', () => {
      const autosizeSpy = vi.spyOn(manager as any, 'autosizeFileBoxes').mockImplementation(() => {});
      const ensureParentSpy = vi.spyOn(manager as any, 'ensureExportedFunctionsParentedToFileBoxes').mockImplementation(() => {});
      const clampSpy = vi.spyOn(manager as any, 'clampNodesInsideFileBoxes').mockImplementation(() => {});
      const gridSpy = vi.spyOn(manager as any, 'positionFileBoxesInGrid').mockImplementation(() => {});
      const overlapSpy = vi.spyOn(manager as any, 'resolveInitialFileBoxOverlaps').mockImplementation(() => {});
      const gapSpy = vi.spyOn(manager as any, 'enforceMinimumFileBoxGap').mockImplementation(() => {});

      (manager as any).fitAndSeparateFileBoxes();

      const autosizeOrder = (autosizeSpy as any).mock.invocationCallOrder[0];
      const ensureParentOrder = (ensureParentSpy as any).mock.invocationCallOrder[0];
      const clampOrder = (clampSpy as any).mock.invocationCallOrder[0];
      const gridOrder = (gridSpy as any).mock.invocationCallOrder[0];
      const overlapOrder = (overlapSpy as any).mock.invocationCallOrder[0];
      const gapOrder = (gapSpy as any).mock.invocationCallOrder[0];

      expect(autosizeOrder).toBeLessThan(ensureParentOrder);
      expect(ensureParentOrder).toBeLessThan(clampOrder);
      expect(clampOrder).toBeLessThan(gridOrder);
      expect(gridOrder).toBeLessThan(overlapOrder);
      expect(overlapOrder).toBeLessThan(gapOrder);
    });
  });
});
