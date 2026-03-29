/**
 * VRGraphViewer - Load and render prebuilt graph.json files in 3D VR
 * Combines GraphViewer's data loading with VRSceneManager's visualization
 */

import { VRSceneManager } from './VRSceneManager';

export interface GraphData {
  nodes: CodeNode[];
  edges: FunctionCall[];
  lastUpdated: string;
}

export type CodeNode =
  | FunctionNode
  | ModuleAnchorNode
  | ClassNode
  | InterfaceNode
  | TypeAliasNode
  | EnumNode
  | NamespaceNode
  | GlobalVariable
  | ExternalModule;

export interface FunctionNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'function';
}

export interface ModuleAnchorNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'module-anchor';
}

export interface ClassNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'class';
}

export interface InterfaceNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'interface';
}

export interface TypeAliasNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'type-alias';
}

export interface EnumNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'enum';
}

export interface NamespaceNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'namespace';
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

export interface FunctionCall {
  from: string;
  to: string;
}

export class VRGraphViewer {
  private graphData: GraphData | null = null;
  private currentData: GraphData | null = null;
  private vrSceneManager: VRSceneManager;
  private isInitialized: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.vrSceneManager = new VRSceneManager(canvas);
  }

  /**
   * Load graph data from JSON file and render in VR
   */
  async loadGraph(jsonPath: string = '/unitcircle/graph.json'): Promise<void> {
    try {
      const response = await fetch(jsonPath);
      if (!response.ok) {
        throw new Error(`Failed to load graph: ${response.statusText}`);
      }
      this.graphData = await response.json();
      this.currentData = JSON.parse(JSON.stringify(this.graphData)); // Deep copy
      this.renderGraph();
    } catch (error) {
      console.error(`Error loading graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render the loaded graph in VR
   */
  private renderGraph(): void {
    if (!this.currentData) return;

    // Use existing VRSceneManager to render the graph
    this.vrSceneManager.renderCodeGraph(this.currentData as any);
    this.isInitialized = true;
  }

  /**
   * Start the VR scene rendering loop
   */
  run(): void {
    this.vrSceneManager.run();
  }

  /**
   * Stop and dispose of the VR scene
   */
  dispose(): void {
    this.vrSceneManager.dispose();
  }

  /**
   * Update visualization with new graph data
   */
  async refreshGraph(jsonPath: string = '/unitcircle/graph.json'): Promise<void> {
    this.dispose();
    await this.loadGraph(jsonPath);
    this.run();
  }

  /**
   * Get current (possibly filtered) graph data
   */
  getGraphData(): GraphData | null {
    return this.currentData;
  }

  /**
   * Get original unfiltered graph data
   */
  getOriginalGraphData(): GraphData | null {
    return this.graphData;
  }

  /**
   * Get node count
   */
  getNodeCount(): number {
    if (!this.currentData) return 0;
    return this.currentData.nodes.length;
  }

  /**
   * Get edge count
   */
  getEdgeCount(): number {
    if (!this.currentData) return 0;
    return this.currentData.edges.length;
  }

  /**
   * Filter and re-render with only specific node types
   * @param types Array of node types to show
   */
  showNodeTypes(...types: Array<'function' | 'module-anchor' | 'class' | 'interface' | 'type-alias' | 'enum' | 'namespace' | 'variable' | 'external'>): void {
    if (!this.graphData) return;

    const filteredData: GraphData = {
      nodes: this.graphData.nodes.filter(node => types.includes(node.type as any)),
      edges: this.graphData.edges,
      lastUpdated: this.graphData.lastUpdated
    };

    // Filter edges to only include visible nodes
    const visibleIds = new Set(filteredData.nodes.map(n => n.id));
    filteredData.edges = filteredData.edges.filter(
      edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)
    );

    this.currentData = filteredData;
    this.vrSceneManager.renderCodeGraph(filteredData as any);
  }

  /**
   * Show only exported nodes
   */
  showExportedOnly(): void {
    if (!this.graphData) return;

    const filteredData: GraphData = {
      nodes: this.graphData.nodes.filter(node => 'isExported' in node && node.isExported),
      edges: this.graphData.edges,
      lastUpdated: this.graphData.lastUpdated
    };

    const visibleIds = new Set(filteredData.nodes.map(n => n.id));
    filteredData.edges = filteredData.edges.filter(
      edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)
    );

    this.currentData = filteredData;
    this.vrSceneManager.renderCodeGraph(filteredData as any);
  }

  /**
   * Show all nodes (reset filters)
   */
  showAll(): void {
    if (!this.graphData) return;
    this.currentData = JSON.parse(JSON.stringify(this.graphData)); // Deep copy
    this.vrSceneManager.renderCodeGraph(this.currentData as any);
  }

  /**
   * Get statistics about the loaded graph
   */
  getStats() {
    if (!this.graphData) {
      return {
        totalNodes: 0,
        functions: 0,
        classes: 0,
        interfaces: 0,
        typeAliases: 0,
        enums: 0,
        namespaces: 0,
        variables: 0,
        externalModules: 0,
        totalEdges: 0,
        lastUpdated: ''
      };
    }

    return {
      totalNodes: this.graphData.nodes.length,
      functions: this.graphData.nodes.filter(n => n.type === 'function').length,
      classes: this.graphData.nodes.filter(n => n.type === 'class').length,
      interfaces: this.graphData.nodes.filter(n => n.type === 'interface').length,
      typeAliases: this.graphData.nodes.filter(n => n.type === 'type-alias').length,
      enums: this.graphData.nodes.filter(n => n.type === 'enum').length,
      namespaces: this.graphData.nodes.filter(n => n.type === 'namespace').length,
      variables: this.graphData.nodes.filter(n => n.type === 'variable').length,
      externalModules: this.graphData.nodes.filter(n => n.type === 'external').length,
      totalEdges: this.graphData.edges.length,
      lastUpdated: this.graphData.lastUpdated
    };
  }

  /**
   * Find a node by ID
   */
  getNode(nodeId: string): CodeNode | undefined {
    if (!this.graphData) return undefined;
    return this.graphData.nodes.find(n => n.id === nodeId);
  }

  /**
   * Find all calls from a specific node
   */
  findCallsFrom(nodeId: string): FunctionCall[] {
    if (!this.graphData) return [];
    return this.graphData.edges.filter(edge => edge.from === nodeId);
  }

  /**
   * Find all calls to a specific node
   */
  findCallsTo(nodeId: string): FunctionCall[] {
    if (!this.graphData) return [];
    return this.graphData.edges.filter(edge => edge.to === nodeId);
  }

  /**
   * Check if viewer is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}
