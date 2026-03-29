#!/usr/bin/env node

import { CodeTreeBuilder } from './CodeTreeBuilder.ts';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import type { GraphData } from '../src/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(__dirname, '../public');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('\n🔄 Building fresh code graph from source...\n');

const graphPath = path.join(publicDir, 'graph.json');
const versionPath = path.join(publicDir, 'version.json');

function computeGraphSignature(graph: GraphData): string {
  let hash = 2166136261;
  const append = (value: string): void => {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };

  const nodes = [...(graph.nodes || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of nodes) {
    append(`n|${node.id}|${node.file || ''}|${node.line || 0}|${node.isExported ? 1 : 0}|${node.type || ''}|${node.code || ''}`);
  }

  const edges = [...(graph.edges || [])].sort((a, b) => {
    if (a.from === b.from) {
      if (a.to === b.to) {
        return (a.kind || 'call').localeCompare(b.kind || 'call');
      }
      return a.to.localeCompare(b.to);
    }
    return a.from.localeCompare(b.from);
  });
  for (const edge of edges) {
    append(`e|${edge.from}|${edge.to}|${edge.kind || 'call'}`);
  }

  const files = [...(graph.files || [])].sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    append(`f|${file}`);
  }

  return String(hash >>> 0);
}

function loadExistingGraph(): GraphData | null {
  try {
    if (!fs.existsSync(graphPath)) {
      return null;
    }
    const raw = fs.readFileSync(graphPath, 'utf-8');
    return JSON.parse(raw) as GraphData;
  } catch {
    return null;
  }
}

try {
  // Build a fresh complete graph from current source
  const builder = new CodeTreeBuilder(projectRoot);
  const graph = builder.build();

  // Validate graph completeness
  if (!graph.nodes || graph.nodes.length === 0) {
    throw new Error('Graph is empty - no code nodes were extracted');
  }

  if (!graph.edges) {
    throw new Error('Graph edges are missing');
  }

  const existingGraph = loadExistingGraph();
  const nextSignature = computeGraphSignature(graph);
  const previousSignature = existingGraph ? computeGraphSignature(existingGraph) : '';

  if (existingGraph && nextSignature === previousSignature) {
    console.log(`✓ Graph unchanged (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
    console.log('✓ Skipped writing graph.json/version.json to avoid timestamp-only refreshes');
    console.log('\n✅ Graph build complete (no changes)\n');
    process.exit(0);
  }

  // Add timestamp only when graph content actually changed.
  const timestamp = new Date().toISOString();
  graph.lastUpdated = timestamp;

  // Write graph.json (overwrite completely for fresh build)
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  console.log(`✓ Generated graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
  console.log(`✓ Saved to ${graphPath}`);

  // Generate version/build timestamp
  const versionData = {
    buildTime: timestamp,
    buildTimestamp: Date.now(),
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length
  };
  fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
  console.log(`✓ Build timestamp: ${timestamp}`);
  
  console.log('\n✅ Graph build complete and complete!\n');
  process.exit(0);
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Graph build failed: ${errorMsg}\n`);
  process.exit(1);
}
