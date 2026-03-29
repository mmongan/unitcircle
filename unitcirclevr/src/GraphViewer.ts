/**
 * GraphViewer - Interactive viewer for code graph JSON data
 * Displays nodes, edges, and provides filtering and search capabilities
 */

export interface GraphData {
  nodes: CodeNode[];
  edges: FunctionCall[];
  lastUpdated: string;
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

export interface FunctionNode {
  id: string;
  name: string;
  file: string;
  line: number;
  isExported: boolean;
  type: 'function';
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

export class GraphViewer {
  private graphData: GraphData | null = null;
  private filteredNodes: CodeNode[] = [];
  private filteredEdges: FunctionCall[] = [];
  private searchTerm: string = '';
  private filterType: string = 'all';
  private containerSelector: string;

  constructor(containerSelector: string) {
    this.containerSelector = containerSelector;
  }

  /**
   * Load graph data from JSON file
   */
  async loadGraph(jsonPath: string = '/unitcircle/graph.json'): Promise<void> {
    try {
      const response = await fetch(jsonPath);
      if (!response.ok) {
        throw new Error(`Failed to load graph: ${response.statusText}`);
      }
      this.graphData = await response.json();
      if (this.graphData) {
        this.filteredNodes = [...this.graphData.nodes];
        this.filteredEdges = [...this.graphData.edges];
      }
      this.render();
    } catch (error) {
      this.showError(`Error loading graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search for nodes by name
   */
  search(term: string): void {
    this.searchTerm = term.toLowerCase();
    this.applyFilters();
  }

  /**
   * Filter nodes by type
   */
  filterByType(type: string): void {
    this.filterType = type;
    this.applyFilters();
  }

  /**
   * Apply all active filters
   */
  private applyFilters(): void {
    if (!this.graphData) return;

    this.filteredNodes = this.graphData.nodes.filter(node => {
      // Type filter
      if (this.filterType !== 'all' && node.type !== this.filterType) {
        return false;
      }

      // Search filter
      if (this.searchTerm) {
        const nodeId = 'id' in node ? node.id : '';
        const nodeName = 'name' in node ? node.name : '';
        const nodeFile = 'file' in node ? node.file : '';

        return (
          nodeId.toLowerCase().includes(this.searchTerm) ||
          nodeName.toLowerCase().includes(this.searchTerm) ||
          nodeFile.toLowerCase().includes(this.searchTerm)
        );
      }

      return true;
    });

    // Filter edges to only include visible nodes
    const visibleIds = new Set(this.filteredNodes.map(n => n.id));
    this.filteredEdges = this.graphData.edges.filter(
      edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)
    );

    this.render();
  }

  /**
   * Get statistics about the graph
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
   * Get node by ID
   */
  getNode(nodeId: string): CodeNode | undefined {
    if (!this.graphData) return undefined;
    return this.graphData.nodes.find(n => n.id === nodeId);
  }

  /**
   * Render the viewer UI
   */
  private render(): void {
    const container = document.querySelector(this.containerSelector);
    if (!container) return;

    if (!this.graphData) {
      container.innerHTML = '<p>Loading graph data...</p>';
      return;
    }

    const stats = this.getStats();
    const html = `
      <div class="graph-viewer">
        <div class="viewer-header">
          <h2>Code Graph Viewer</h2>
          <div class="viewer-stats">
            <span class="stat">📦 Functions: ${stats.functions}</span>
            <span class="stat">🏛️ Classes: ${stats.classes}</span>
            <span class="stat">🧩 Interfaces: ${stats.interfaces}</span>
            <span class="stat">🏷️ Types: ${stats.typeAliases}</span>
            <span class="stat">🔢 Enums: ${stats.enums}</span>
            <span class="stat">📚 Namespaces: ${stats.namespaces}</span>
            <span class="stat">📝 Variables: ${stats.variables}</span>
            <span class="stat">🔗 External: ${stats.externalModules}</span>
            <span class="stat">➡️ Calls: ${stats.totalEdges}</span>
            <span class="stat">⏱️ Updated: ${new Date(stats.lastUpdated).toLocaleString()}</span>
          </div>
        </div>

        <div class="viewer-controls">
          <input
            type="text"
            class="search-input"
            placeholder="Search nodes..."
            id="search-input"
            value="${this.searchTerm}"
          />
          <select class="filter-select" id="filter-select">
            <option value="all" ${this.filterType === 'all' ? 'selected' : ''}>All Types</option>
            <option value="function" ${this.filterType === 'function' ? 'selected' : ''}>Functions</option>
            <option value="class" ${this.filterType === 'class' ? 'selected' : ''}>Classes</option>
            <option value="interface" ${this.filterType === 'interface' ? 'selected' : ''}>Interfaces</option>
            <option value="type-alias" ${this.filterType === 'type-alias' ? 'selected' : ''}>Type Aliases</option>
            <option value="enum" ${this.filterType === 'enum' ? 'selected' : ''}>Enums</option>
            <option value="namespace" ${this.filterType === 'namespace' ? 'selected' : ''}>Namespaces</option>
            <option value="variable" ${this.filterType === 'variable' ? 'selected' : ''}>Variables</option>
            <option value="external" ${this.filterType === 'external' ? 'selected' : ''}>External</option>
          </select>
          <span class="result-count">${this.filteredNodes.length} / ${this.graphData.nodes.length} nodes</span>
        </div>

        <div class="viewer-tabs">
          <button class="tab-button active" data-tab="nodes">Nodes (${this.filteredNodes.length})</button>
          <button class="tab-button" data-tab="edges">Edges (${this.filteredEdges.length})</button>
        </div>

        <div id="nodes-tab" class="tab-content active">
          ${this.renderNodesTable()}
        </div>

        <div id="edges-tab" class="tab-content">
          ${this.renderEdgesTable()}
        </div>
      </div>
    `;

    container.innerHTML = html;
    this.setupEventListeners();
  }

  /**
   * Render nodes table
   */
  private renderNodesTable(): string {
    if (this.filteredNodes.length === 0) {
      return '<p class="no-results">No nodes match your search.</p>';
    }

    const nodeRows = this.filteredNodes
      .map(node => this.renderNodeRow(node))
      .join('');

    return `
      <table class="nodes-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Type</th>
            <th>File</th>
            <th>Line</th>
            <th>Exported</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${nodeRows}
        </tbody>
      </table>
    `;
  }

  /**
   * Render a single node row
   */
  private renderNodeRow(node: CodeNode): string {
    const nodeId = node.id;
    const name = 'name' in node ? node.name : nodeId;
    const file = 'file' in node ? node.file : '—';
    const line = 'line' in node ? node.line : '—';
    const exported = 'isExported' in node ? (node.isExported ? '✅' : '❌') : '—';
    const typeColor = this.getTypeColor(node.type);

    let actions = '';
    if (node.type !== 'external') {
      const callsFrom = this.findCallsFrom(nodeId).length;
      const callsTo = this.findCallsTo(nodeId).length;
      actions = `<span class="calls-badge">${callsFrom} → ${callsTo}</span>`;
    }

    return `
      <tr class="node-row" data-node-id="${nodeId}">
        <td><code>${nodeId}</code></td>
        <td><strong>${name}</strong></td>
        <td><span class="type-badge" style="background-color: ${typeColor}">${node.type}</span></td>
        <td><code>${file}</code></td>
        <td>${line}</td>
        <td>${exported}</td>
        <td>${actions}</td>
      </tr>
    `;
  }

  /**
   * Render edges table
   */
  private renderEdgesTable(): string {
    if (this.filteredEdges.length === 0) {
      return '<p class="no-results">No edges match your search.</p>';
    }

    const edgeRows = this.filteredEdges
      .map(edge => this.renderEdgeRow(edge))
      .join('');

    return `
      <table class="edges-table">
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>From Type</th>
            <th>To Type</th>
          </tr>
        </thead>
        <tbody>
          ${edgeRows}
        </tbody>
      </table>
    `;
  }

  /**
   * Render a single edge row
   */
  private renderEdgeRow(edge: FunctionCall): string {
    const fromNode = this.getNode(edge.from);
    const toNode = this.getNode(edge.to);

    const fromName = fromNode && 'name' in fromNode ? fromNode.name : edge.from;
    const toName = toNode && 'name' in toNode ? toNode.name : edge.to;
    const fromType = fromNode?.type ?? 'unknown';
    const toType = toNode?.type ?? 'unknown';

    return `
      <tr class="edge-row">
        <td><strong>${fromName}</strong></td>
        <td><strong>${toName}</strong></td>
        <td><span class="type-badge" style="background-color: ${this.getTypeColor(fromType)}">${fromType}</span></td>
        <td><span class="type-badge" style="background-color: ${this.getTypeColor(toType)}">${toType}</span></td>
      </tr>
    `;
  }

  /**
   * Get color for node type
   */
  private getTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      function: '#4A9EFF',
      class: '#35b26f',
      interface: '#6f8cff',
      'type-alias': '#9f7aea',
      enum: '#f97316',
      namespace: '#14b8a6',
      variable: '#FFD700',
      external: '#00D4FF'
    };
    return colors[type] || '#808080';
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const filterSelect = document.getElementById('filter-select') as HTMLSelectElement;
    const tabButtons = document.querySelectorAll('.tab-button');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.search((e.target as HTMLInputElement).value);
      });
    }

    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        this.filterByType((e.target as HTMLSelectElement).value);
      });
    }

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.switchTab(button);
      });
    });
  }

  /**
   * Switch between tabs
   */
  private switchTab(button: Element): void {
    const tabName = button.getAttribute('data-tab');
    if (!tabName) return;

    // Update button states
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    // Update content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });

    const tabContent = document.getElementById(`${tabName}-tab`);
    if (tabContent) {
      tabContent.classList.add('active');
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    const container = document.querySelector(this.containerSelector);
    if (container) {
      container.innerHTML = `<div class="error-message">❌ ${message}</div>`;
    }
  }
}
