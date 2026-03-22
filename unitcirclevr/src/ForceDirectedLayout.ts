/**
 * Simple 3D Layout System - Random distributed placement
 * 
 * Minimal layout approach:
 * - Nodes placed randomly in 3D space
 * - No iterative simulation
 * - No forces or physics
 * - Provides initial separation of nodes across full volume
 */

export interface Node {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  label: string;
}

export interface Edge {
  source: string;
  target: string;
}

export class ForceDirectedLayout {
  private nodes: Map<string, Node>;
  private readonly SPACE_SIZE = 250;  // Visible spread that camera can frame at Z=-800

  constructor(nodeIds: string[], _edges: Edge[]) {
    this.nodes = new Map();

    // Place nodes randomly across full 3D space
    for (const id of nodeIds) {
      this.nodes.set(id, {
        id,
        label: id.split('@')[0],
        position: {
          x: (Math.random() - 0.5) * 2 * this.SPACE_SIZE,
          y: (Math.random() - 0.5) * 2 * this.SPACE_SIZE,
          z: (Math.random() - 0.5) * 2 * this.SPACE_SIZE
        },
        velocity: { x: 0, y: 0, z: 0 }
      });
    }
  }

  /**
   * Run layout simulation (no-op for random placement)
   * Nodes already positioned in constructor
   */
  public simulate(): Map<string, Node> {
    return this.nodes;
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }
}
