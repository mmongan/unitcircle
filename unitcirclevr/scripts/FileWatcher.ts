/**
 * FileWatcher - Monitor src/ files and regenerate graph on changes
 * Run with: npm run watch:graph
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodeTreeBuilder } from './CodeTreeBuilder';

class FileWatcher {
  private sourceDir: string;
  private builder: CodeTreeBuilder;
  private isProcessing = false;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(sourceDir: string = './src') {
    this.sourceDir = sourceDir;
    this.builder = new CodeTreeBuilder(sourceDir);
  }

  /**
   * Start watching the source directory
   */
  public watch(): void {
    console.log(`👀 Watching for changes in ${this.sourceDir}/...`);
    console.log('📊 Press Ctrl+C to stop\n');

    // Initial build
    this.rebuild();

    // Watch the directory
    fs.watch(this.sourceDir, { recursive: true }, (eventType, filename) => {
      if (!filename || filename.endsWith('.spec.ts') || filename.startsWith('.')) {
        return;
      }

      if (filename.endsWith('.ts')) {
        this.debounceRebuild();
      }
    });
  }

  private debounceRebuild(): void {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce rapid changes (300ms)
    this.debounceTimer = setTimeout(() => {
      this.rebuild();
    }, 300);
  }

  private rebuild(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const startTime = Date.now();
      const graph = this.builder.build();
      const duration = Date.now() - startTime;

      // Write to public folder
      const outputPath = path.resolve('./public/graph.json');
      fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));

      console.log(
        `✅ [${new Date().toLocaleTimeString()}] Graph updated: ${graph.nodes.length} functions, ${graph.edges.length} calls (${duration}ms)`
      );
    } catch (error) {
      console.error(`❌ Error rebuilding graph:`, error);
    } finally {
      this.isProcessing = false;
    }
  }
}

// Start watching
const watcher = new FileWatcher('./src');
watcher.watch();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📊 Watcher stopped');
  process.exit(0);
});
