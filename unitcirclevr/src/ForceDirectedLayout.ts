/**
 * ForceDirectedLayout - Force-directed graph layout for 3D visualization
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
  private k: number = 1; // Optimal distance
  private repulsiveForce: number = 0.2; // Repulsive force strength (lower = stronger repulsion)
  private attractiveForce: number = 0.1; // Attractive force strength
  private damping: number = 0.95; // Velocity damping
  private minSeparation: number = 5; // Minimum distance between node centers (cube size 4.0 + buffer)

  constructor(nodeIds: string[], edges: Edge[]) {
    this.nodes = new Map();
    this.edges = edges;

    // Initialize nodes with random positions
    for (const id of nodeIds) {
      this.nodes.set(id, {
        id,
        position: {
          x: (Math.random() - 0.5) * 10,
          y: (Math.random() - 0.5) * 10,
          z: (Math.random() - 0.5) * 10
        },
        velocity: { x: 0, y: 0, z: 0 },
        label: id.split('@')[0]
      });
    }

    // Pre-calculate optimal distance based on number of nodes
    this.k = Math.sqrt(1000 / nodeIds.length);
  }

  /**
   * Run the force-directed layout algorithm for a given number of iterations
   */
  public simulate(iterations: number = 100): Map<string, Node> {
    this.initializeNodeData();
    for (let i = 0; i < iterations; i++) {
      this.simulationStep();
    }
    this.constrainNodePositions();
    return this.nodes;
  }

  private initializeNodeData(): void {
    // Ensure all nodes have proper initial state
    for (const node of this.nodes.values()) {
      if (!node.velocity) {
        node.velocity = { x: 0, y: 0, z: 0 };
      }
    }
  }

  private constrainNodePositions(): void {
    // Ensure nodes stay within bounds (±50 on each axis)
    const BOUND = 50;
    for (const node of this.nodes.values()) {
      node.position.x = Math.max(-BOUND, Math.min(BOUND, node.position.x));
      node.position.y = Math.max(-BOUND, Math.min(BOUND, node.position.y));
      node.position.z = Math.max(-BOUND, Math.min(BOUND, node.position.z));
    }
  }

  private simulationStep(): void {
    const forces = this.calculateForces();
    this.applyForces(forces);
  }

  private calculateForces(): Map<string, { x: number; y: number; z: number }> {
    const forces = new Map<string, { x: number; y: number; z: number }>();
    for (const id of this.nodes.keys()) {
      forces.set(id, { x: 0, y: 0, z: 0 });
    }

    this.applyRepulsiveForces(forces);
    this.applyAttractiveForces(forces);
    return forces;
  }

  private applyRepulsiveForces(forces: Map<string, { x: number; y: number; z: number }>): void {
    // Calculate repulsive forces between all node pairs
    const nodeArray = Array.from(this.nodes.values());
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const n1 = nodeArray[i];
        const n2 = nodeArray[j];

        const dx = n2.position.x - n1.position.x;
        const dy = n2.position.y - n1.position.y;
        const dz = n2.position.z - n1.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;

        // Enforce minimum separation - push nodes apart if too close
        if (distance < this.minSeparation) {
          const pushForce = (this.minSeparation - distance) * 2; // Exponential push force
          const fx = (dx / distance) * pushForce;
          const fy = (dy / distance) * pushForce;
          const fz = (dz / distance) * pushForce;

          const f1 = forces.get(n1.id) || { x: 0, y: 0, z: 0 };
          const f2 = forces.get(n2.id) || { x: 0, y: 0, z: 0 };

          f1.x -= fx;
          f1.y -= fy;
          f1.z -= fz;
          f2.x += fx;
          f2.y += fy;
          f2.z += fz;

          forces.set(n1.id, f1);
          forces.set(n2.id, f2);
        } else {
          // Standard repulsive force for nodes at normal distance
          const force = (this.k * this.k) / (distance * this.repulsiveForce);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          const fz = (dz / distance) * force;

          const f1 = forces.get(n1.id) || { x: 0, y: 0, z: 0 };
          const f2 = forces.get(n2.id) || { x: 0, y: 0, z: 0 };

          f1.x -= fx;
          f1.y -= fy;
          f1.z -= fz;
          f2.x += fx;
          f2.y += fy;
          f2.z += fz;

          forces.set(n1.id, f1);
          forces.set(n2.id, f2);
        }
      }
    }
  }

  private applyAttractiveForces(forces: Map<string, { x: number; y: number; z: number }>): void {
    // Calculate attractive forces for edges
    for (const edge of this.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);

      if (source && target) {
        const dx = target.position.x - source.position.x;
        const dy = target.position.y - source.position.y;
        const dz = target.position.z - source.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;

        // Attractive force proportional to distance
        const force = (distance * distance) / this.k * this.attractiveForce;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const fz = (dz / distance) * force;

        const fs = forces.get(source.id) || { x: 0, y: 0, z: 0 };
        const ft = forces.get(target.id) || { x: 0, y: 0, z: 0 };

        fs.x += fx;
        fs.y += fy;
        fs.z += fz;
        ft.x -= fx;
        ft.y -= fy;
        ft.z -= fz;

        forces.set(source.id, fs);
        forces.set(target.id, ft);
      }
    }
  }

  private applyForces(forces: Map<string, { x: number; y: number; z: number }>): void {
    for (const [id, force] of forces) {
      const node = this.nodes.get(id);
      if (node) {
        this.updateNodeVelocity(node, force);
        this.updateNodePosition(node);
      }
    }
  }

  private updateNodeVelocity(node: Node, force: { x: number; y: number; z: number }): void {
    node.velocity.x = (node.velocity.x + force.x) * this.damping;
    node.velocity.y = (node.velocity.y + force.y) * this.damping;
    node.velocity.z = (node.velocity.z + force.z) * this.damping;
  }

  private updateNodePosition(node: Node): void {
    node.position.x += node.velocity.x * 0.01;
    node.position.y += node.velocity.y * 0.01;
    node.position.z += node.velocity.z * 0.01;
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }

  public getEdges(): Edge[] {
    return this.edges;
  }
}
