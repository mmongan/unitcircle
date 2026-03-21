/**
 * CodeParser - Extracts functions and their call relationships from TypeScript code
 */

export interface CodeFunction {
  name: string;
  filePath: string;
  lineNumber: number;
}

export interface CodeGraph {
  functions: Map<string, CodeFunction>;
  calls: Map<string, Set<string>>;
}

export class CodeParser {
  /**
   * Parse TypeScript source files and extract function definitions and calls
   */
  static async parseSourceFiles(fileContents: Map<string, string>): Promise<CodeGraph> {
    const functions = new Map<string, CodeFunction>();
    const calls = new Map<string, Set<string>>();

    // Extract function definitions from files
    this.extractFunctionDefinitions(fileContents, functions, calls);
    
    // Extract function calls
    this.extractFunctionCalls(fileContents, functions, calls);

    return { functions, calls };
  }

  private static extractFunctionDefinitions(fileContents: Map<string, string>, functions: Map<string, CodeFunction>, calls: Map<string, Set<string>>): void {
    for (const [filePath, content] of fileContents) {
      this.processFunctionDeclarations(filePath, content, functions, calls);
    }
  }

  private static processFunctionDeclarations(filePath: string, content: string, functions: Map<string, CodeFunction>, calls: Map<string, Set<string>>): void {
    const functionMatches = content.matchAll(/(?:(?:private|public|static|async)\s+)*(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?::|=))/g);

    for (const match of functionMatches) {
      const functionName = match[1] || match[2];
      if (functionName && !this.isKeyword(functionName)) {
        const lineNumber = this.calculateLineNumber(content, match.index!);
        const uniqueName = `${functionName}@${filePath}`;
        functions.set(uniqueName, { name: functionName, filePath, lineNumber });
        calls.set(uniqueName, new Set());
      }
    }
  }

  private static calculateLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  private static extractFunctionCalls(fileContents: Map<string, string>, functions: Map<string, CodeFunction>, calls: Map<string, Set<string>>): void {
    for (const [filePath, content] of fileContents) {
      this.processFunctionCalls(filePath, content, functions, calls);
    }
  }

  private static processFunctionCalls(filePath: string, content: string, functions: Map<string, CodeFunction>, calls: Map<string, Set<string>>): void {
    const callMatches = content.matchAll(/(\w+)\s*\(/g);
    for (const match of callMatches) {
      const calledFunctionName = match[1];
      if (calledFunctionName && !this.isKeyword(calledFunctionName)) {
        const lineNumber = this.calculateLineNumber(content, match.index!);
        this.registerFunctionCall(filePath, lineNumber, calledFunctionName, functions, calls);
      }
    }
  }

  private static registerFunctionCall(filePath: string, lineNumber: number, calledFunctionName: string, functions: Map<string, CodeFunction>, calls: Map<string, Set<string>>): void {
    const caller = this.findFunctionAtLine(filePath, lineNumber, functions);

    if (caller && functions.has(caller)) {
      const calledFunctions = this.findFunctionsByName(calledFunctionName, functions);

      for (const calledName of calledFunctions) {
        if (caller !== calledName) {
          const callSet = calls.get(caller) || new Set();
          callSet.add(calledName);
          calls.set(caller, callSet);
        }
      }
    }
  }

  private static findFunctionsByName(name: string, functions: Map<string, CodeFunction>): string[] {
    return Array.from(functions.entries())
      .filter(([_, func]) => func.name === name)
      .map(([funcId]) => funcId);
  }

  private static isKeyword(word: string): boolean {
    const keywords = [
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break', 'continue',
      'const', 'let', 'var', 'function', 'class', 'interface', 'new', 'this', 'super',
      'true', 'false', 'null', 'undefined', 'void', 'async', 'await', 'try', 'catch',
      'finally', 'throw', 'typeof', 'instanceof', 'delete', 'in', 'of', 'from', 'import',
      'export', 'default', 'as', 'extends', 'implements', 'abstract', 'static', 'public',
      'private', 'protected', 'readonly', 'set', 'get'
    ];
    return keywords.includes(word);
  }

  private static findFunctionAtLine(filePath: string, lineNumber: number, functions: Map<string, CodeFunction>): string | null {
    const functionsByFile = Array.from(functions.entries()).filter(
      ([_, func]) => func.filePath === filePath && func.lineNumber <= lineNumber
    );

    if (functionsByFile.length === 0) return null;

    // Return the most recent function definition before this line
    return functionsByFile.sort((a, b) => b[1].lineNumber - a[1].lineNumber)[0][0];
  }
}
