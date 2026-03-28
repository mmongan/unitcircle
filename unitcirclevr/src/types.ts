/**
 * Shared type definitions for the VR visualization system
 */

export type NodeType = 'function' | 'variable' | 'external';

export interface GraphNode {
  id: string;
  name: string;
  file?: string;
  line?: number;
  isExported?: boolean;
  type?: NodeType;
  code?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind?: 'call' | 'var-read' | 'var-write';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  files?: string[];
  lastUpdated: string;
}

export interface LayoutNode {
  position: {
    x: number;
    y: number;
    z: number;
  };
  velocity: {
    x: number;
    y: number;
    z: number;
  };
}
