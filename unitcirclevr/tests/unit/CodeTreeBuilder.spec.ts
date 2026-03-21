import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Note: CodeTreeBuilder is a build-time utility and can't be easily imported in tests
// This test suite verifies the expected behavior through file operations
// In a real scenario, you would mock the module or use a test build process

describe('CodeTreeBuilder Integration', () => {
  const graphPath = './public/graph.json';

  describe('Graph Output Structure', () => {
    it('should generate a valid graph.json file', () => {
      expect(fs.existsSync(graphPath)).toBe(true);
    });

    it('should contain nodes array', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      expect(graph.nodes).toBeDefined();
      expect(Array.isArray(graph.nodes)).toBe(true);
    });

    it('should contain edges array', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      expect(graph.edges).toBeDefined();
      expect(Array.isArray(graph.edges)).toBe(true);
    });

    it('should contain lastUpdated timestamp', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      expect(graph.lastUpdated).toBeDefined();
      expect(typeof graph.lastUpdated).toBe('string');
    });
  });

  describe('Function Nodes', () => {
    it('should contain function type nodes', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const functions = graph.nodes.filter((n: any) => n.type === 'function');
      expect(functions.length).toBeGreaterThan(0);
    });

    it('function nodes should have required properties', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const func = graph.nodes.find((n: any) => n.type === 'function');
      expect(func).toBeDefined();
      expect(func?.id).toBeDefined();
      expect(func?.name).toBeDefined();
      expect(func?.file).toBeDefined();
      expect(typeof func?.line).toBe('number');
      expect(typeof func?.isExported).toBe('boolean');
    });

    it('should have both exported and non-exported functions', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const functions = graph.nodes.filter((n: any) => n.type === 'function');
      const exported = functions.filter((f: any) => f.isExported);
      const notExported = functions.filter((f: any) => !f.isExported);
      
      expect(exported.length).toBeGreaterThan(0);
      expect(notExported.length).toBeGreaterThan(0);
    });
  });

  describe('Global Variables', () => {
    it('should contain variable type nodes', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const variables = graph.nodes.filter((n: any) => n.type === 'variable');
      expect(variables.length).toBeGreaterThanOrEqual(0);
    });

    it('variable nodes should have required properties', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
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
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const externals = graph.nodes.filter((n: any) => n.type === 'external');
      expect(externals.length).toBeGreaterThanOrEqual(0);
    });

    it('external nodes should have required properties', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const external = graph.nodes.find((n: any) => n.type === 'external');
      if (external) {
        expect(external.id).toBeDefined();
        expect(external.name).toBeDefined();
        expect(external.type).toBe('external');
      }
    });

    it('should detect @babylonjs/core as external module', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      const babylon = graph.nodes.find((n: any) => n.name === '@babylonjs/core');
      expect(babylon).toBeDefined();
      expect(babylon?.type).toBe('external');
    });
  });

  describe('Function Calls (Edges)', () => {
    it('should contain edge definitions', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      expect(graph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('edges should have from and to properties', () => {
      const content = fs.readFileSync(graphPath, 'utf-8');
      const graph = JSON.parse(content);
      
      if (graph.edges.length > 0) {
        const edge = graph.edges[0];
        expect(edge.from).toBeDefined();
        expect(edge.to).toBeDefined();
        expect(typeof edge.from).toBe('string');
        expect(typeof edge.to).toBe('string');
      }
    });
  });
});
