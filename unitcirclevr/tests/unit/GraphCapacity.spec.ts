import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Graph capacity estimation', () => {
  it('estimates safe maximum nodes and edges from current graph size', async () => {
    const graphPath = resolve(process.cwd(), 'public', 'graph.json');
    const graphRaw = await readFile(graphPath, 'utf-8');
    const graph = JSON.parse(graphRaw) as { nodes: unknown[]; edges: unknown[] };

    const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;

    // Conservative capacity targets for future growth.
    const estimatedMaxNodes = Math.max(200, Math.ceil((nodeCount * 1.5) + 100));
    const estimatedMaxEdges = Math.max(400, Math.ceil((edgeCount * 1.75) + nodeCount));

    expect(nodeCount).toBeGreaterThan(0);
    expect(edgeCount).toBeGreaterThan(0);
    expect(estimatedMaxNodes).toBeGreaterThan(nodeCount);
    expect(estimatedMaxEdges).toBeGreaterThan(edgeCount);

    // Keep ratio sanity so edge estimate is not undersized for dense graphs.
    const estimatedEdgePerNode = estimatedMaxEdges / estimatedMaxNodes;
    expect(estimatedEdgePerNode).toBeGreaterThan(1.0);
  });
});
