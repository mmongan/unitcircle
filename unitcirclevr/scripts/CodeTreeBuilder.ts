/**
 * CodeTreeBuilder - Build-time AST parser to extract function relationships
 * Uses TypeScript compiler API for accurate code analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface FunctionNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'function';
}

export interface GlobalVariable {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'variable';
}

export interface ExternalModule {
  id: string;
  name: string;
  type: 'external';
}

export type CodeNode = FunctionNode | GlobalVariable | ExternalModule;

export interface FunctionCall {
  from: string;
  to: string;
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: FunctionCall[];
  lastUpdated: string;
}

export class CodeTreeBuilder {
  private sourceDir: string;
  private functions: Map<string, FunctionNode> = new Map();
  private variables: Map<string, GlobalVariable> = new Map();
  private externalModules: Map<string, ExternalModule> = new Map();
  private calls: FunctionCall[] = [];

  constructor(sourceDir: string = './src') {
    this.sourceDir = sourceDir;
  }

  /**
   * Build the code tree by analyzing all TypeScript files
   */
  public build(): CodeGraph {
    // Clear all maps for fresh graph generation
    this.functions.clear();
    this.variables.clear();
    this.externalModules.clear();
    this.calls = [];

    // Get all TypeScript files
    const files = this.getAllTypeScriptFiles(this.sourceDir);
    
    if (files.length === 0) {
      throw new Error(`No TypeScript files found in ${this.sourceDir}`);
    }

    console.log(`📊 Scanning ${files.length} TypeScript files...`);

    // TWO-PASS APPROACH
    // Pass 1: Extract all function and variable declarations
    const sourceFiles: Array<{ filePath: string; sourceFile: ts.SourceFile; source: string }> = [];
    const parseErrors: Array<{ filePath: string; error: string }> = [];
    
    for (const filePath of files) {
      try {
        const source = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = ts.createSourceFile(
          filePath,
          source,
          ts.ScriptTarget.Latest,
          true
        );
        sourceFiles.push({ filePath, sourceFile, source });
        this.visitDeclarations(sourceFile, filePath);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        parseErrors.push({ filePath, error: errorMsg });
        console.error(`❌ Failed to parse ${filePath}: ${errorMsg}`);
      }
    }

    // If critical files failed to parse, the graph is incomplete
    if (parseErrors.length > 0) {
      const errorSummary = parseErrors.map(e => `  - ${e.filePath}: ${e.error}`).join('\n');
      throw new Error(
        `Failed to parse ${parseErrors.length} file(s). Graph is incomplete:\n${errorSummary}`
      );
    }

    // Pass 2: Extract all function calls
    for (const { filePath, sourceFile } of sourceFiles) {
      this.visitCalls(sourceFile, filePath);
    }

    const nodes: CodeNode[] = [
      ...Array.from(this.functions.values()),
      ...Array.from(this.variables.values()),
      ...Array.from(this.externalModules.values())
    ];

    console.log(`✓ Extracted ${this.functions.size} functions, ${this.variables.size} variables, ${this.externalModules.size} external modules`);
    console.log(`✓ Identified ${this.calls.length} function calls`);

    return {
      nodes,
      edges: this.calls,
      lastUpdated: new Date().toISOString()
    };
  }

  private getAllTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];

    const walkDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walkDir(fullPath);
          }
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          files.push(fullPath);
        }
      }
    };

    walkDir(dir);
    return files;
  }

  private visitDeclarations(node: ts.Node, filePath: string): void {
    // Extract external module imports
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      // Only track external modules (not relative imports)
      if (!moduleName.startsWith('.')) {
        const id = `ext:${moduleName}`;
        if (!this.externalModules.has(id)) {
          this.externalModules.set(id, {
            id,
            name: moduleName,
            type: 'external'
          });
        }
      }
    }

    // Extract global variable declarations (top-level)
    if (ts.isVariableStatement(node) && node.parent && ts.isSourceFile(node.parent)) {
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      
      for (const decl of node.declarationList.declarations) {
        if (decl.name && ts.isIdentifier(decl.name)) {
          const varName = decl.name.text;
          const lineNumber = this.getLineNumber(node, filePath);
          const id = `var:${varName}@${filePath}`;

          this.variables.set(id, {
            id,
            name: varName,
            file: path.relative('./src', filePath),
            line: lineNumber,
            isExported,
            type: 'variable'
          });
        }
      }
    }

    // Extract function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `${functionName}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.functions.set(id, {
        id,
        name: functionName,
        file: path.relative('./src', filePath),
        line: lineNumber,
        isExported,
        type: 'function'
      });
    }

    // Extract method declarations in classes
    if (ts.isMethodDeclaration(node) && node.name && typeof node.name === 'object') {
      const methodName = (node.name as any).text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `${methodName}@${filePath}`;
      // Method is exported if it has export modifier OR if its parent class is exported
      const hasExportModifier = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isPublicOrDefault = !node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? true;
      const parentClassExported = this.isMethodInExportedClass(node);
      const isExported = hasExportModifier || (parentClassExported && isPublicOrDefault);

      this.functions.set(id, {
        id,
        name: methodName,
        file: path.relative('./src', filePath),
        line: lineNumber,
        isExported,
        type: 'function'
      });
    }

    // Extract arrow function methods in classes (e.g., private methodName = () => {})
    if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      const methodName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `${methodName}@${filePath}`;
      // Property is exported if it has export modifier OR if its parent class is exported
      const hasExportModifier = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isPublicOrDefault = !node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? true;
      const parentClassExported = this.isMethodInExportedClass(node);
      const isExported = hasExportModifier || (parentClassExported && isPublicOrDefault);

      this.functions.set(id, {
        id,
        name: methodName,
        file: path.relative('./src', filePath),
        line: lineNumber,
        isExported,
        type: 'function'
      });
    }

    // Recurse through children
    ts.forEachChild(node, (child) => this.visitDeclarations(child, filePath));
  }

  /**
   * Check if a method/property is inside an exported class
   */
  private isMethodInExportedClass(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (ts.isClassDeclaration(current)) {
        const hasExportModifier = current.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
        return hasExportModifier;
      }
      current = current.parent;
    }
    return false;
  }

  private visitCalls(node: ts.Node, filePath: string): void {
    // Extract function calls
    if (ts.isCallExpression(node)) {
      const caller = this.findEnclosingFunction(node, filePath);
      const callee = this.getCalleeInfo(node);

      if (caller && callee) {
        // Try to resolve the callee to a function we know about
        const resolvedCallee = this.resolveCalleeToFunction(callee, filePath);
        if (resolvedCallee && caller !== resolvedCallee) {
          // Check if this edge already exists
          const edgeExists = this.calls.some(call => call.from === caller && call.to === resolvedCallee);
          if (!edgeExists) {
            this.calls.push({
              from: caller,
              to: resolvedCallee
            });
          }
        }
      }
    }

    // Recurse through children
    ts.forEachChild(node, (child) => this.visitCalls(child, filePath));
  }

  private getLineNumber(node: ts.Node, filePath: string): number {
    const source = fs.readFileSync(filePath, 'utf-8');
    const { line } = ts.getLineAndCharacterOfPosition(
      ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true),
      node.getStart()
    );
    return line + 1;
  }

  private findEnclosingFunction(node: ts.Node, filePath: string): string | null {
    let current = node.parent;

    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        const id = `${current.name.text}@${filePath}`;
        if (this.functions.has(id)) {
          return id;
        }
      }

      if (ts.isMethodDeclaration(current) && current.name && typeof current.name === 'object') {
        const methodName = (current.name as any).text;
        const id = `${methodName}@${filePath}`;
        if (this.functions.has(id)) {
          return id;
        }
      }

      current = current.parent;
    }

    return null;
  }

  private getCalleeInfo(node: ts.CallExpression): string | null {
    const expression = node.expression;

    if (ts.isIdentifier(expression)) {
      return expression.text;
    }

    if (ts.isPropertyAccessExpression(expression)) {
      return (expression.name as ts.Identifier).text;
    }

    return null;
  }

  private resolveCalleeToFunction(calleeName: string, filePath: string): string | null {
    // First, try to find in the same file
    const sameFileMatches = Array.from(this.functions.entries()).filter(
      ([id, func]) => id.endsWith(filePath) && func.name === calleeName
    );

    if (sameFileMatches.length > 0) {
      return sameFileMatches[0][0];
    }

    // Then try to find in any file
    const anyFileMatches = Array.from(this.functions.entries()).filter(
      ([_, func]) => func.name === calleeName
    );

    if (anyFileMatches.length > 0) {
      return anyFileMatches[0][0];
    }

    return null;
  }
}


