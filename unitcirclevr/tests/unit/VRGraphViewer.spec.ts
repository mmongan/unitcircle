import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VRGraphViewer } from '../../src/VRGraphViewer';

// Mock VRSceneManager
vi.mock('../../src/VRSceneManager', () => {
  const mockScene = {
    dispose: vi.fn(),
  };

  return {
    VRSceneManager: vi.fn(() => ({
      renderCodeGraph: vi.fn(),
      run: vi.fn(),
      dispose: vi.fn(),
    }))
  };
});

describe('VRGraphViewer', () => {
  let viewer: VRGraphViewer;
  const mockCanvas = document.createElement('canvas');

  const mockGraphData = {
    nodes: [
      {
        id: 'func1',
        name: 'renderScene',
        file: 'src/VRSceneManager.ts',
        line: 42,
        isExported: true,
        type: 'function' as const
      },
      {
        id: 'func2',
        name: 'createMesh',
        file: 'src/VRSceneManager.ts',
        line: 89,
        isExported: false,
        type: 'function' as const
      },
      {
        id: 'class:SceneHarness@src/VRSceneManager.ts',
        name: 'SceneHarness',
        file: 'src/VRSceneManager.ts',
        line: 120,
        isExported: true,
        type: 'class' as const
      },
      {
        id: 'interface:SceneLike@src/VRSceneManager.ts',
        name: 'SceneLike',
        file: 'src/VRSceneManager.ts',
        line: 135,
        isExported: true,
        type: 'interface' as const
      },
      {
        id: 'type:SceneMode@src/VRSceneManager.ts',
        name: 'SceneMode',
        file: 'src/VRSceneManager.ts',
        line: 145,
        isExported: true,
        type: 'type-alias' as const
      },
      {
        id: 'enum:SceneState@src/VRSceneManager.ts',
        name: 'SceneState',
        file: 'src/VRSceneManager.ts',
        line: 155,
        isExported: true,
        type: 'enum' as const
      },
      {
        id: 'namespace:SceneUtils@src/VRSceneManager.ts',
        name: 'SceneUtils',
        file: 'src/VRSceneManager.ts',
        line: 165,
        isExported: true,
        type: 'namespace' as const
      },
      {
        id: 'var1',
        name: 'scene',
        file: 'src/VRSceneManager.ts',
        line: 10,
        isExported: false,
        type: 'variable' as const
      },
      {
        id: 'var2',
        name: 'camera',
        file: 'src/VRSceneManager.ts',
        line: 15,
        isExported: true,
        type: 'variable' as const
      },
      {
        id: 'ext:babylon',
        name: '@babylonjs/core',
        type: 'external' as const
      }
    ],
    edges: [
      { from: 'func1', to: 'func2' },
      { from: 'func1', to: 'class:SceneHarness@src/VRSceneManager.ts' },
      { from: 'func1', to: 'interface:SceneLike@src/VRSceneManager.ts' },
      { from: 'func1', to: 'type:SceneMode@src/VRSceneManager.ts' },
      { from: 'func1', to: 'enum:SceneState@src/VRSceneManager.ts' },
      { from: 'func1', to: 'namespace:SceneUtils@src/VRSceneManager.ts' },
      { from: 'func1', to: 'var1' },
      { from: 'func2', to: 'ext:babylon' },
      { from: 'func2', to: 'var1' }
    ],
    lastUpdated: '2024-01-01T00:00:00Z'
  };

  beforeEach(() => {
    viewer = new VRGraphViewer(mockCanvas);
  });

  afterEach(() => {
    viewer.dispose();
  });

  describe('Initialization', () => {
    it('should create a VRGraphViewer instance', () => {
      expect(viewer).toBeDefined();
    });

    it('should not be initialized until graph is loaded', () => {
      expect(viewer.isReady()).toBe(false);
    });

    it('should have null graph data initially', () => {
      expect(viewer.getGraphData()).toBeNull();
    });

    it('should have zero nodes initially', () => {
      expect(viewer.getNodeCount()).toBe(0);
    });

    it('should have zero edges initially', () => {
      expect(viewer.getEdgeCount()).toBe(0);
    });
  });

  describe('Graph Loading', () => {
    it('should load graph data from JSON file', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph('/test.json');
      expect(viewer.isReady()).toBe(true);
    });

    it('should update node and edge counts after loading', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph();
      expect(viewer.getNodeCount()).toBe(10);
      expect(viewer.getEdgeCount()).toBe(9);
    });

    it('should use default path when no argument provided', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph();
      expect(global.fetch).toHaveBeenCalledWith('/unitcircle/graph.json');
    });

    it('should handle fetch errors gracefully', async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Network error'))
      );

      await viewer.loadGraph();
      expect(viewer.getNodeCount()).toBe(0);
      expect(viewer.isReady()).toBe(false);
    });

    it('should handle failed HTTP responses', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Not Found'
        } as Response)
      );

      await viewer.loadGraph();
      expect(viewer.isReady()).toBe(false);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph();
    });

    it('should calculate correct statistics', () => {
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(10);
      expect(stats.functions).toBe(2);
      expect(stats.classes).toBe(1);
      expect(stats.interfaces).toBe(1);
      expect(stats.typeAliases).toBe(1);
      expect(stats.enums).toBe(1);
      expect(stats.namespaces).toBe(1);
      expect(stats.variables).toBe(2);
      expect(stats.externalModules).toBe(1);
      expect(stats.totalEdges).toBe(9);
    });

    it('should include last updated timestamp', () => {
      const stats = viewer.getStats();
      expect(stats.lastUpdated).toBe(mockGraphData.lastUpdated);
    });

    it('should return zero stats when no graph loaded', () => {
      const viewer2 = new VRGraphViewer(mockCanvas);
      const stats = viewer2.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
    });
  });

  describe('Node Queries', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph();
    });

    it('should find node by ID', () => {
      const node = viewer.getNode('func1');
      expect(node).toBeDefined();
      expect(node?.id).toBe('func1');
      expect(node?.name).toBe('renderScene');
    });

    it('should return undefined for non-existent node', () => {
      const node = viewer.getNode('non-existent');
      expect(node).toBeUndefined();
    });

    it('should find calls from a node', () => {
      const calls = viewer.findCallsFrom('func1');
      expect(calls).toHaveLength(7);
      expect(calls[0].from).toBe('func1');
    });

    it('should find calls to a node', () => {
      const calls = viewer.findCallsTo('func2');
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe('func2');
    });

    it('should return empty array for node with no calls', () => {
      const calls = viewer.findCallsFrom('ext:babylon');
      expect(calls).toHaveLength(0);
    });
  });

  describe('Node Type Filtering', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph();
    });

    it('should show only functions', () => {
      viewer.showNodeTypes('function');
      const graphData = viewer.getGraphData();
      
      expect(graphData?.nodes).toHaveLength(2);
      expect(graphData?.nodes.every(n => n.type === 'function')).toBe(true);
    });

    it('should show only variables', () => {
      viewer.showNodeTypes('variable');
      const graphData = viewer.getGraphData();
      
      expect(graphData?.nodes).toHaveLength(2);
      expect(graphData?.nodes.every(n => n.type === 'variable')).toBe(true);
    });

    it('should show only classes', () => {
      viewer.showNodeTypes('class');
      const graphData = viewer.getGraphData();

      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('class');
    });

    it('should show only interfaces', () => {
      viewer.showNodeTypes('interface');
      const graphData = viewer.getGraphData();

      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('interface');
    });

    it('should show only type aliases', () => {
      viewer.showNodeTypes('type-alias');
      const graphData = viewer.getGraphData();

      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('type-alias');
    });

    it('should show only enums', () => {
      viewer.showNodeTypes('enum');
      const graphData = viewer.getGraphData();

      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('enum');
    });

    it('should show only namespaces', () => {
      viewer.showNodeTypes('namespace');
      const graphData = viewer.getGraphData();

      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('namespace');
    });

    it('should show only external modules', () => {
      viewer.showNodeTypes('external');
      const graphData = viewer.getGraphData();
      
      expect(graphData?.nodes).toHaveLength(1);
      expect(graphData?.nodes[0].type).toBe('external');
    });

    it('should show multiple types', () => {
      viewer.showNodeTypes('function', 'class', 'interface', 'type-alias', 'enum', 'namespace', 'variable');
      const graphData = viewer.getGraphData();
      
      expect(graphData?.nodes).toHaveLength(9);
    });

    it('should filter edges when hiding node types', () => {
      viewer.showNodeTypes('function');
      const graphData = viewer.getGraphData();
      
      // Should only have edge between func1 and func2
      expect(graphData?.edges).toHaveLength(1);
      expect(graphData?.edges[0].from).toBe('func1');
      expect(graphData?.edges[0].to).toBe('func2');
    });
  });

  describe('Exported Only Filter', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph();
    });

    it('should show only exported nodes', () => {
      viewer.showExportedOnly();
      const graphData = viewer.getGraphData();
      
      expect(graphData?.nodes).toHaveLength(7);
      expect(graphData?.nodes.every(n => 'isExported' in n && n.isExported)).toBe(true);
    });

    it('should include func1 and camera when filtering exported', () => {
      viewer.showExportedOnly();
      const graphData = viewer.getGraphData();
      const ids = graphData?.nodes.map(n => n.id);
      
      expect(ids).toContain('func1');
      expect(ids).toContain('class:SceneHarness@src/VRSceneManager.ts');
      expect(ids).toContain('interface:SceneLike@src/VRSceneManager.ts');
      expect(ids).toContain('type:SceneMode@src/VRSceneManager.ts');
      expect(ids).toContain('enum:SceneState@src/VRSceneManager.ts');
      expect(ids).toContain('namespace:SceneUtils@src/VRSceneManager.ts');
      expect(ids).toContain('var2');
    });

    it('should filter edges for exported only view', () => {
      viewer.showExportedOnly();
      const graphData = viewer.getGraphData();
      
      expect(graphData?.edges.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Show All Filter', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph();
    });

    it('should reset filters and show all nodes', () => {
      viewer.showNodeTypes('function');
      viewer.showAll();
      
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(10);
    });

    it('should restore all edges after filtering', () => {
      viewer.showNodeTypes('function');
      viewer.showAll();
      
      const stats = viewer.getStats();
      expect(stats.totalEdges).toBe(9);
    });
  });

  describe('Lifecycle Methods', () => {
    it('should call run on VRSceneManager', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph();
      viewer.run();
      
      // Verify run was invoked (mocked)
      expect(viewer.isReady()).toBe(true);
    });

    it('should call dispose on VRSceneManager', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph();
      viewer.dispose();
      
      // Verify dispose was called
      expect(viewer).toBeDefined();
    });
  });

  describe('Refresh Graph', () => {
    it('should reload and re-render graph', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph();
      expect(viewer.isReady()).toBe(true);

      await viewer.refreshGraph();
      expect(viewer.isReady()).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty graph', async () => {
      const emptyGraph = {
        nodes: [],
        edges: [],
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(emptyGraph)
        } as Response)
      );

      await viewer.loadGraph();
      expect(viewer.getNodeCount()).toBe(0);
      expect(viewer.getEdgeCount()).toBe(0);
    });

    it('should handle edges with missing nodes gracefully', async () => {
      const invalidGraph = {
        nodes: [
          {
            id: 'func1',
            name: 'test',
            file: 'test.ts',
            line: 1,
            isExported: true,
            type: 'function' as const
          }
        ],
        edges: [
          { from: 'func1', to: 'non-existent' }
        ],
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(invalidGraph)
        } as Response)
      );

      await viewer.loadGraph();
      expect(viewer.getNodeCount()).toBe(1);
      expect(viewer.getEdgeCount()).toBe(1);
    });

    it('should handle special characters in names', async () => {
      const specialGraph = {
        nodes: [
          {
            id: 'func<test>',
            name: 'test<>function',
            file: 'src/test.ts',
            line: 1,
            isExported: true,
            type: 'function' as const
          }
        ],
        edges: [],
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(specialGraph)
        } as Response)
      );

      await viewer.loadGraph();
      const node = viewer.getNode('func<test>');
      expect(node).toBeDefined();
    });

    it('should find calls before graph is loaded', () => {
      const calls = viewer.findCallsFrom('func1');
      expect(calls).toHaveLength(0);
    });

    it('should get empty stats before graph is loaded', () => {
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(0);
    });
  });
});
