/**
 * ForceDirectedLayout - Simplified 3D force-directed graph layout
 * 
 * Uses basic physics:
 * - Repulsive forces between all nodes (push apart)
 * - Attractive forces along edges (pull together)
 * - Velocity damping for stability
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
  private edges: Edge[];
  
  // Force parameters
  private readonly C_REPULSIVE = 500;   // Repulsive force constant (massive repulsion)
  private readonly C_ATTRACTIVE = 0.02; // Attractive force constant (minimal attraction)
  private readonly DAMPING = 0.60;      // Velocity damping (allow accumulation)
  private readonly dt = 0.05;           // Time step for integration (large steps)

  constructor(nodeIds: string[], edges: Edge[]) {
    this.nodes = new Map();
    this.edges = edges;

    // Initialize nodes randomly within a 3x3x3 unit volume
    // Centered at origin: -1.5 to 1.5 on each axis
    const VOLUME_SIZE = 1.5;
    
    for (const id of nodeIds) {
      this.nodes.set(id, {
        id,
        label: id.split('@')[0],
        position: {
          x: (Math.random() - 0.5) * 2 * VOLUME_SIZE,
          y: (Math.random() - 0.5) * 2 * VOLUME_SIZE,
          z: (Math.random() - 0.5) * 2 * VOLUME_SIZE
        },
        velocity: { x: 0, y: 0, z: 0 }
      });
    }
  }

  /**
   * Run force-directed layout simulation
   */
  public simulate(iterations: number = 100): Map<string, Node> {
    for (let i = 0; i < iterations; i++) {
      this.step();
    }
    this.constrainBounds();
    return this.nodes;
  }

  /**
   * Single simulation step: calculate forces and update positions
   */
  private step(): void {
    const nodeArray = Array.from(this.nodes.values());
    
    // Calculate forces for all nodes
    const forces = new Map<string, { x: number; y: number; z: number }>();
    
    // Initialize force vectors
    for (const node of nodeArray) {
      forces.set(node.id, { x: 0, y: 0, z: 0 });
    }

    // Repulsive forces (all pairs)
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const n1 = nodeArray[i];
        const n2 = nodeArray[j];
        
        const dx = n2.position.x - n1.position.x;
        const dy = n2.position.y - n1.position.y;
        const dz = n2.position.z - n1.position.z;
        
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
        const force = this.C_REPULSIVE / (dist * dist);
        
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        
        const f1 = forces.get(n1.id)!;
        const f2 = forces.get(n2.id)!;
        
        f1.x -= fx;
        f1.y -= fy;
        f1.z -= fz;
        f2.x += fx;
        f2.y += fy;
        f2.z += fz;
      }
    }

    // Attractive forces (along edges)
    for (const edge of this.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);
      
      if (source && target) {
        const dx = target.position.x - source.position.x;
        const dy = target.position.y - source.position.y;
        const dz = target.position.z - source.position.z;
        
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.1;
        const force = dist * this.C_ATTRACTIVE;
        
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        
        const fs = forces.get(source.id)!;
        const ft = forces.get(target.id)!;
        
        fs.x += fx;
        fs.y += fy;
        fs.z += fz;
        ft.x -= fx;
        ft.y -= fy;
        ft.z -= fz;
      }
    }

    // Update velocities and positions
    for (const node of nodeArray) {
      const force = forces.get(node.id)!;
      
      // Euler integration with damping
      node.velocity.x = (node.velocity.x + force.x * this.dt) * this.DAMPING;
      node.velocity.y = (node.velocity.y + force.y * this.dt) * this.DAMPING;
      node.velocity.z = (node.velocity.z + force.z * this.dt) * this.DAMPING;
      
      node.position.x += node.velocity.x * this.dt;
      node.position.y += node.velocity.y * this.dt;
      node.position.z += node.velocity.z * this.dt;
    }
  }

  /**
   * Keep nodes within world bounds
   */
  private constrainBounds(): void {
    const BOUND = 300;  // Expanded bounds to allow wider spreading
    for (const node of this.nodes.values()) {
      node.position.x = Math.max(-BOUND, Math.min(BOUND, node.position.x));
      node.position.y = Math.max(-BOUND, Math.min(BOUND, node.position.y));
      node.position.z = Math.max(-BOUND, Math.min(BOUND, node.position.z));
    }
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }
}
