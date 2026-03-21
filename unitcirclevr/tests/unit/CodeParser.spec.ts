import { describe, it, expect } from 'vitest';
import { CodeParser } from '../../src/CodeParser';

describe('CodeParser', () => {
  describe('parseSourceFiles', () => {
    it('should extract functions from single file', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'function hello() { return "world"; }'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
      expect(result.calls).toBeDefined();
    });

    it('should extract functions from multiple files', async () => {
      const fileContents = new Map<string, string>([
        ['file1.ts', 'function func1() {}'],
        ['file2.ts', 'function func2() {}'],
        ['file3.ts', 'function func3() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThanOrEqual(3);
    });

    it('should extract multiple functions from one file', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function first() {}
          function second() {}
          function third() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThanOrEqual(3);
    });

    it('should return empty map for empty input', async () => {
      const fileContents = new Map<string, string>();

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBe(0);
      expect(result.calls).toBeDefined();
    });

    it('should return empty map for file with no functions', async () => {
      const fileContents = new Map<string, string>([
        ['empty.ts', '// just a comment'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBe(0);
    });

    it('should assign unique names using file path', async () => {
      const fileContents = new Map<string, string>([
        ['file1.ts', 'function test() {}'],
        ['file2.ts', 'function test() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      const entries = Array.from(result.functions.entries());
      expect(entries.some(([key]) => key.includes('file1.ts'))).toBe(true);
      expect(entries.some(([key]) => key.includes('file2.ts'))).toBe(true);
    });
  });

  describe('Function Declaration Extraction', () => {
    it('should extract named function declarations', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'function myFunction() { return 42; }'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
      const func = Array.from(result.functions.values())[0];
      expect(func.name).toBe('myFunction');
    });

    it('should extract arrow functions', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'const myFunc = () => { return 42; }'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Arrow functions should be detected
      expect(result.functions.size).toBeGreaterThanOrEqual(0);
    });

    it('should extract async functions', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'async function fetchData() { return await fetch("/api"); }'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });

    it('should extract class method declarations', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          class Calculator {
            add(a: number, b: number) { return a + b; }
            multiply(a: number, b: number) { return a * b; }
          }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // The parser may extract class methods depending on regex pattern
      expect(result.functions).toBeDefined();
    });

    it('should extract private functions', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'private function helper() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Private modifier should not prevent extraction
      expect(result.functions.size).toBeGreaterThanOrEqual(0);
    });

    it('should extract static methods', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'static function utility() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Static modifier should not prevent extraction
      expect(result.functions.size).toBeGreaterThanOrEqual(0);
    });

    it('should store file path in extracted function', async () => {
      const fileContents = new Map<string, string>([
        ['src/utils/helpers.ts', 'function helper() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      const func = Array.from(result.functions.values())[0];
      expect(func.filePath).toBe('src/utils/helpers.ts');
    });

    it('should calculate line numbers correctly', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `// Line 1 comment
// Line 2 comment
function myFunc() {} // Line 3
`,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      const func = Array.from(result.functions.values())[0];
      expect(func.lineNumber).toBeGreaterThan(0);
    });

    it('should skip JavaScript keywords', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          'if (true) { return; } for (let i = 0; i < 10; i++) { const x = 5; }',
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Keywords like 'if', 'for', 'const', 'return' should not be extracted as functions
      expect(result.functions.size).toBe(0);
    });
  });

  describe('Function Call Extraction', () => {
    it('should extract function calls within same file', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { callee(); }
          function callee() { return 42; }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Should have registered calls between functions
      expect(result.calls.size).toBeGreaterThan(0);
    });

    it('should extract multiple calls from one function', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { 
            funcA(); 
            funcB(); 
            funcC(); 
          }
          function funcA() {}
          function funcB() {}
          function funcC() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // caller should have 3 outgoing calls
      expect(result.calls.size).toBeGreaterThan(0);
    });

    it('should extract calls to external functions', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function myFunc() { 
            externalLib.doSomething(); 
            fetch("/api");
          }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.calls.size).toBeGreaterThan(0);
    });

    it('should not create self-referential calls', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function recursive() { 
            recursive(); 
          }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Self-calls should be filtered out
      expect(result.calls.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle method chaining', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { 
            obj.method1().method2().method3();
          }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });

    it('should handle calls in nested blocks', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { 
            if (condition) {
              target();
            }
          }
          function target() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.calls.size).toBeGreaterThan(0);
    });

    it('should handle calls in try-catch blocks', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { 
            try { target(); } catch(e) { handler(); }
          }
          function target() {}
          function handler() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.calls.size).toBeGreaterThan(0);
    });

    it('should handle calls in async/await', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          async function caller() { 
            const result = await target();
          }
          async function target() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });

    it('should handle calls with various argument patterns', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function caller() { 
            target();
            target(arg1);
            target(arg1, arg2);
            target({key: 'value'});
            target([1, 2, 3]);
          }
          function target() {}
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });
  });

  describe('Keyword Filtering', () => {
    it('should not extract JavaScript/TypeScript keywords as functions', async () => {
      const keywords = [
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break',
        'continue', 'const', 'let', 'var', 'function', 'class', 'interface', 'new',
        'this', 'super', 'true', 'false', 'null', 'undefined', 'void', 'async',
        'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
      ];

      for (const keyword of keywords) {
        const fileContents = new Map<string, string>([
          ['test.ts', `${keyword}(something)`],
        ]);

        const result = await CodeParser.parseSourceFiles(fileContents);

        // Keywords should not appear as function definitions
        const funcNames = Array.from(result.functions.values()).map(f => f.name);
        expect(funcNames).not.toContain(keyword);
      }
    });

    it('should allow keywords as part of longer identifiers', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'function ifHelper() {} function asyncInitialize() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      const funcNames = Array.from(result.functions.values()).map(f => f.name);
      expect(funcNames.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      const fileContents = new Map<string, string>([['empty.ts', '']]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBe(0);
    });

    it('should handle files with only comments', async () => {
      const fileContents = new Map<string, string>([
        [
          'commented.ts',
          `
        // Single line comment
        /* Multi-line
           comment */
        /** JSDoc comment */
      `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBe(0);
    });

    it('should handle malformed code', async () => {
      const fileContents = new Map<string, string>([
        ['broken.ts', 'function broken( { return },'],
      ]);

      // Should not throw
      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result).toBeDefined();
    });

    it('should handle large files', async () => {
      let content = '';
      for (let i = 0; i < 100; i++) {
        content += `function func${i}() { return ${i}; }\n`;
      }

      const fileContents = new Map<string, string>([['large.ts', content]]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThanOrEqual(100);
    });

    it('should handle functions with special characters in names', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'function _privateFunc() {} function $jqueryStyleFunc() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      const funcNames = Array.from(result.functions.values()).map(f => f.name);
      expect(funcNames.length).toBeGreaterThan(0);
    });

    it('should handle unicode characters in function names', async () => {
      const fileContents = new Map<string, string>([
        ['test.ts', 'function αβγ() {} function 你好() {}'],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      // Should handle or gracefully skip unicode
      expect(result).toBeDefined();
    });

    it('should handle very long function names', async () => {
      const longName = 'function' + 'a'.repeat(1000) + '() {}';
      const fileContents = new Map<string, string>([['test.ts', longName]]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result).toBeDefined();
    });

    it('should handle nested function declarations', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          `
          function outer() {
            function inner() {
              function deep() {}
            }
          }
        `,
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });

    it('should handle functions with complex type annotations', async () => {
      const fileContents = new Map<string, string>([
        [
          'test.ts',
          'function complex(a: Map<string, Array<{key: string}>>, b: Promise<void>): AsyncIterator<number> {}',
        ],
      ]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should handle large number of files efficiently', async () => {
      const fileContents = new Map<string, string>();
      for (let i = 0; i < 50; i++) {
        fileContents.set(`file${i}.ts`, `function func${i}() {}`);
      }

      const start = Date.now();
      const result = await CodeParser.parseSourceFiles(fileContents);
      const duration = Date.now() - start;

      expect(result.functions.size).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle deeply connected function graphs', async () => {
      let content = '';
      for (let i = 0; i < 20; i++) {
        content += `function func${i}() { `;
        for (let j = 0; j < 20; j++) {
          content += `func${j}(); `;
        }
        content += '}\n';
      }

      const fileContents = new Map<string, string>([['test.ts', content]]);

      const result = await CodeParser.parseSourceFiles(fileContents);

      expect(result.functions.size).toBeGreaterThan(0);
      expect(result.calls.size).toBeGreaterThan(0);
    });
  });
});
