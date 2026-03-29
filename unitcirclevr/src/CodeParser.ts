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

type FunctionIndexEntry = {
  id: string;
  lineNumber: number;
};

type ParseIndexes = {
  functionsByName: Map<string, string[]>;
  functionsByFile: Map<string, FunctionIndexEntry[]>;
};

export class CodeParser {
  private static readonly FUNCTION_DECLARATION_REGEX =
    /(?:(?:private|public|static|async)\s+)*(?:function\s+([$A-Za-z_][\w$]*)|([$A-Za-z_][\w$]*)\s*\([^)]*\)\s*(?::|=))/g;

  private static readonly FUNCTION_CALL_REGEX = /([$A-Za-z_][\w$]*)\s*\(/g;

  private static readonly KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break', 'continue',
    'const', 'let', 'var', 'function', 'class', 'interface', 'new', 'this', 'super',
    'true', 'false', 'null', 'undefined', 'void', 'async', 'await', 'try', 'catch',
    'finally', 'throw', 'typeof', 'instanceof', 'delete', 'in', 'of', 'from', 'import',
    'export', 'default', 'as', 'extends', 'implements', 'abstract', 'static', 'public',
    'private', 'protected', 'readonly', 'set', 'get',
  ]);

  /**
   * Parse TypeScript source files and extract function definitions and calls
   */
  static async parseSourceFiles(fileContents: Map<string, string>): Promise<CodeGraph> {
    const functions = new Map<string, CodeFunction>();
    const calls = new Map<string, Set<string>>();
    const indexes: ParseIndexes = {
      functionsByName: new Map<string, string[]>(),
      functionsByFile: new Map<string, FunctionIndexEntry[]>(),
    };

    // Extract function definitions from files
    this.extractFunctionDefinitions(fileContents, functions, calls, indexes);

    // Extract function calls
    this.extractFunctionCalls(fileContents, calls, indexes);

    return { functions, calls };
  }

  private static extractFunctionDefinitions(
    fileContents: Map<string, string>,
    functions: Map<string, CodeFunction>,
    calls: Map<string, Set<string>>,
    indexes: ParseIndexes,
  ): void {
    for (const [filePath, content] of fileContents) {
      this.processFunctionDeclarations(filePath, content, functions, calls, indexes);
    }
  }

  private static processFunctionDeclarations(
    filePath: string,
    content: string,
    functions: Map<string, CodeFunction>,
    calls: Map<string, Set<string>>,
    indexes: ParseIndexes,
  ): void {
    const lineStarts = this.buildLineStarts(content);
    const functionMatches = content.matchAll(this.FUNCTION_DECLARATION_REGEX);

    for (const match of functionMatches) {
      const functionName = match[1] || match[2];
      const matchIndex = match.index ?? 0;
      if (functionName && !this.isKeyword(functionName)) {
        const lineNumber = this.getLineNumberFromIndex(lineStarts, matchIndex);
        const uniqueName = `${functionName}@${filePath}`;

        functions.set(uniqueName, {
          name: functionName,
          filePath,
          lineNumber,
        });
        calls.set(uniqueName, new Set());

        const byNameList = indexes.functionsByName.get(functionName) || [];
        byNameList.push(uniqueName);
        indexes.functionsByName.set(functionName, byNameList);

        const byFileList = indexes.functionsByFile.get(filePath) || [];
        byFileList.push({ id: uniqueName, lineNumber });
        indexes.functionsByFile.set(filePath, byFileList);
      }
    }

    const byFileList = indexes.functionsByFile.get(filePath);
    if (byFileList && byFileList.length > 1) {
      byFileList.sort((a, b) => a.lineNumber - b.lineNumber);
    }
  }

  private static buildLineStarts(content: string): number[] {
    const starts = [0];
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  private static getLineNumberFromIndex(lineStarts: number[], index: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= index) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return hi + 1;
  }

  private static extractFunctionCalls(
    fileContents: Map<string, string>,
    calls: Map<string, Set<string>>,
    indexes: ParseIndexes,
  ): void {
    for (const [filePath, content] of fileContents) {
      this.processFunctionCalls(filePath, content, calls, indexes);
    }
  }

  private static processFunctionCalls(
    filePath: string,
    content: string,
    calls: Map<string, Set<string>>,
    indexes: ParseIndexes,
  ): void {
    const lineStarts = this.buildLineStarts(content);
    const callMatches = content.matchAll(this.FUNCTION_CALL_REGEX);

    for (const match of callMatches) {
      const calledFunctionName = match[1];
      const matchIndex = match.index ?? 0;
      if (calledFunctionName && !this.isKeyword(calledFunctionName)) {
        const lineNumber = this.getLineNumberFromIndex(lineStarts, matchIndex);
        this.registerFunctionCall(filePath, lineNumber, calledFunctionName, calls, indexes);
      }
    }
  }

  private static registerFunctionCall(
    filePath: string,
    lineNumber: number,
    calledFunctionName: string,
    calls: Map<string, Set<string>>,
    indexes: ParseIndexes,
  ): void {
    const caller = this.findFunctionAtLine(filePath, lineNumber, indexes);

    if (caller) {
      const calledFunctions = this.findFunctionsByName(calledFunctionName, indexes);

      for (const calledName of calledFunctions) {
        if (caller !== calledName) {
          const callSet = calls.get(caller) || new Set();
          callSet.add(calledName);
          calls.set(caller, callSet);
        }
      }
    }
  }

  private static findFunctionsByName(name: string, indexes: ParseIndexes): string[] {
    return indexes.functionsByName.get(name) || [];
  }

  private static isKeyword(word: string): boolean {
    return this.KEYWORDS.has(word);
  }

  private static findFunctionAtLine(filePath: string, lineNumber: number, indexes: ParseIndexes): string | null {
    const functionsByFile = indexes.functionsByFile.get(filePath);
    if (!functionsByFile || functionsByFile.length === 0) {
      return null;
    }

    let lo = 0;
    let hi = functionsByFile.length - 1;
    let candidate: FunctionIndexEntry | null = null;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const current = functionsByFile[mid];
      if (current.lineNumber <= lineNumber) {
        candidate = current;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return candidate?.id || null;
  }
}
