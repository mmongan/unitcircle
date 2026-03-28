/**
 * FileWatcher - Monitor src/ files and regenerate graph on changes
 * Run with: npm run watch:graph
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

class FileWatcher {
  private sourceDir: string;
  private isProcessing = false;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(sourceDir: string = '.') {
    this.sourceDir = sourceDir;
  }

  private shouldIgnoreFile(filename: string): boolean {
    const normalized = filename.replace(/\\+/g, '/');
    if (!normalized || normalized.startsWith('.')) return true;
    if (normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')) return true;
    if (normalized.includes('/.git/') || normalized.startsWith('.git/')) return true;
    if (normalized.includes('/dist/') || normalized.startsWith('dist/')) return true;
    if (normalized.includes('/coverage/') || normalized.startsWith('coverage/')) return true;
    if (normalized === 'public/graph.json' || normalized === 'public/version.json') return true;
    return false;
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
      if (!filename || this.shouldIgnoreFile(filename)) {
        return;
      }

      this.debounceRebuild();
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
      const nodeExecutable = process.execPath;
      const tsxCliPath = path.resolve('./node_modules/tsx/dist/cli.mjs');

      execFileSync(nodeExecutable, [tsxCliPath, path.resolve('./scripts/build-graph.ts')], {
        stdio: 'inherit',
        cwd: path.resolve(this.sourceDir),
      });

      const versionPath = path.resolve('./public/version.json');
      const version = JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as {
        graphNodes?: number;
        graphEdges?: number;
      };
      const duration = Date.now() - startTime;

      console.log(
        `✅ [${new Date().toLocaleTimeString()}] Graph updated: ${version.graphNodes || 0} functions, ${version.graphEdges || 0} calls (${duration}ms)`
      );
    } catch (error) {
      console.error(`❌ Error rebuilding graph:`, error);
    } finally {
      this.isProcessing = false;
    }
  }
}

// Start watching
const watcher = new FileWatcher('.');
watcher.watch();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📊 Watcher stopped');
  process.exit(0);
});
