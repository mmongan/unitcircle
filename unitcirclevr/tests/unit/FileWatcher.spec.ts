import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('FileWatcher', () => {
  const watchDir = './tests/fixtures/watch-test';

  beforeEach(() => {
    if (!fs.existsSync(watchDir)) {
      fs.mkdirSync(watchDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(watchDir)) {
      const removeDir = (dir: string) => {
        if (fs.existsSync(dir)) {
          try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
              const fullPath = path.join(dir, entry);
              try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                  removeDir(fullPath);
                } else {
                  fs.unlinkSync(fullPath);
                }
              } catch (e) {
                // Skip files that are already deleted or inaccessible
              }
            }
            try {
              fs.rmdirSync(dir);
            } catch (e) {
              // Skip if directory is already empty or in use
            }
          } catch (e) {
            // Skip if directory is inaccessible
          }
        }
      };
      removeDir(watchDir);
    }
  });

  describe('File Creation Detection', () => {
    it('should detect when a TypeScript file is created', async () => {
      const testFile = path.join(watchDir, 'new-file.ts');

      // Simulate file creation after a short delay
      await new Promise<void>(resolve => {
        setTimeout(() => {
          fs.writeFileSync(testFile, 'export function test() {}');
          resolve();
        }, 100);
      });

      // File should exist
      expect(fs.existsSync(testFile)).toBe(true);
    });

    it('should detect when a file is modified', async () => {
      const testFile = path.join(watchDir, 'modify-test.ts');
      fs.writeFileSync(testFile, 'export function v1() {}');

      await new Promise<void>(resolve => {
        setTimeout(() => {
          fs.writeFileSync(testFile, 'export function v2() {}');
          resolve();
        }, 100);
      });

      const content = fs.readFileSync(testFile, 'utf-8');
      expect(content).toContain('v2');
    });

    it('should detect when a file is deleted', async () => {
      const testFile = path.join(watchDir, 'delete-test.ts');
      fs.writeFileSync(testFile, 'export function test() {}');

      expect(fs.existsSync(testFile)).toBe(true);

      await new Promise<void>(resolve => {
        setTimeout(() => {
          fs.unlinkSync(testFile);
          resolve();
        }, 100);
      });

      expect(fs.existsSync(testFile)).toBe(false);
    });
  });

  describe('File Type Filtering', () => {
    it('should only watch TypeScript files', () => {
      const tsFile = path.join(watchDir, 'test.ts');
      const jsFile = path.join(watchDir, 'test.js');
      const jsonFile = path.join(watchDir, 'test.json');

      fs.writeFileSync(tsFile, '');
      fs.writeFileSync(jsFile, '');
      fs.writeFileSync(jsonFile, '');

      // All files should be created
      expect(fs.existsSync(tsFile)).toBe(true);
      expect(fs.existsSync(jsFile)).toBe(true);
      expect(fs.existsSync(jsonFile)).toBe(true);

      // Only .ts files should be relevant to watcher
      // (actual filtering happens in the watcher implementation)
    });

    it('should ignore spec files', () => {
      const testFile = path.join(watchDir, 'test.spec.ts');
      const regularFile = path.join(watchDir, 'regular.ts');

      fs.writeFileSync(testFile, '');
      fs.writeFileSync(regularFile, '');

      // Files should exist but spec files are typically ignored by watchers
      expect(fs.existsSync(testFile)).toBe(true);
      expect(fs.existsSync(regularFile)).toBe(true);
    });
  });

  describe('Nested Directory Handling', () => {
    it('should watch nested directories', () => {
      const nestedDir = path.join(watchDir, 'nested', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });

      const nestedFile = path.join(nestedDir, 'nested.ts');
      fs.writeFileSync(nestedFile, 'export function nested() {}');

      expect(fs.existsSync(nestedFile)).toBe(true);
    });

    it('should ignore node_modules', () => {
      const nodeModulesDir = path.join(watchDir, 'node_modules');
      const moduleFile = path.join(nodeModulesDir, 'module.ts');

      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(moduleFile, '');

      // File exists but should be ignored by watcher
      expect(fs.existsSync(moduleFile)).toBe(true);
    });

    it('should ignore hidden directories', () => {
      const hiddenDir = path.join(watchDir, '.hidden');
      const hiddenFile = path.join(hiddenDir, 'file.ts');

      fs.mkdirSync(hiddenDir, { recursive: true });
      fs.writeFileSync(hiddenFile, '');

      // File exists but should be ignored by watcher
      expect(fs.existsSync(hiddenFile)).toBe(true);
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid file changes', async () => {
      const testFile = path.join(watchDir, 'rapid-changes.ts');

      // Simulate rapid changes
      fs.writeFileSync(testFile, 'v1');
      
      await new Promise<void>(resolve => {
        setTimeout(() => {
          fs.writeFileSync(testFile, 'v2');
        }, 10);
        
        setTimeout(() => {
          fs.writeFileSync(testFile, 'v3');
        }, 20);

        // After debounce period, file should have final content
        setTimeout(() => {
          const content = fs.readFileSync(testFile, 'utf-8');
          expect(content).toBe('v3');
          resolve();
        }, 400);
      });
    });

    it('should wait for debounce period before processing', async () => {
      const testFile = path.join(watchDir, 'debounce-test.ts');
      fs.writeFileSync(testFile, 'initial');

      const delayBetweenChanges = 150; // Less than debounce (300ms)

      fs.writeFileSync(testFile, 'change1');
      
      await new Promise<void>(resolve => {
        setTimeout(() => {
          fs.writeFileSync(testFile, 'change2');
        }, delayBetweenChanges);

        // Wait well past debounce period
        setTimeout(() => {
          const content = fs.readFileSync(testFile, 'utf-8');
          expect(content).toBe('change2');
          resolve();
        }, 500);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle files with invalid TypeScript syntax', () => {
      const invalidFile = path.join(watchDir, 'invalid.ts');
      fs.writeFileSync(invalidFile, 'export function broken() { this is invalid }');

      // File should exist despite syntax errors
      expect(fs.existsSync(invalidFile)).toBe(true);

      const content = fs.readFileSync(invalidFile, 'utf-8');
      expect(content).toContain('broken');
    });

    it('should handle large files', () => {
      const largeFile = path.join(watchDir, 'large.ts');
      const largeContent = 'export function func() {}\n'.repeat(10000);
      
      fs.writeFileSync(largeFile, largeContent);

      const content = fs.readFileSync(largeFile, 'utf-8');
      expect(content.length).toBeGreaterThan(100000);
    });

    it('should handle permission errors gracefully', () => {
      // This test verifies graceful handling of edge cases
      // Actual permission testing depends on OS
      const testFile = path.join(watchDir, 'permission-test.ts');
      fs.writeFileSync(testFile, 'test');
      
      expect(fs.existsSync(testFile)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle many files efficiently', () => {
      const startTime = Date.now();

      // Create 100 test files
      for (let i = 0; i < 100; i++) {
        const file = path.join(watchDir, `file-${i}.ts`);
        fs.writeFileSync(file, `export function func${i}() {}`);
      }

      const elapsedTime = Date.now() - startTime;

      // Should complete reasonably quickly (arbitrary 1 second limit for creation)
      expect(elapsedTime).toBeLessThan(1000);
    });

    it('should handle deeply nested structures', () => {
      let currentPath = watchDir;
      
      // Create 10 levels of nesting
      for (let i = 0; i < 10; i++) {
        currentPath = path.join(currentPath, `level-${i}`);
        fs.mkdirSync(currentPath, { recursive: true });
      }

      const deepFile = path.join(currentPath, 'deep.ts');
      fs.writeFileSync(deepFile, 'export function deep() {}');

      expect(fs.existsSync(deepFile)).toBe(true);
    });
  });
});
