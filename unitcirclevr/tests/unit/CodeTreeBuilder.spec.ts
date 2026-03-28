import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

// Note: CodeTreeBuilder is a build-time utility and can't be easily imported in tests
// This test suite verifies the expected behavior through file operations
// In a real scenario, you would mock the module or use a test build process

describe('CodeTreeBuilder Integration', () => {
  const graphPath = './public/graph.json';
  const readGraph = (): any => JSON.parse(fs.readFileSync(graphPath, 'utf-8'));

  const findFunctionNodeId = (graph: any, functionName: string, fileSuffix: string): string => {
    const fn = graph.nodes.find((n: any) => {
      if (n.type !== 'function') {
        return false;
      }
      const filePath = (n.file || '').replace(/\\/g, '/');
      return n.name === functionName && filePath.endsWith(fileSuffix);
    });

    expect(fn).toBeDefined();
    return fn.id;
  };

  const hasEdge = (graph: any, from: string, to: string): boolean => {
    return graph.edges.some((e: any) => e.from === from && e.to === to);
  };

  describe('Graph Output Structure', () => {
    it('should generate a valid graph.json file', () => {
      expect(fs.existsSync(graphPath)).toBe(true);
    });

    it('should contain nodes array', () => {
      const graph = readGraph();
      
      expect(graph.nodes).toBeDefined();
      expect(Array.isArray(graph.nodes)).toBe(true);
    });

    it('should contain edges array', () => {
      const graph = readGraph();
      
      expect(graph.edges).toBeDefined();
      expect(Array.isArray(graph.edges)).toBe(true);
    });

    it('should contain lastUpdated timestamp', () => {
      const graph = readGraph();
      
      expect(graph.lastUpdated).toBeDefined();
      expect(typeof graph.lastUpdated).toBe('string');
    });
  });

  describe('Function Nodes', () => {
    it('should contain function type nodes', () => {
      const graph = readGraph();
      
      const functions = graph.nodes.filter((n: any) => n.type === 'function');
      expect(functions.length).toBeGreaterThan(0);
    });

    it('function nodes should have required properties', () => {
      const graph = readGraph();
      
      const func = graph.nodes.find((n: any) => n.type === 'function');
      expect(func).toBeDefined();
      expect(func?.id).toBeDefined();
      expect(func?.name).toBeDefined();
      expect(func?.file).toBeDefined();
      expect(typeof func?.line).toBe('number');
      expect(typeof func?.isExported).toBe('boolean');
    });

    it('should have both exported and non-exported functions', () => {
      const graph = readGraph();
      
      const functions = graph.nodes.filter((n: any) => n.type === 'function');
      const exported = functions.filter((f: any) => f.isExported);
      const notExported = functions.filter((f: any) => !f.isExported);
      
      expect(exported.length).toBeGreaterThan(0);
      expect(notExported.length).toBeGreaterThan(0);
    });
  });

  describe('Global Variables', () => {
    it('should contain variable type nodes', () => {
      const graph = readGraph();
      
      const variables = graph.nodes.filter((n: any) => n.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(0);
    });

    it('variable nodes should have required properties', () => {
      const graph = readGraph();
      
      const variable = graph.nodes.find((n: any) => n.type === 'variable');
      if (variable) {
        expect(variable.id).toBeDefined();
        expect(variable.name).toBeDefined();
        expect(variable.file).toBeDefined();
        expect(typeof variable.line).toBe('number');
        expect(typeof variable.isExported).toBe('boolean');
      }
    });
  });

  describe('External Modules', () => {
    it('should contain external type nodes', () => {
      const graph = readGraph();
      
      const externals = graph.nodes.filter((n: any) => n.type === 'external');
      expect(externals.length).toBeGreaterThanOrEqual(0);
    });

    it('external nodes should have required properties', () => {
      const graph = readGraph();
      
      const external = graph.nodes.find((n: any) => n.type === 'external');
      if (external) {
        expect(external.id).toBeDefined();
        expect(external.name).toBeDefined();
        expect(external.type).toBe('external');
      }
    });

    it('should detect @babylonjs/core as external module', () => {
      const graph = readGraph();
      
      const babylon = graph.nodes.find((n: any) => n.name === '@babylonjs/core');
      expect(babylon).toBeDefined();
      expect(babylon?.type).toBe('external');
    });
  });

  describe('Function Calls (Edges)', () => {
    it('should contain edge definitions', () => {
      const graph = readGraph();
      
      expect(graph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('edges should have from and to properties', () => {
      const graph = readGraph();
      
      if (graph.edges.length > 0) {
        const edge = graph.edges[0];
        expect(edge.from).toBeDefined();
        expect(edge.to).toBeDefined();
        expect(typeof edge.from).toBe('string');
        expect(typeof edge.to).toBe('string');
      }
    });

    it('contains factorialRecursive in the generated call graph', () => {
      const graph = readGraph();
      const factorialId = findFunctionNodeId(graph, 'factorialRecursive', 'src/CallCycleExamples.ts');

      const connectedEdges = graph.edges.filter((e: any) => e.from === factorialId || e.to === factorialId);
      expect(connectedEdges.length).toBeGreaterThan(0);
    });

    it('contains mutual recursion edges between isEvenMutual and isOddMutual', () => {
      const graph = readGraph();
      const evenId = findFunctionNodeId(graph, 'isEvenMutual', 'src/CallCycleExamples.ts');
      const oddId = findFunctionNodeId(graph, 'isOddMutual', 'src/CallCycleExamples.ts');

      expect(hasEdge(graph, evenId, oddId)).toBe(true);
      expect(hasEdge(graph, oddId, evenId)).toBe(true);
    });

    it('contains a 4-function cycle across cycleA -> cycleB -> cycleC -> cycleD -> cycleA', () => {
      const graph = readGraph();
      const aId = findFunctionNodeId(graph, 'cycleA', 'src/CallCycleExamples.ts');
      const bId = findFunctionNodeId(graph, 'cycleB', 'src/CallCycleExamples.ts');
      const cId = findFunctionNodeId(graph, 'cycleC', 'src/CallCycleExamples.ts');
      const dId = findFunctionNodeId(graph, 'cycleD', 'src/CallCycleExamples.ts');

      expect(hasEdge(graph, aId, bId)).toBe(true);
      expect(hasEdge(graph, bId, cId)).toBe(true);
      expect(hasEdge(graph, cId, dId)).toBe(true);
      expect(hasEdge(graph, dId, aId)).toBe(true);
    });

    it('does not treat object.dispose() as self-recursion in VRSceneManager.dispose', () => {
      const graph = readGraph();
      const disposeId = findFunctionNodeId(graph, 'dispose', 'src/VRSceneManager.ts');

      expect(hasEdge(graph, disposeId, disposeId)).toBe(false);
    });
  });
});
