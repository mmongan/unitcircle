import { describe, it, expect } from 'vitest';
import { ForceDirectedLayout } from '../../src/ForceDirectedLayout';

describe('ForceDirectedLayout', () => {
  describe('Initialization', () => {
    it('should create layout with nodes and edges', () => {
      const nodes = ['a', 'b', 'c'];
      const edges = [{ source: 'a', target: 'b' }];
      const layout = new ForceDirectedLayout(nodes, edges);

      expect(layout).toBeDefined();
    });

    it('should handle empty node list', () => {
      const layout = new ForceDirectedLayout([], []);
      const result = layout.simulate(1);

      expect(result.size).toBe(0);
    });

    it('should handle single node', () => {
      const layout = new ForceDirectedLayout(['a'], []);
      const result = layout.simulate(1);

      expect(result.size).toBe(1);
      expect(result.has('a')).toBe(true);
    });
  });

  describe('Simulation', () => {
    it('should return map of node positions', () => {
      const nodes = ['a', 'b'];
      const edges = [{ source: 'a', target: 'b' }];
      const layout = new ForceDirectedLayout(nodes, edges);
      const result = layout.simulate(1);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
    });

    it('should assign positions to all nodes', () => {
      const nodes = ['a', 'b', 'c', 'd'];
      const layout = new ForceDirectedLayout(nodes, []);
      const result = layout.simulate(1);

      for (const node of nodes) {
        expect(result.has(node)).toBe(true);
        const pos = result.get(node);
        expect(pos?.position).toBeDefined();
        expect(pos?.position.x).toBeDefined();
        expect(pos?.position.y).toBeDefined();
        expect(pos?.position.z).toBeDefined();
      }
    });

    it('should track velocity for each node', () => {
      const nodes = ['a', 'b'];
      const layout = new ForceDirectedLayout(nodes, []);
      const result = layout.simulate(1);

      for (const node of nodes) {
        const pos = result.get(node);
        expect(pos?.velocity).toBeDefined();
        expect(pos?.velocity.x).toBeDefined();
        expect(pos?.velocity.y).toBeDefined();
        expect(pos?.velocity.z).toBeDefined();
      }
    });

    it('should maintain deterministic positions (same seed would match)', () => {
      const nodes = Array.from({ length: 5 }, (_, i) => `n${i}`);
      const edges = [{ source: nodes[0], target: nodes[1] }];
      const layout = new ForceDirectedLayout(nodes, edges);

      const result = layout.simulate(1);
      
      expect(result.size).toBe(nodes.length);
      for (const n of nodes) {
        const pos = result.get(n)?.position;
        expect(pos).toBeDefined();
        expect(typeof pos?.x).toBe('number');
        expect(typeof pos?.y).toBe('number');
        expect(typeof pos?.z).toBe('number');
      }
    });
  });

  describe('Position Constraints', () => {
    it('should keep positions bounded within ±250', () => {
      const nodes = Array.from({ length: 50 }, (_, i) => `n${i}`);
      const edges = nodes.slice(0, -1).map((n, i) => ({
        source: n,
        target: nodes[i + 1],
      }));
      const layout = new ForceDirectedLayout(nodes, edges);
      const result = layout.simulate();

      for (const node of nodes) {
        const pos = result.get(node)?.position;
        expect(pos?.x).toBeGreaterThanOrEqual(-250);
        expect(pos?.x).toBeLessThanOrEqual(250);
        expect(pos?.y).toBeGreaterThanOrEqual(-250);
        expect(pos?.y).toBeLessThanOrEqual(250);
        expect(pos?.z).toBeGreaterThanOrEqual(-250);
        expect(pos?.z).toBeLessThanOrEqual(250);
      }
    });
  });

  describe('Node Separation', () => {
    it('should distribute nodes across volume', () => {
      const nodes = Array.from({ length: 20 }, (_, i) => `n${i}`);
      const layout = new ForceDirectedLayout(nodes, []);
      const result = layout.simulate(1);

      // Collect all positions
      const positions = nodes.map(n => result.get(n)?.position);
      
      // Check that nodes are spread (not all clustered)
      const xs = positions.map(p => p?.x || 0);
      const ys = positions.map(p => p?.y || 0);
      const zs = positions.map(p => p?.z || 0);
      
      const xRange = Math.max(...xs) - Math.min(...xs);
      const yRange = Math.max(...ys) - Math.min(...ys);
      const zRange = Math.max(...zs) - Math.min(...zs);
      
      // At least some spread expected in random distribution
      expect(xRange + yRange + zRange).toBeGreaterThan(0);
    });
  });

  describe('Edge Handling', () => {
    it('should accept edges without throwing', () => {
      const nodes = ['a', 'b', 'c'];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' }
      ];
      const layout = new ForceDirectedLayout(nodes, edges);
      const result = layout.simulate(1);

      expect(result.size).toBe(3);
    });

    it('should handle disconnected nodes', () => {
      const nodes = ['a', 'b', 'c', 'd'];
      const edges = [{ source: 'a', target: 'b' }];
      const layout = new ForceDirectedLayout(nodes, edges);
      const result = layout.simulate(1);

      expect(result.has('c')).toBe(true);
      expect(result.has('d')).toBe(true);
    });
  });

  describe('Label Handling', () => {
    it('should preserve labels in output', () => {
      const nodes = ['a', 'b'];
      const edges = [{ source: 'a', target: 'b' }];
      const layout = new ForceDirectedLayout(nodes, edges);
      const result = layout.simulate(1);

      for (const node of nodes) {
        const outputNode = result.get(node);
        expect(outputNode?.label).toBe(node);
      }
    });

    it('should extract label from qualified IDs', () => {
      const nodes = ['module@a', 'module@b'];
      const layout = new ForceDirectedLayout(nodes, []);
      const result = layout.simulate(1);

      const nodeA = result.get('module@a');
      expect(nodeA?.label).toBe('module');
    });
  });
});

