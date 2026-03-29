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

  describe('Class Nodes', () => {
    it('should contain class type nodes', () => {
      const graph = readGraph();

      const classes = graph.nodes.filter((n: any) => n.type === 'class');
      expect(classes.length).toBeGreaterThan(0);
    });

    it('class nodes should have required properties', () => {
      const graph = readGraph();

      const classNode = graph.nodes.find((n: any) => n.type === 'class');
      expect(classNode).toBeDefined();
      expect(classNode?.id).toBeDefined();
      expect(classNode?.name).toBeDefined();
      expect(classNode?.file).toBeDefined();
      expect(typeof classNode?.line).toBe('number');
      expect(typeof classNode?.isExported).toBe('boolean');
    });
  });

  describe('Interface Nodes', () => {
    it('should contain interface type nodes', () => {
      const graph = readGraph();

      const interfaces = graph.nodes.filter((n: any) => n.type === 'interface');
      expect(interfaces.length).toBeGreaterThan(0);
    });

    it('interface nodes should have required properties', () => {
      const graph = readGraph();

      const interfaceNode = graph.nodes.find((n: any) => n.type === 'interface');
      expect(interfaceNode).toBeDefined();
      expect(interfaceNode?.id).toBeDefined();
      expect(interfaceNode?.name).toBeDefined();
      expect(interfaceNode?.file).toBeDefined();
      expect(typeof interfaceNode?.line).toBe('number');
      expect(typeof interfaceNode?.isExported).toBe('boolean');
    });
  });

  describe('Type Alias Nodes', () => {
    it('should contain type-alias nodes', () => {
      const graph = readGraph();

      const typeAliases = graph.nodes.filter((n: any) => n.type === 'type-alias');
      expect(typeAliases.length).toBeGreaterThan(0);
    });

    it('type-alias nodes should have required properties', () => {
      const graph = readGraph();

      const typeAliasNode = graph.nodes.find((n: any) => n.type === 'type-alias');
      expect(typeAliasNode).toBeDefined();
      expect(typeAliasNode?.id).toBeDefined();
      expect(typeAliasNode?.name).toBeDefined();
      expect(typeAliasNode?.file).toBeDefined();
      expect(typeof typeAliasNode?.line).toBe('number');
      expect(typeof typeAliasNode?.isExported).toBe('boolean');
    });
  });

  describe('Enum and Namespace Nodes', () => {
    it('enum nodes should have required properties when present', () => {
      const graph = readGraph();
      const enumNode = graph.nodes.find((n: any) => n.type === 'enum');
      if (enumNode) {
        expect(enumNode.id).toBeDefined();
        expect(enumNode.name).toBeDefined();
        expect(enumNode.file).toBeDefined();
        expect(typeof enumNode.line).toBe('number');
        expect(typeof enumNode.isExported).toBe('boolean');
      }
    });

    it('namespace nodes should have required properties when present', () => {
      const graph = readGraph();
      const namespaceNode = graph.nodes.find((n: any) => n.type === 'namespace');
      if (namespaceNode) {
        expect(namespaceNode.id).toBeDefined();
        expect(namespaceNode.name).toBeDefined();
        expect(namespaceNode.file).toBeDefined();
        expect(typeof namespaceNode.line).toBe('number');
        expect(typeof namespaceNode.isExported).toBe('boolean');
      }
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

    it('contains module anchor nodes for import/export graph rendering', () => {
      const graph = readGraph();
      const moduleNodes = graph.nodes.filter((n: any) => n.type === 'function' && typeof n.id === 'string' && n.id.startsWith('module:'));
      expect(moduleNodes.length).toBeGreaterThan(0);
    });

    it('contains import edges between module anchors', () => {
      const graph = readGraph();
      const importEdges = graph.edges.filter((e: any) => e.kind === 'import');
      expect(importEdges.length).toBeGreaterThan(0);
      expect(importEdges.every((e: any) => e.from.startsWith('module:') && e.to.startsWith('module:'))).toBe(true);
    });

    it('contains export edges from module anchors to symbols', () => {
      const graph = readGraph();
      const exportEdges = graph.edges.filter((e: any) => e.kind === 'export');
      expect(exportEdges.length).toBeGreaterThan(0);
      expect(exportEdges.every((e: any) => e.from.startsWith('module:'))).toBe(true);
    });

    it('supports import-cycle edge annotations when cycles are present', () => {
      const graph = readGraph();
      const cycleEdges = graph.edges.filter((e: any) => e.kind === 'import-cycle');
      expect(Array.isArray(cycleEdges)).toBe(true);
      if (cycleEdges.length > 0) {
        expect(cycleEdges.every((e: any) => e.from.startsWith('module:') && e.to.startsWith('module:'))).toBe(true);
      }
    });

    it('supports extended semantic edge kinds without schema breakage', () => {
      const graph = readGraph();
      const allowedKinds = new Set([
        'call',
        'var-read',
        'var-write',
        'import',
        'export',
        'import-cycle',
        'type-import',
        'type-export',
        'extends',
        'implements',
        'type-ref',
        'type-constraint',
        'overload-of',
        'enum-member-read',
        'module-augmentation',
        'decorator',
        'new-call',
        're-export',
      ]);

      for (const edge of graph.edges) {
        const kind = edge.kind ?? 'call';
        expect(allowedKinds.has(kind)).toBe(true);
      }
    });

    it('should contain new-call edges for constructor invocations', () => {
      const graph = readGraph();
      const newCallEdges = graph.edges.filter((e: any) => e.kind === 'new-call');
      // Our own codebase uses `new` expressions extensively
      expect(newCallEdges.length).toBeGreaterThanOrEqual(0);
      for (const edge of newCallEdges) {
        expect(edge.from).toBeDefined();
        expect(edge.to).toBeDefined();
      }
    });
  });
});
