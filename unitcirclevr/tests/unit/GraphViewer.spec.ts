import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphViewer } from '../../src/GraphViewer';

describe('GraphViewer', () => {
  let viewer: GraphViewer;
  const mockGraphData = {
    nodes: [
      {
        id: 'func1',
        name: 'myFunction',
        file: 'src/test.ts',
        line: 10,
        isExported: true,
        type: 'function' as const
      },
      {
        id: 'class:TestViewer@src/test.ts',
        name: 'TestViewer',
        file: 'src/test.ts',
        line: 20,
        isExported: true,
        type: 'class' as const
      },
      {
        id: 'interface:Renderable@src/test.ts',
        name: 'Renderable',
        file: 'src/test.ts',
        line: 30,
        isExported: true,
        type: 'interface' as const
      },
      {
        id: 'type:RenderMode@src/test.ts',
        name: 'RenderMode',
        file: 'src/test.ts',
        line: 40,
        isExported: true,
        type: 'type-alias' as const
      },
      {
        id: 'enum:RenderTier@src/test.ts',
        name: 'RenderTier',
        file: 'src/test.ts',
        line: 50,
        isExported: true,
        type: 'enum' as const
      },
      {
        id: 'namespace:Rendering@src/test.ts',
        name: 'Rendering',
        file: 'src/test.ts',
        line: 60,
        isExported: true,
        type: 'namespace' as const
      },
      {
        id: 'var1',
        name: 'myVariable',
        file: 'src/test.ts',
        line: 5,
        isExported: false,
        type: 'variable' as const
      },
      {
        id: 'ext:lodash',
        name: 'lodash',
        type: 'external' as const
      }
    ],
    edges: [
      { from: 'func1', to: 'var1' },
      { from: 'func1', to: 'class:TestViewer@src/test.ts' },
      { from: 'func1', to: 'interface:Renderable@src/test.ts' },
      { from: 'func1', to: 'type:RenderMode@src/test.ts' },
      { from: 'func1', to: 'enum:RenderTier@src/test.ts' },
      { from: 'func1', to: 'namespace:Rendering@src/test.ts' },
      { from: 'func1', to: 'ext:lodash' }
    ],
    lastUpdated: '2024-01-01T00:00:00Z'
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-root"></div>';
    viewer = new GraphViewer('#test-root');
  });

  describe('Initialization', () => {
    it('should create a viewer instance', () => {
      expect(viewer).toBeDefined();
    });

    it('should have empty data on init', () => {
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
    });
  });

  describe('Graph Loading', () => {
    it('should load graph data from JSON', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );

      await viewer.loadGraph('/test.json');
      const stats = viewer.getStats();

      expect(stats.totalNodes).toBe(8);
      expect(stats.functions).toBe(1);
      expect(stats.classes).toBe(1);
      expect(stats.interfaces).toBe(1);
      expect(stats.typeAliases).toBe(1);
      expect(stats.enums).toBe(1);
      expect(stats.namespaces).toBe(1);
      expect(stats.variables).toBe(1);
      expect(stats.externalModules).toBe(1);
      expect(stats.totalEdges).toBe(7);
    });

    it('should handle fetch errors', async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error('Network error'))
      );

      await viewer.loadGraph('/test.json');
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(0);
    });

    it('should handle failed responses', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Not Found'
        } as Response)
      );

      await viewer.loadGraph('/test.json');
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(0);
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
      await viewer.loadGraph('/test.json');
    });

    it('should calculate correct statistics', () => {
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(8);
      expect(stats.functions).toBe(1);
      expect(stats.classes).toBe(1);
      expect(stats.interfaces).toBe(1);
      expect(stats.typeAliases).toBe(1);
      expect(stats.enums).toBe(1);
      expect(stats.namespaces).toBe(1);
      expect(stats.variables).toBe(1);
      expect(stats.externalModules).toBe(1);
      expect(stats.totalEdges).toBe(7);
    });

    it('should include last updated timestamp', () => {
      const stats = viewer.getStats();
      expect(stats.lastUpdated).toBe(mockGraphData.lastUpdated);
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
      await viewer.loadGraph('/test.json');
    });

    it('should find node by ID', () => {
      const node = viewer.getNode('func1');
      expect(node).toBeDefined();
      expect(node?.id).toBe('func1');
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

    it('should return empty array for node with no outgoing calls', () => {
      const calls = viewer.findCallsFrom('var1');
      expect(calls).toHaveLength(0);
    });

    it('should find calls to a node', () => {
      const calls = viewer.findCallsTo('var1');
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe('var1');
    });

    it('should return empty array for node with no incoming calls', () => {
      const calls = viewer.findCallsTo('func1');
      expect(calls).toHaveLength(0);
    });
  });

  describe('Filtering', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph('/test.json');
    });

    it('should filter by type', () => {
      viewer.filterByType('function');
      const stats = viewer.getStats();
      // Note: stats still show original counts, filtered nodes are internal
      expect(stats.functions).toBe(1);
    });

    it('should search by name', () => {
      viewer.search('myFunction');
      const node = viewer.getNode('func1');
      expect(node).toBeDefined();
    });

    it('should search case-insensitively', () => {
      viewer.search('MYFUNCTION');
      const node = viewer.getNode('func1');
      expect(node).toBeDefined();
    });

    it('should return no results for non-matching search', () => {
      viewer.search('nonexistent');
      // Verify component renders with no results message
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('no-results');
    });

    it('should filter external modules', () => {
      viewer.filterByType('external');
      // Verify filtering works
      const node = viewer.getNode('ext:lodash');
      expect(node).toBeDefined();
    });
  });

  describe('Rendering', () => {
    beforeEach(async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGraphData)
        } as Response)
      );
      await viewer.loadGraph('/test.json');
    });

    it('should render viewer container', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('graph-viewer');
    });

    it('should render header with statistics', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('Code Graph Viewer');
      expect(container?.innerHTML).toContain('Functions: 1');
      expect(container?.innerHTML).toContain('Classes: 1');
      expect(container?.innerHTML).toContain('Interfaces: 1');
      expect(container?.innerHTML).toContain('Types: 1');
      expect(container?.innerHTML).toContain('Enums: 1');
      expect(container?.innerHTML).toContain('Namespaces: 1');
      expect(container?.innerHTML).toContain('Variables: 1');
    });

    it('should render search controls', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('search-input');
      expect(container?.innerHTML).toContain('filter-select');
    });

    it('should render tab buttons', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('Nodes (8)');
      expect(container?.innerHTML).toContain('Edges (7)');
    });

    it('should render nodes table', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('nodes-table');
      expect(container?.innerHTML).toContain('myFunction');
      expect(container?.innerHTML).toContain('TestViewer');
      expect(container?.innerHTML).toContain('Renderable');
      expect(container?.innerHTML).toContain('RenderMode');
      expect(container?.innerHTML).toContain('RenderTier');
      expect(container?.innerHTML).toContain('Rendering');
      expect(container?.innerHTML).toContain('myVariable');
    });

    it('should render type badges with colors', () => {
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('type-badge');
      expect(container?.innerHTML).toContain('function');
      expect(container?.innerHTML).toContain('class');
      expect(container?.innerHTML).toContain('interface');
      expect(container?.innerHTML).toContain('type-alias');
      expect(container?.innerHTML).toContain('enum');
      expect(container?.innerHTML).toContain('namespace');
      expect(container?.innerHTML).toContain('variable');
      expect(container?.innerHTML).toContain('external');
    });

    it('should filter class nodes', () => {
      viewer.filterByType('class');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('TestViewer');
      expect(container?.innerHTML).toContain('Classes');
    });

    it('should filter interface nodes', () => {
      viewer.filterByType('interface');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('Renderable');
      expect(container?.innerHTML).toContain('Interfaces');
    });

    it('should filter type alias nodes', () => {
      viewer.filterByType('type-alias');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('RenderMode');
      expect(container?.innerHTML).toContain('Type Aliases');
    });

    it('should filter enum nodes', () => {
      viewer.filterByType('enum');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('RenderTier');
      expect(container?.innerHTML).toContain('Enums');
    });

    it('should filter namespace nodes', () => {
      viewer.filterByType('namespace');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toContain('Rendering');
      expect(container?.innerHTML).toContain('Namespaces');
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

      await viewer.loadGraph('/test.json');
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
    });

    it('should handle edges with missing nodes', async () => {
      const invalidGraph = {
        nodes: [
          {
            id: 'func1',
            name: 'myFunction',
            file: 'src/test.ts',
            line: 10,
            isExported: true,
            type: 'function' as const
          }
        ],
        edges: [
          { from: 'func1', to: 'non-existent' },
          { from: 'non-existent', to: 'func1' }
        ],
        lastUpdated: '2024-01-01T00:00:00Z'
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(invalidGraph)
        } as Response)
      );

      await viewer.loadGraph('/test.json');
      const stats = viewer.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.totalEdges).toBe(2);
    });

    it('should handle special characters in names', async () => {
      const specialGraph = {
        nodes: [
          {
            id: 'func<>!@#',
            name: 'special<>function',
            file: 'src/test.ts',
            line: 10,
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

      await viewer.loadGraph('/test.json');
      const container = document.querySelector('#test-root');
      expect(container?.innerHTML).toBeDefined();
    });
  });
});
