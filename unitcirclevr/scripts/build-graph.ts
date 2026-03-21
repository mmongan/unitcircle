#!/usr/bin/env node

import { CodeTreeBuilder } from './CodeTreeBuilder.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const builder = new CodeTreeBuilder(path.join(__dirname, '../src'));
const graph = builder.build();

// Write to public folder
const outputPath = path.join(__dirname, '../public/graph.json');
fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));

console.log(`✓ Generated graph with ${graph.nodes.length} functions and ${graph.edges.length} calls`);
console.log(`✓ Saved to ${outputPath}`);

// Generate version/build timestamp
const versionData = {
  buildTime: new Date().toISOString(),
  buildTimestamp: Date.now()
};
const versionPath = path.join(__dirname, '../public/version.json');
fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
console.log(`✓ Build timestamp: ${versionData.buildTime}`);
