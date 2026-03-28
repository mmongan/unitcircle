/**
 * CodeTreeBuilder - Build-time AST parser to extract function relationships
 * Uses TypeScript compiler API for accurate code analysis
 */

/// <reference types="node" />

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
  code?: string;
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
  kind?: 'call' | 'var-read' | 'var-write';
}

interface CalleeInfo {
  name: string;
  receiverKind: 'this' | 'super' | 'identifier' | 'other' | null;
  receiverIdentifier: string | null;
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: FunctionCall[];
  files: string[];
  lastUpdated: string;
}

export class CodeTreeBuilder {
  private sourceDir: string;
  private functions: Map<string, FunctionNode> = new Map();
  private variables: Map<string, GlobalVariable> = new Map();
  private globalVariableIdsByFile: Map<string, Map<string, string>> = new Map();
  private externalModules: Map<string, ExternalModule> = new Map();
  private importedExternalSymbolsByFile: Map<string, Map<string, string>> = new Map();
  private calls: FunctionCall[] = [];

  constructor(sourceDir: string = './src') {
    this.sourceDir = path.resolve(sourceDir);
  }

  /**
   * Build the code tree by analyzing all TypeScript files
   */
  public build(): CodeGraph {
    // Clear all maps for fresh graph generation
    this.functions.clear();
    this.variables.clear();
    this.globalVariableIdsByFile.clear();
    this.externalModules.clear();
    this.importedExternalSymbolsByFile.clear();
    this.calls = [];

    // Get TypeScript files for AST parsing
    const files = this.getAllTypeScriptFiles(this.sourceDir);
    const htmlFiles = this.getAllHtmlFiles(this.sourceDir);
    
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

    // Pass 3: Add HTML entry nodes and connect to referenced scripts.
    for (const htmlFile of htmlFiles) {
      this.visitHtmlEntry(htmlFile);
    }

    const nodes: CodeNode[] = [
      ...Array.from(this.functions.values()),
      ...Array.from(this.variables.values()),
      ...Array.from(this.externalModules.values())
    ];

    // Keep file inventory aligned with parsed source files only.
    const projectFiles = Array.from(new Set([
      ...files.map((f) => path.relative(this.sourceDir, f).replace(/\\/g, '/')),
      ...htmlFiles.map((f) => path.relative(this.sourceDir, f).replace(/\\/g, '/')),
    ])).sort();

    console.log(`✓ Extracted ${this.functions.size} functions, ${this.variables.size} variables, ${this.externalModules.size} external modules`);
    console.log(`✓ Identified ${this.calls.length} function calls`);

    return {
      nodes,
      edges: this.calls,
      files: projectFiles,
      lastUpdated: new Date().toISOString()
    };
  }

  private shouldIgnorePath(fullPath: string): boolean {
    const normalized = fullPath.replace(/\\+/g, '/');
    const parts = normalized.split('/');
    if (parts.includes('node_modules') || parts.includes('.git') || parts.includes('dist') || parts.includes('coverage')) {
      return true;
    }
    // public/ contains static assets and cached copies of source files — skip to avoid duplicates.
    if (parts.includes('public')) {
      return true;
    }
    return false;
  }

  private getAllProjectFiles(dir: string): string[] {
    const files: string[] = [];

    const walkDir = (currentPath: string) => {
      if (this.shouldIgnorePath(currentPath)) {
        return;
      }

      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (this.shouldIgnorePath(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else {
          // Only include source code file types — skip markdown, JSON, images, logs, etc.
          const ext = path.extname(entry.name).toLowerCase();
          if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cjs'].includes(ext)) {
            files.push(path.relative(this.sourceDir, fullPath).replace(/\\/g, '/'));
          }
        }
      }
    };

    walkDir(dir);
    return files.sort();
  }

  private getAllTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];

    const walkDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (this.shouldIgnorePath(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) {
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

  private getAllHtmlFiles(dir: string): string[] {
    const files: string[] = [];

    const walkDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (this.shouldIgnorePath(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) {
            walkDir(fullPath);
          }
        } else if (entry.name.endsWith('.html')) {
          files.push(fullPath);
        }
      }
    };

    walkDir(dir);
    return files;
  }

  private visitHtmlEntry(filePath: string): void {
    const relative = path.relative(this.sourceDir, filePath).replace(/\\/g, '/');
    const id = `html:${relative}`;

    let source = '';
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    if (!this.functions.has(id)) {
      this.functions.set(id, {
        id,
        name: relative,
        file: relative,
        line: 1,
        isExported: true,
        type: 'function',
        code: this.extractTextPreview(source, 12000),
      });
    }

    const scriptRefs = this.extractHtmlScriptSources(source)
      .map((ref) => this.normalizeHtmlScriptReference(ref, relative))
      .filter((ref): ref is string => !!ref);

    for (const scriptRef of scriptRefs) {
      const targets = Array.from(this.functions.entries())
        .filter(([fnId, fn]) => fnId !== id && fn.file === scriptRef && fn.type === 'function')
        .sort((a, b) => (a[1].isExported === b[1].isExported ? a[1].name.localeCompare(b[1].name) : (a[1].isExported ? -1 : 1)));

      if (targets.length === 0) {
        continue;
      }

      // Prefer exported entries for navigation; fall back to first discovered function.
      const preferred = targets.filter(([, fn]) => fn.isExported);
      const selectedTargets = preferred.length > 0 ? preferred : [targets[0]];
      for (const [targetId] of selectedTargets) {
        this.addEdge(id, targetId, 'call');
      }
    }
  }

  private extractHtmlScriptSources(source: string): string[] {
    const results: string[] = [];
    const scriptRegex = /<script\b[^>]*\bsrc\s*=\s*['\"]([^'\"]+)['\"][^>]*>/gi;
    let match: RegExpExecArray | null = null;
    while ((match = scriptRegex.exec(source)) !== null) {
      const src = (match[1] || '').trim();
      if (src) {
        results.push(src);
      }
    }
    return results;
  }

  private normalizeHtmlScriptReference(rawRef: string, htmlRelativePath: string): string | null {
    if (!rawRef || /^https?:\/\//i.test(rawRef) || rawRef.startsWith('//')) {
      return null;
    }

    const noQuery = rawRef.split('?')[0].split('#')[0];
    if (!noQuery) {
      return null;
    }

    const htmlDir = path.posix.dirname(htmlRelativePath.replace(/\\/g, '/'));
    const baseDir = htmlDir === '.' ? '' : htmlDir;
    const normalized = noQuery.startsWith('/')
      ? noQuery.slice(1)
      : path.posix.normalize(path.posix.join(baseDir, noQuery));

    return normalized.replace(/^\.\//, '');
  }

  private extractTextPreview(source: string, maxChars: number): string {
    const normalized = source.replace(/\r\n/g, '\n').trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, maxChars)}\n<!-- ...truncated... -->`;
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

        if (node.importClause) {
          // import fs from 'fs'
          if (node.importClause.name) {
            this.registerImportedExternalSymbol(filePath, node.importClause.name.text, id);
          }

          const namedBindings = node.importClause.namedBindings;
          if (namedBindings) {
            // import * as path from 'path'
            if (ts.isNamespaceImport(namedBindings)) {
              this.registerImportedExternalSymbol(filePath, namedBindings.name.text, id);
            }

            // import { readFileSync as read } from 'fs'
            if (ts.isNamedImports(namedBindings)) {
              for (const element of namedBindings.elements) {
                const localName = (element.propertyName ?? element.name).text;
                this.registerImportedExternalSymbol(filePath, localName, id);
              }
            }
          }
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
            file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
            line: lineNumber,
            isExported,
            type: 'variable'
          });
          this.registerGlobalVariable(filePath, varName, id);
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
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
    }

    // Extract method declarations in classes
    if (ts.isMethodDeclaration(node) && node.name && typeof node.name === 'object') {
      const methodName = (node.name as any).text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `${methodName}@${filePath}`;
      // Method is exported if it has export modifier OR if its parent class is exported
      const hasExportModifier = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isPublicOrDefault = !(node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? false);
      const parentClassExported = this.isMethodInExportedClass(node);
      const isExported = hasExportModifier || (parentClassExported && isPublicOrDefault);

      this.functions.set(id, {
        id,
        name: methodName,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
    }

    // Extract arrow function methods in classes (e.g., private methodName = () => {})
    if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      const methodName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `${methodName}@${filePath}`;
      // Property is exported if it has export modifier OR if its parent class is exported
      const hasExportModifier = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isPublicOrDefault = !(node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? false);
      const parentClassExported = this.isMethodInExportedClass(node);
      const isExported = hasExportModifier || (parentClassExported && isPublicOrDefault);

      this.functions.set(id, {
        id,
        name: methodName,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
    }

    // Recurse through children
    ts.forEachChild(node, (child) => this.visitDeclarations(child, filePath));
  }

  private registerImportedExternalSymbol(filePath: string, identifier: string, externalId: string): void {
    if (!identifier) {
      return;
    }

    if (!this.importedExternalSymbolsByFile.has(filePath)) {
      this.importedExternalSymbolsByFile.set(filePath, new Map());
    }
    this.importedExternalSymbolsByFile.get(filePath)!.set(identifier, externalId);
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
        const callerNode = this.functions.get(caller);
        const isObjectQualifiedSelfName = Boolean(
          callerNode
          && callee.receiverKind !== null
          && callee.receiverKind !== 'this'
          && callee.receiverKind !== 'super'
          && callerNode.name === callee.name,
        );

        if (isObjectQualifiedSelfName) {
          ts.forEachChild(node, (child) => this.visitCalls(child, filePath));
          return;
        }

        // Try to resolve the callee to a function we know about
        const resolvedCallee = this.resolveCalleeToFunction(callee.name, filePath);
        let resolvedTarget = resolvedCallee;
        if (!resolvedTarget) {
          resolvedTarget = this.resolveCalleeToExternalModule(callee, filePath);
        }

        if (resolvedTarget) {
          // Check if this edge already exists
          this.addEdge(caller, resolvedTarget, 'call');
        }
      }
    }

    if (ts.isIdentifier(node)) {
      this.recordVariableAccess(node, filePath);
    }

    // Recurse through children
    ts.forEachChild(node, (child) => this.visitCalls(child, filePath));
  }

  private addEdge(from: string, to: string, kind: 'call' | 'var-read' | 'var-write' = 'call'): void {
    const edgeExists = this.calls.some(
      (edge) => edge.from === from && edge.to === to && (edge.kind ?? 'call') === kind,
    );
    if (edgeExists) {
      return;
    }
    this.calls.push({ from, to, kind });
  }

  private registerGlobalVariable(filePath: string, variableName: string, variableId: string): void {
    if (!this.globalVariableIdsByFile.has(filePath)) {
      this.globalVariableIdsByFile.set(filePath, new Map());
    }
    this.globalVariableIdsByFile.get(filePath)!.set(variableName, variableId);
  }

  private resolveGlobalVariableId(filePath: string, identifier: string): string | null {
    const fileMap = this.globalVariableIdsByFile.get(filePath);
    if (!fileMap) {
      return null;
    }
    return fileMap.get(identifier) ?? null;
  }

  private recordVariableAccess(identifierNode: ts.Identifier, filePath: string): void {
    const variableId = this.resolveGlobalVariableId(filePath, identifierNode.text);
    if (!variableId) {
      return;
    }

    if (!this.isRuntimeVariableUsage(identifierNode)) {
      return;
    }

    const caller = this.findEnclosingFunction(identifierNode, filePath);
    if (!caller) {
      return;
    }

    const access = this.getVariableAccessKind(identifierNode);
    if (access.read) {
      this.addEdge(caller, variableId, 'var-read');
    }
    if (access.write) {
      this.addEdge(caller, variableId, 'var-write');
    }
  }

  private isRuntimeVariableUsage(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (!parent) {
      return false;
    }

    if (ts.isImportClause(parent)
      || ts.isImportSpecifier(parent)
      || ts.isNamespaceImport(parent)
      || ts.isImportEqualsDeclaration(parent)
      || ts.isExportSpecifier(parent)
      || ts.isTypeReferenceNode(parent)
      || ts.isInterfaceDeclaration(parent)
      || ts.isTypeAliasDeclaration(parent)
      || ts.isClassDeclaration(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isVariableDeclaration(parent)
      || ts.isBindingElement(parent)
      || ts.isPropertySignature(parent)
      || ts.isEnumMember(parent)
      || ts.isTypeParameterDeclaration(parent)
      || ts.isQualifiedName(parent)) {
      return false;
    }

    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      return false;
    }

    if (ts.isPropertyAssignment(parent) && parent.name === node) {
      return false;
    }

    return true;
  }

  private getVariableAccessKind(node: ts.Identifier): { read: boolean; write: boolean } {
    const parent = node.parent;
    if (!parent) {
      return { read: true, write: false };
    }

    if (ts.isBinaryExpression(parent) && parent.left === node && this.isAssignmentOperator(parent.operatorToken.kind)) {
      const isSimpleAssign = parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      return { read: !isSimpleAssign, write: true };
    }

    if (ts.isPrefixUnaryExpression(parent)
      && parent.operand === node
      && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
      return { read: true, write: true };
    }

    if (ts.isPostfixUnaryExpression(parent)
      && parent.operand === node
      && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
      return { read: true, write: true };
    }

    return { read: true, write: false };
  }

  private isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.EqualsToken
      || kind === ts.SyntaxKind.PlusEqualsToken
      || kind === ts.SyntaxKind.MinusEqualsToken
      || kind === ts.SyntaxKind.AsteriskEqualsToken
      || kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken
      || kind === ts.SyntaxKind.SlashEqualsToken
      || kind === ts.SyntaxKind.PercentEqualsToken
      || kind === ts.SyntaxKind.AmpersandEqualsToken
      || kind === ts.SyntaxKind.BarEqualsToken
      || kind === ts.SyntaxKind.CaretEqualsToken
      || kind === ts.SyntaxKind.LessThanLessThanEqualsToken
      || kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken
      || kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
      || kind === ts.SyntaxKind.BarBarEqualsToken
      || kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
      || kind === ts.SyntaxKind.QuestionQuestionEqualsToken;
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

  private getCalleeInfo(node: ts.CallExpression): CalleeInfo | null {
    const expression = node.expression;

    if (ts.isIdentifier(expression)) {
      return {
        name: expression.text,
        receiverKind: null,
        receiverIdentifier: null,
      };
    }

    if (ts.isPropertyAccessExpression(expression)) {
      let receiverKind: CalleeInfo['receiverKind'] = 'other';
      if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        receiverKind = 'this';
      } else if (expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
        receiverKind = 'super';
      } else if (ts.isIdentifier(expression.expression)) {
        receiverKind = 'identifier';
      }

      return {
        name: (expression.name as ts.Identifier).text,
        receiverKind,
        receiverIdentifier: ts.isIdentifier(expression.expression) ? expression.expression.text : null,
      };
    }

    return null;
  }

  private resolveCalleeToExternalModule(callee: CalleeInfo, filePath: string): string | null {
    const importedSymbols = this.importedExternalSymbolsByFile.get(filePath);
    if (!importedSymbols) {
      return null;
    }

    // Direct identifier call, e.g. readFileSync(...)
    if (callee.receiverKind === null) {
      return importedSymbols.get(callee.name) ?? null;
    }

    // Property access on imported namespace/default, e.g. fs.readFileSync(...)
    if (callee.receiverKind === 'identifier' && callee.receiverIdentifier) {
      return importedSymbols.get(callee.receiverIdentifier) ?? null;
    }

    return null;
  }

  private extractFunctionCode(node: ts.Node): string {
    try {
      const sourceFile = node.getSourceFile();
      const raw = node.getText(sourceFile);
      const normalized = raw.replace(/\r\n/g, '\n').trim();
      const maxChars = 12000;
      if (normalized.length <= maxChars) {
        return normalized;
      }
      return `${normalized.slice(0, maxChars)}\n/* ...truncated... */`;
    } catch {
      return '';
    }
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


