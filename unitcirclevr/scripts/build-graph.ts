#!/usr/bin/env node

import { CodeTreeBuilder } from './CodeTreeBuilder.ts';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(__dirname, '../public');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('\n🔄 Building fresh code graph from source...\n');

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

  // Add timestamp to ensure all updates are processed
  const timestamp = new Date().toISOString();
  graph.lastUpdated = timestamp;

  // Write graph.json (overwrite completely for fresh build)
  const graphPath = path.join(publicDir, 'graph.json');
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
  const versionPath = path.join(publicDir, 'version.json');
  fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
  console.log(`✓ Build timestamp: ${timestamp}`);
  
  console.log('\n✅ Graph build complete and complete!\n');
  process.exit(0);
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Graph build failed: ${errorMsg}\n`);
  process.exit(1);
}
