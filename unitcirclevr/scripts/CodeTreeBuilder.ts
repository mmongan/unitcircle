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

export interface ClassNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'class';
  code?: string;
}

export interface InterfaceNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'interface';
  code?: string;
}

export interface TypeAliasNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'type-alias';
  code?: string;
}

export interface EnumNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'enum';
  code?: string;
}

export interface NamespaceNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'namespace';
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

export type CodeNode =
  | FunctionNode
  | ClassNode
  | InterfaceNode
  | TypeAliasNode
  | EnumNode
  | NamespaceNode
  | GlobalVariable
  | ExternalModule;

export interface FunctionCall {
  from: string;
  to: string;
  kind?:
    | 'call'
    | 'var-read'
    | 'var-write'
    | 'import'
    | 'export'
    | 'import-cycle'
    | 'type-import'
    | 'type-export'
    | 'extends'
    | 'implements'
    | 'type-ref'
    | 'type-constraint'
    | 'overload-of'
    | 'enum-member-read'
    | 'module-augmentation'
    | 'decorator'
    | 'new-call'
    | 're-export';
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
  private knownSourceFiles: Set<string> = new Set();
  private functions: Map<string, FunctionNode> = new Map();
  private classes: Map<string, ClassNode> = new Map();
  private interfaces: Map<string, InterfaceNode> = new Map();
  private typeAliases: Map<string, TypeAliasNode> = new Map();
  private enums: Map<string, EnumNode> = new Map();
  private namespaces: Map<string, NamespaceNode> = new Map();
  private variables: Map<string, GlobalVariable> = new Map();
  private globalVariableIdsByFile: Map<string, Map<string, string>> = new Map();
  private exportedSymbolIdsByFile: Map<string, Set<string>> = new Map();
  private explicitNamedExportsByFile: Map<string, Set<string>> = new Map();
  private explicitNamedTypeExportsByFile: Map<string, Set<string>> = new Map();
  private moduleAnchorIdByFile: Map<string, string> = new Map();
  private internalImportTargetsByFile: Map<string, Set<string>> = new Map();
  private typeOnlyInternalImportTargetsByFile: Map<string, Set<string>> = new Map();
  private typeOnlyInternalExportTargetsByFile: Map<string, Set<string>> = new Map();
  // Tracks files that re-export another module's symbols (export * from / export { X } from)
  private reExportTargetsByFile: Map<string, Set<string>> = new Map();
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
    this.knownSourceFiles.clear();
    this.functions.clear();
    this.classes.clear();
    this.interfaces.clear();
    this.typeAliases.clear();
    this.enums.clear();
    this.namespaces.clear();
    this.variables.clear();
    this.globalVariableIdsByFile.clear();
    this.exportedSymbolIdsByFile.clear();
    this.explicitNamedExportsByFile.clear();
    this.explicitNamedTypeExportsByFile.clear();
    this.moduleAnchorIdByFile.clear();
    this.internalImportTargetsByFile.clear();
    this.typeOnlyInternalImportTargetsByFile.clear();
    this.typeOnlyInternalExportTargetsByFile.clear();
    this.reExportTargetsByFile.clear();
    this.externalModules.clear();
    this.importedExternalSymbolsByFile.clear();
    this.calls = [];

    // Get TypeScript files for AST parsing
    const files = this.getAllTypeScriptFiles(this.sourceDir);
    const htmlFiles = this.getAllHtmlFiles(this.sourceDir);
    
    if (files.length === 0) {
      throw new Error(`No TypeScript files found in ${this.sourceDir}`);
    }

    this.knownSourceFiles = new Set(files.map((f) => path.resolve(f)));

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

    // Pass 4: Add module-level import/export graph and annotate import cycles.
    this.emitImportExportGraph(files);
    this.emitImportCycles();

    const nodes: CodeNode[] = [
      ...Array.from(this.functions.values()),
      ...Array.from(this.classes.values()),
      ...Array.from(this.interfaces.values()),
      ...Array.from(this.typeAliases.values()),
      ...Array.from(this.enums.values()),
      ...Array.from(this.namespaces.values()),
      ...Array.from(this.variables.values()),
      ...Array.from(this.externalModules.values())
    ];

    // Keep file inventory aligned with parsed source files only.
    const projectFiles = Array.from(new Set([
      ...files.map((f) => path.relative(this.sourceDir, f).replace(/\\/g, '/')),
      ...htmlFiles.map((f) => path.relative(this.sourceDir, f).replace(/\\/g, '/')),
    ])).sort();

    console.log(`✓ Extracted ${this.functions.size} functions, ${this.classes.size} classes, ${this.interfaces.size} interfaces, ${this.typeAliases.size} type aliases, ${this.enums.size} enums, ${this.namespaces.size} namespaces, ${this.variables.size} variables, ${this.externalModules.size} external modules`);
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
      if (moduleName.startsWith('.')) {
        const target = this.resolveInternalModulePath(filePath, moduleName);
        if (target) {
          this.registerInternalImport(filePath, target);
          const clause = node.importClause;
          const hasTypeOnlyClause = Boolean(clause?.isTypeOnly);
          const hasTypeOnlyNamedImport = Boolean(
            clause?.namedBindings
            && ts.isNamedImports(clause.namedBindings)
            && clause.namedBindings.elements.some((element) => element.isTypeOnly),
          );
          if (hasTypeOnlyClause || hasTypeOnlyNamedImport) {
            this.registerTypeOnlyInternalImport(filePath, target);
          }
        }
      }

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

    // Capture export declarations including explicit named re-exports.
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = this.resolveInternalModulePath(filePath, node.moduleSpecifier.text);
        if (target) {
          this.registerInternalImport(filePath, target);
          if (node.isTypeOnly) {
            this.registerTypeOnlyInternalExport(filePath, target);
          } else {
            // export * from './other' or export { X } from './other'
            this.registerReExport(filePath, target);
          }
        }
      }

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          const localName = (specifier.propertyName ?? specifier.name).text;
          this.registerExplicitNamedExport(filePath, localName);
          if (node.isTypeOnly || specifier.isTypeOnly) {
            this.registerExplicitNamedTypeExport(filePath, localName);
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
          if (isExported) {
            this.registerExportedSymbol(filePath, id);
          }
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
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `class:${className}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.classes.set(id, {
        id,
        name: className,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'class',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeRelationshipEdges(node, id, filePath);
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract interface declarations
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const interfaceName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `interface:${interfaceName}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.interfaces.set(id, {
        id,
        name: interfaceName,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'interface',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeRelationshipEdges(node, id, filePath);
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
    }

    // Extract type alias declarations
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const aliasName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `type:${aliasName}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.typeAliases.set(id, {
        id,
        name: aliasName,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'type-alias',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
    }

    // Extract enum declarations
    if (ts.isEnumDeclaration(node) && node.name) {
      const enumName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `enum:${enumName}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.enums.set(id, {
        id,
        name: enumName,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'enum',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract namespace/module declarations
    if (ts.isModuleDeclaration(node) && node.name) {
      const namespaceName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : '';
      if (namespaceName) {
        const lineNumber = this.getLineNumber(node, filePath);
        const id = `namespace:${namespaceName}@${filePath}`;
        const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

        this.namespaces.set(id, {
          id,
          name: namespaceName,
          file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
          line: lineNumber,
          isExported,
          type: 'namespace',
          code: this.extractFunctionCode(node)
        });
        if (isExported) {
          this.registerExportedSymbol(filePath, id);
        }
        if (ts.isStringLiteral(node.name)) {
          this.emitModuleAugmentationEdge(node.name.text, filePath, id);
        }
      }
    }

    // Extract method declarations in classes
    if (ts.isMethodDeclaration(node) && node.name && typeof node.name === 'object') {
      const methodName = (node.name as any).text;
      const lineNumber = this.getLineNumber(node, filePath);
      const hasBody = Boolean(node.body);
      const id = hasBody
        ? `${methodName}@${filePath}`
        : `overload:${methodName}:${lineNumber}@${filePath}`;
      // Method is exported if it has export modifier OR if its parent class is exported
      const hasExportModifier = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      const isPublicOrDefault = !(node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? false);
      const parentClassExported = this.isMethodInExportedClass(node);
      const isExported = hasExportModifier || (parentClassExported && isPublicOrDefault);

      this.functions.set(id, {
        id,
        name: hasBody ? methodName : `${methodName} (overload)`,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      if (!hasBody) {
        const implementationId = `${methodName}@${filePath}`;
        if (this.functions.has(implementationId)) {
          this.addEdge(id, implementationId, 'overload-of');
        }
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
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
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract function overload signatures (declaration without body)
    if (ts.isFunctionDeclaration(node) && node.name && !node.body) {
      const functionName = node.name.text;
      const lineNumber = this.getLineNumber(node, filePath);
      const id = `overload:${functionName}:${lineNumber}@${filePath}`;
      const isExported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;

      this.functions.set(id, {
        id,
        name: `${functionName} (overload)`,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      const implementationId = `${functionName}@${filePath}`;
      if (this.functions.has(implementationId)) {
        this.addEdge(id, implementationId, 'overload-of');
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract constructors as callable nodes
    if (ts.isConstructorDeclaration(node)) {
      const lineNumber = this.getLineNumber(node, filePath);
      const className = this.getEnclosingClassName(node) ?? 'AnonymousClass';
      const id = `constructor:${className}:${lineNumber}@${filePath}`;
      const parentClassExported = this.isMethodInExportedClass(node);
      const isPrivate = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const isExported = parentClassExported && !isPrivate;

      this.functions.set(id, {
        id,
        name: `${className}.constructor`,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
    }

    // Extract property accessors as callable nodes
    if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      const lineNumber = this.getLineNumber(node, filePath);
      const className = this.getEnclosingClassName(node) ?? 'AnonymousClass';
      const accessorKind = ts.isGetAccessorDeclaration(node) ? 'get' : 'set';
      const id = `${accessorKind}:${className}.${node.name.text}:${lineNumber}@${filePath}`;
      const parentClassExported = this.isMethodInExportedClass(node);
      const isPrivate = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const isExported = parentClassExported && !isPrivate;

      this.functions.set(id, {
        id,
        name: `${className}.${accessorKind} ${node.name.text}`,
        file: path.relative(this.sourceDir, filePath).replace(/\\/g, '/'),
        line: lineNumber,
        isExported,
        type: 'function',
        code: this.extractFunctionCode(node)
      });
      if (isExported) {
        this.registerExportedSymbol(filePath, id);
      }
      this.emitTypeReferenceEdges(node, id, filePath);
      this.emitGenericConstraintEdges(node, id, filePath);
      this.emitDecoratorEdges(node, id, filePath);
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

    // Track `new Foo()` expressions as new-call edges to the class/constructor
    if (ts.isNewExpression(node)) {
      const caller = this.findEnclosingFunction(node, filePath);
      if (caller) {
        const calleeName = this.getCalleeNameFromExpression(node.expression);
        if (calleeName) {
          // Prefer constructor node, fall back to class node
          const classId = this.resolveTypeLikeSymbol(calleeName, filePath, ['class']);
          if (classId) {
            const constructorId = this.findConstructorForClass(calleeName, filePath);
            this.addEdge(caller, constructorId ?? classId, 'new-call');
          } else {
            const extId = this.resolveExternalSymbolByIdentifier(calleeName, filePath);
            if (extId) {
              this.addEdge(caller, extId, 'new-call');
            }
          }
        }
      }
    }

    if (ts.isIdentifier(node)) {
      this.recordVariableAccess(node, filePath);
    }

    if (ts.isPropertyAccessExpression(node)) {
      this.recordEnumMemberUsage(node, filePath);
    }

    // Recurse through children
    ts.forEachChild(node, (child) => this.visitCalls(child, filePath));
  }

  private getCalleeNameFromExpression(expression: ts.LeftHandSideExpression): string | null {
    if (ts.isIdentifier(expression)) {
      return expression.text;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text;
    }
    return null;
  }

  private findConstructorForClass(className: string, filePath: string): string | null {
    // Look for constructor:ClassName:N@filePath entries
    const prefix = `constructor:${className}:`;
    for (const id of this.functions.keys()) {
      if (id.startsWith(prefix) && id.includes(`@${filePath}`)) {
        return id;
      }
    }
    // Also check all constructors where the file relative path matches
    const relFile = path.relative(this.sourceDir, filePath).replace(/\\/g, '/');
    for (const [id, fn] of this.functions.entries()) {
      if (fn.file === relFile && fn.name.startsWith(`${className}.constructor`)) {
        return id;
      }
    }
    return null;
  }

  private registerReExport(reExporterFilePath: string, targetFilePath: string): void {
    const exporter = path.resolve(reExporterFilePath);
    const target = path.resolve(targetFilePath);
    if (exporter === target) {
      return;
    }
    if (!this.reExportTargetsByFile.has(exporter)) {
      this.reExportTargetsByFile.set(exporter, new Set());
    }
    this.reExportTargetsByFile.get(exporter)!.add(target);
  }

  private addEdge(
    from: string,
    to: string,
    kind:
      | 'call'
      | 'var-read'
      | 'var-write'
      | 'import'
      | 'export'
      | 'import-cycle'
      | 'type-import'
      | 'type-export'
      | 'extends'
      | 'implements'
      | 'type-ref'
      | 'type-constraint'
      | 'overload-of'
      | 'enum-member-read'
      | 'module-augmentation'
      | 'decorator'
      | 'new-call'
      | 're-export' = 'call',
  ): void {
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

  private registerExportedSymbol(filePath: string, symbolId: string): void {
    if (!this.exportedSymbolIdsByFile.has(filePath)) {
      this.exportedSymbolIdsByFile.set(filePath, new Set());
    }
    this.exportedSymbolIdsByFile.get(filePath)!.add(symbolId);
  }

  private registerExplicitNamedExport(filePath: string, symbolName: string): void {
    if (!symbolName) {
      return;
    }

    if (!this.explicitNamedExportsByFile.has(filePath)) {
      this.explicitNamedExportsByFile.set(filePath, new Set());
    }
    this.explicitNamedExportsByFile.get(filePath)!.add(symbolName);
  }

  private registerExplicitNamedTypeExport(filePath: string, symbolName: string): void {
    if (!symbolName) {
      return;
    }

    if (!this.explicitNamedTypeExportsByFile.has(filePath)) {
      this.explicitNamedTypeExportsByFile.set(filePath, new Set());
    }
    this.explicitNamedTypeExportsByFile.get(filePath)!.add(symbolName);
  }

  private registerInternalImport(importerFilePath: string, importedFilePath: string): void {
    const importer = path.resolve(importerFilePath);
    const imported = path.resolve(importedFilePath);
    if (importer === imported) {
      return;
    }

    if (!this.internalImportTargetsByFile.has(importer)) {
      this.internalImportTargetsByFile.set(importer, new Set());
    }
    this.internalImportTargetsByFile.get(importer)!.add(imported);
  }

  private registerTypeOnlyInternalImport(importerFilePath: string, importedFilePath: string): void {
    const importer = path.resolve(importerFilePath);
    const imported = path.resolve(importedFilePath);
    if (importer === imported) {
      return;
    }

    if (!this.typeOnlyInternalImportTargetsByFile.has(importer)) {
      this.typeOnlyInternalImportTargetsByFile.set(importer, new Set());
    }
    this.typeOnlyInternalImportTargetsByFile.get(importer)!.add(imported);
  }

  private registerTypeOnlyInternalExport(exporterFilePath: string, targetFilePath: string): void {
    const exporter = path.resolve(exporterFilePath);
    const target = path.resolve(targetFilePath);
    if (exporter === target) {
      return;
    }

    if (!this.typeOnlyInternalExportTargetsByFile.has(exporter)) {
      this.typeOnlyInternalExportTargetsByFile.set(exporter, new Set());
    }
    this.typeOnlyInternalExportTargetsByFile.get(exporter)!.add(target);
  }

  private getEnclosingClassName(node: ts.Node): string | null {
    let current = node.parent;
    while (current) {
      if (ts.isClassDeclaration(current) && current.name) {
        return current.name.text;
      }
      current = current.parent;
    }
    return null;
  }

  private resolveInternalModulePath(importerFilePath: string, moduleSpecifier: string): string | null {
    if (!moduleSpecifier.startsWith('.')) {
      return null;
    }

    const importerDir = path.dirname(importerFilePath);
    const rawPath = path.resolve(importerDir, moduleSpecifier);
    const candidates = [
      rawPath,
      `${rawPath}.ts`,
      `${rawPath}.tsx`,
      `${rawPath}.mts`,
      `${rawPath}.js`,
      `${rawPath}.jsx`,
      `${rawPath}.mjs`,
      path.join(rawPath, 'index.ts'),
      path.join(rawPath, 'index.tsx'),
      path.join(rawPath, 'index.mts'),
      path.join(rawPath, 'index.js'),
      path.join(rawPath, 'index.mjs'),
    ];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (this.knownSourceFiles.has(resolved)) {
        return resolved;
      }
    }

    return null;
  }

  private ensureModuleAnchor(filePath: string): string {
    const resolved = path.resolve(filePath);
    const existing = this.moduleAnchorIdByFile.get(resolved);
    if (existing) {
      return existing;
    }

    const relative = path.relative(this.sourceDir, resolved).replace(/\\/g, '/');
    const anchorId = `module:${relative}`;
    this.moduleAnchorIdByFile.set(resolved, anchorId);

    if (!this.functions.has(anchorId)) {
      this.functions.set(anchorId, {
        id: anchorId,
        name: `[module] ${relative}`,
        file: relative,
        line: 1,
        isExported: true,
        type: 'function',
        code: '',
      });
    }

    return anchorId;
  }

  private emitImportExportGraph(filePaths: string[]): void {
    for (const filePath of filePaths) {
      const anchorId = this.ensureModuleAnchor(filePath);
      const relativeFile = path.relative(this.sourceDir, filePath).replace(/\\/g, '/');
      const exportsForFile = new Set(this.exportedSymbolIdsByFile.get(filePath) || []);

      for (const symbolName of this.explicitNamedExportsByFile.get(filePath) || []) {
        const resolved = this.resolveSymbolInFileByName(relativeFile, symbolName);
        if (resolved) {
          exportsForFile.add(resolved);
        }
      }

      for (const typeSymbolName of this.explicitNamedTypeExportsByFile.get(filePath) || []) {
        const resolved = this.resolveSymbolInFileByName(relativeFile, typeSymbolName);
        if (resolved) {
          this.addEdge(anchorId, resolved, 'type-export');
        }
      }

      for (const exportedSymbolId of exportsForFile) {
        this.addEdge(anchorId, exportedSymbolId, 'export');
      }
    }

    for (const [importerFile, targets] of this.internalImportTargetsByFile.entries()) {
      const fromAnchor = this.ensureModuleAnchor(importerFile);
      for (const targetFile of targets) {
        const toAnchor = this.ensureModuleAnchor(targetFile);
        this.addEdge(fromAnchor, toAnchor, 'import');
      }
    }

    for (const [importerFile, targets] of this.typeOnlyInternalImportTargetsByFile.entries()) {
      const fromAnchor = this.ensureModuleAnchor(importerFile);
      for (const targetFile of targets) {
        const toAnchor = this.ensureModuleAnchor(targetFile);
        this.addEdge(fromAnchor, toAnchor, 'type-import');
      }
    }

    for (const [exporterFile, targets] of this.typeOnlyInternalExportTargetsByFile.entries()) {
      const fromAnchor = this.ensureModuleAnchor(exporterFile);
      for (const targetFile of targets) {
        const toAnchor = this.ensureModuleAnchor(targetFile);
        this.addEdge(fromAnchor, toAnchor, 'type-export');
      }
    }

    for (const [reExporterFile, targets] of this.reExportTargetsByFile.entries()) {
      const fromAnchor = this.ensureModuleAnchor(reExporterFile);
      for (const targetFile of targets) {
        const toAnchor = this.ensureModuleAnchor(targetFile);
        this.addEdge(fromAnchor, toAnchor, 're-export');
      }
    }
  }

  private emitImportCycles(): void {
    const moduleFiles = new Set<string>([
      ...Array.from(this.moduleAnchorIdByFile.keys()),
      ...Array.from(this.internalImportTargetsByFile.keys()),
      ...Array.from(this.internalImportTargetsByFile.values()).flatMap((targets) => Array.from(targets)),
    ]);
    if (moduleFiles.size === 0) {
      return;
    }

    const adjacency = new Map<string, string[]>();
    for (const filePath of moduleFiles) {
      adjacency.set(filePath, Array.from(this.internalImportTargetsByFile.get(filePath) || []));
    }

    const indexMap = new Map<string, number>();
    const lowLinkMap = new Map<string, number>();
    const stack: string[] = [];
    const inStack = new Set<string>();
    let index = 0;

    const markStronglyConnected = (node: string, components: string[][]): void => {
      indexMap.set(node, index);
      lowLinkMap.set(node, index);
      index++;
      stack.push(node);
      inStack.add(node);

      for (const neighbor of adjacency.get(node) || []) {
        if (!indexMap.has(neighbor)) {
          markStronglyConnected(neighbor, components);
          const nextLow = Math.min(lowLinkMap.get(node)!, lowLinkMap.get(neighbor)!);
          lowLinkMap.set(node, nextLow);
        } else if (inStack.has(neighbor)) {
          const nextLow = Math.min(lowLinkMap.get(node)!, indexMap.get(neighbor)!);
          lowLinkMap.set(node, nextLow);
        }
      }

      if (lowLinkMap.get(node) === indexMap.get(node)) {
        const component: string[] = [];
        while (stack.length > 0) {
          const popped = stack.pop()!;
          inStack.delete(popped);
          component.push(popped);
          if (popped === node) {
            break;
          }
        }
        components.push(component);
      }
    };

    const components: string[][] = [];
    for (const node of adjacency.keys()) {
      if (!indexMap.has(node)) {
        markStronglyConnected(node, components);
      }
    }

    for (const component of components) {
      const componentSet = new Set(component);
      const hasSelfLoop = component.length === 1
        && (adjacency.get(component[0]) || []).includes(component[0]);
      if (component.length < 2 && !hasSelfLoop) {
        continue;
      }

      for (const fromFile of component) {
        const fromAnchor = this.ensureModuleAnchor(fromFile);
        for (const toFile of adjacency.get(fromFile) || []) {
          if (!componentSet.has(toFile)) {
            continue;
          }
          const toAnchor = this.ensureModuleAnchor(toFile);
          this.addEdge(fromAnchor, toAnchor, 'import-cycle');
        }
      }
    }
  }

  private resolveSymbolInFileByName(relativeFilePath: string, symbolName: string): string | null {
    for (const [id, fn] of this.functions.entries()) {
      if (fn.file === relativeFilePath && fn.name === symbolName) {
        return id;
      }
    }

    for (const [id, classNode] of this.classes.entries()) {
      if (classNode.file === relativeFilePath && classNode.name === symbolName) {
        return id;
      }
    }

    for (const [id, interfaceNode] of this.interfaces.entries()) {
      if (interfaceNode.file === relativeFilePath && interfaceNode.name === symbolName) {
        return id;
      }
    }

    for (const [id, aliasNode] of this.typeAliases.entries()) {
      if (aliasNode.file === relativeFilePath && aliasNode.name === symbolName) {
        return id;
      }
    }

    for (const [id, enumNode] of this.enums.entries()) {
      if (enumNode.file === relativeFilePath && enumNode.name === symbolName) {
        return id;
      }
    }

    for (const [id, namespaceNode] of this.namespaces.entries()) {
      if (namespaceNode.file === relativeFilePath && namespaceNode.name === symbolName) {
        return id;
      }
    }

    for (const [id, variable] of this.variables.entries()) {
      if (variable.file === relativeFilePath && variable.name === symbolName) {
        return id;
      }
    }

    return null;
  }

  private emitTypeRelationshipEdges(
    node: ts.ClassDeclaration | ts.InterfaceDeclaration,
    sourceId: string,
    filePath: string,
  ): void {
    if (!node.heritageClauses) {
      return;
    }

    for (const heritage of node.heritageClauses) {
      const edgeKind = heritage.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
      for (const typeNode of heritage.types) {
        const targetName = this.getEntityNameText(typeNode.expression);
        if (!targetName) continue;
        const targetId = this.resolveTypeLikeSymbol(targetName, filePath);
        if (targetId) {
          this.addEdge(sourceId, targetId, edgeKind);
        }
        for (const tArg of typeNode.typeArguments || []) {
          const argTarget = this.resolveTypeLikeNode(tArg, filePath);
          if (argTarget) {
            this.addEdge(sourceId, argTarget, 'type-ref');
          }
        }
      }
    }
  }

  private emitTypeReferenceEdges(node: ts.Node, sourceId: string, filePath: string): void {
    const visit = (n: ts.Node): void => {
      if (ts.isTypeReferenceNode(n)) {
        const target = this.resolveTypeLikeNode(n, filePath);
        if (target) {
          this.addEdge(sourceId, target, 'type-ref');
        }
      } else if (ts.isExpressionWithTypeArguments(n)) {
        const targetName = this.getEntityNameText(n.expression);
        if (targetName) {
          const targetId = this.resolveTypeLikeSymbol(targetName, filePath);
          if (targetId) {
            this.addEdge(sourceId, targetId, 'type-ref');
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
  }

  private emitGenericConstraintEdges(node: ts.Node, sourceId: string, filePath: string): void {
    const typeParameters = this.getTypeParameters(node);
    for (const typeParam of typeParameters) {
      if (!typeParam.constraint) continue;
      const target = this.resolveTypeLikeNode(typeParam.constraint, filePath);
      if (target) {
        this.addEdge(sourceId, target, 'type-constraint');
      }
    }
  }

  private getTypeParameters(node: ts.Node): ts.NodeArray<ts.TypeParameterDeclaration> {
    if (
      ts.isFunctionDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isArrowFunction(node)
      || ts.isFunctionExpression(node)
    ) {
      return node.typeParameters ?? ts.factory.createNodeArray<ts.TypeParameterDeclaration>([]);
    }
    return ts.factory.createNodeArray<ts.TypeParameterDeclaration>([]);
  }

  private emitDecoratorEdges(node: ts.Node, sourceId: string, filePath: string): void {
    if (!ts.canHaveDecorators(node)) {
      return;
    }

    const decorators = ts.getDecorators(node) || [];
    for (const decorator of decorators) {
      const target = this.resolveDecoratorTarget(decorator.expression, filePath);
      if (target) {
        this.addEdge(sourceId, target, 'decorator');
      }
    }
  }

  private resolveDecoratorTarget(expression: ts.LeftHandSideExpression, filePath: string): string | null {
    if (ts.isIdentifier(expression)) {
      return this.resolveCalleeToFunction(expression.text, filePath)
        ?? this.resolveTypeLikeSymbol(expression.text, filePath)
        ?? this.resolveExternalSymbolByIdentifier(expression.text, filePath);
    }

    if (ts.isCallExpression(expression)) {
      return this.resolveDecoratorTarget(expression.expression, filePath);
    }

    if (ts.isPropertyAccessExpression(expression)) {
      const baseName = ts.isIdentifier(expression.expression) ? expression.expression.text : null;
      if (!baseName) return null;
      return this.resolveExternalSymbolByIdentifier(baseName, filePath)
        ?? this.resolveTypeLikeSymbol(baseName, filePath)
        ?? this.resolveCalleeToFunction(expression.name.text, filePath);
    }

    return null;
  }

  private resolveExternalSymbolByIdentifier(identifier: string, filePath: string): string | null {
    const importedSymbols = this.importedExternalSymbolsByFile.get(filePath);
    if (!importedSymbols) {
      return null;
    }
    return importedSymbols.get(identifier) ?? null;
  }

  private emitModuleAugmentationEdge(moduleName: string, filePath: string, sourceNamespaceId: string): void {
    if (!moduleName) {
      return;
    }

    if (moduleName.startsWith('.')) {
      const target = this.resolveInternalModulePath(filePath, moduleName);
      if (target) {
        const toAnchor = this.ensureModuleAnchor(target);
        this.addEdge(sourceNamespaceId, toAnchor, 'module-augmentation');
      }
      return;
    }

    const externalId = `ext:${moduleName}`;
    if (!this.externalModules.has(externalId)) {
      this.externalModules.set(externalId, {
        id: externalId,
        name: moduleName,
        type: 'external',
      });
    }
    this.addEdge(sourceNamespaceId, externalId, 'module-augmentation');
  }

  private recordEnumMemberUsage(node: ts.PropertyAccessExpression, filePath: string): void {
    const caller = this.findEnclosingFunction(node, filePath);
    if (!caller) {
      return;
    }

    if (!ts.isIdentifier(node.expression)) {
      return;
    }

    const enumTarget = this.resolveTypeLikeSymbol(node.expression.text, filePath, ['enum']);
    if (enumTarget) {
      this.addEdge(caller, enumTarget, 'enum-member-read');
    }
  }

  private getEntityNameText(name: ts.EntityName | ts.Expression): string | null {
    if (ts.isIdentifier(name)) {
      return name.text;
    }
    if (ts.isQualifiedName(name)) {
      return name.right.text;
    }
    if (ts.isPropertyAccessExpression(name)) {
      return name.name.text;
    }
    return null;
  }

  private resolveTypeLikeNode(typeNode: ts.TypeNode, filePath: string): string | null {
    if (ts.isTypeReferenceNode(typeNode)) {
      const name = this.getEntityNameText(typeNode.typeName);
      return name ? this.resolveTypeLikeSymbol(name, filePath) : null;
    }

    if (ts.isExpressionWithTypeArguments(typeNode)) {
      const name = this.getEntityNameText(typeNode.expression);
      return name ? this.resolveTypeLikeSymbol(name, filePath) : null;
    }

    if (ts.isTypeQueryNode(typeNode) && ts.isIdentifier(typeNode.exprName)) {
      return this.resolveTypeLikeSymbol(typeNode.exprName.text, filePath);
    }

    return null;
  }

  private resolveTypeLikeSymbol(
    symbolName: string,
    filePath: string,
    allowedKinds: Array<'class' | 'interface' | 'type-alias' | 'enum' | 'namespace'> = ['class', 'interface', 'type-alias', 'enum', 'namespace'],
  ): string | null {
    const relativeFile = path.relative(this.sourceDir, filePath).replace(/\\/g, '/');

    const searchInMap = <T extends { file: string; name: string }>(entries: Iterable<[string, T]>): string | null => {
      for (const [id, node] of entries) {
        if (node.file === relativeFile && node.name === symbolName) {
          return id;
        }
      }
      for (const [id, node] of entries) {
        if (node.name === symbolName) {
          return id;
        }
      }
      return null;
    };

    if (allowedKinds.includes('class')) {
      const hit = searchInMap(this.classes.entries());
      if (hit) return hit;
    }
    if (allowedKinds.includes('interface')) {
      const hit = searchInMap(this.interfaces.entries());
      if (hit) return hit;
    }
    if (allowedKinds.includes('type-alias')) {
      const hit = searchInMap(this.typeAliases.entries());
      if (hit) return hit;
    }
    if (allowedKinds.includes('enum')) {
      const hit = searchInMap(this.enums.entries());
      if (hit) return hit;
    }
    if (allowedKinds.includes('namespace')) {
      const hit = searchInMap(this.namespaces.entries());
      if (hit) return hit;
    }

    return null;
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
        const lineNumber = this.getLineNumber(current, filePath);
        const overloadId = `overload:${current.name.text}:${lineNumber}@${filePath}`;
        if (!current.body && this.functions.has(overloadId)) {
          return overloadId;
        }
        const id = `${current.name.text}@${filePath}`;
        if (this.functions.has(id)) {
          return id;
        }
      }

      if (ts.isMethodDeclaration(current) && current.name && typeof current.name === 'object') {
        const methodName = (current.name as any).text;
        const lineNumber = this.getLineNumber(current, filePath);
        const overloadId = `overload:${methodName}:${lineNumber}@${filePath}`;
        if (!current.body && this.functions.has(overloadId)) {
          return overloadId;
        }
        const id = `${methodName}@${filePath}`;
        if (this.functions.has(id)) {
          return id;
        }
      }

      if (ts.isConstructorDeclaration(current)) {
        const lineNumber = this.getLineNumber(current, filePath);
        const className = this.getEnclosingClassName(current) ?? 'AnonymousClass';
        const id = `constructor:${className}:${lineNumber}@${filePath}`;
        if (this.functions.has(id)) {
          return id;
        }
      }

      if ((ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) && current.name && ts.isIdentifier(current.name)) {
        const lineNumber = this.getLineNumber(current, filePath);
        const className = this.getEnclosingClassName(current) ?? 'AnonymousClass';
        const accessorKind = ts.isGetAccessorDeclaration(current) ? 'get' : 'set';
        const id = `${accessorKind}:${className}.${current.name.text}:${lineNumber}@${filePath}`;
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
      ([id, func]) => id.endsWith(filePath) && func.name === calleeName && !id.startsWith('overload:')
    );

    if (sameFileMatches.length > 0) {
      return sameFileMatches[0][0];
    }

    // Then try to find in any file
    const anyFileMatches = Array.from(this.functions.entries()).filter(
      ([id, func]) => func.name === calleeName && !id.startsWith('overload:')
    );

    if (anyFileMatches.length > 0) {
      return anyFileMatches[0][0];
    }

    return null;
  }
}


