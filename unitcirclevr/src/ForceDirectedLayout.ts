/**
 * Force-Directed 3D Layout System
 * 
 * Uses physics-based simulation to spread nodes naturally:
 * - Repulsive forces between all nodes (prevent clustering)
 * - Attractive forces along edges (maintain structure)
 * - Velocity damping (stabilize layout)
 * - Iterative refinement until convergence
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
  private readonly SPACE_SIZE = 250;
  private readonly C_REPULSIVE = 2.0;      // Repulsive force strength (increased for more realistic physics)
  private readonly C_ATTRACTIVE = 0.05;    // Attractive force strength (edge pull)
  private readonly DAMPING = 0.92;         // Velocity damping per iteration
  private readonly MIN_DISTANCE = 1.0;     // Minimum distance to prevent singularity
  private readonly EQUILIBRIUM_THRESHOLD = 0.001;  // Converged when all velocities below this

  constructor(nodeIds: string[], edges: Edge[]) {
    this.edges = edges;
    this.nodes = new Map();

    // Initialize nodes with random positions (will be spread by forces)
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
   * Run force-directed layout simulation
   * Applies physics forces and updates node positions iteratively
   */
  public simulate(iterations: number = 300): Map<string, Node> {
    const nodeArray = Array.from(this.nodes.values());
    const nodeCount = nodeArray.length;

    // Run simulation iterations
    for (let iter = 0; iter < iterations; iter++) {
      let maxVelocity = 0;

      // Reset forces
      for (const node of nodeArray) {
        node.velocity = { x: 0, y: 0, z: 0 };
      }

      // Apply repulsive forces between all node pairs
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < nodeCount; j++) {
          this.applyRepulsiveForce(nodeArray[i], nodeArray[j]);
        }
      }

      // Apply attractive forces along edges
      for (const edge of this.edges) {
        const sourceNode = this.nodes.get(edge.source);
        const targetNode = this.nodes.get(edge.target);
        if (sourceNode && targetNode) {
          this.applyAttractiveForce(sourceNode, targetNode);
        }
      }

      // Update positions and apply damping
      for (const node of nodeArray) {
        // Apply damping to velocity
        node.velocity.x *= this.DAMPING;
        node.velocity.y *= this.DAMPING;
        node.velocity.z *= this.DAMPING;

        // Update position based on velocity
        node.position.x += node.velocity.x;
        node.position.y += node.velocity.y;
        node.position.z += node.velocity.z;

        // Constrain to bounds
        node.position.x = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.x));
        node.position.y = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.y));
        node.position.z = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.z));

        // Track max velocity for convergence check
        const speed = Math.sqrt(node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2);
        maxVelocity = Math.max(maxVelocity, speed);
      }

      // Early exit if layout converged
      if (maxVelocity < this.EQUILIBRIUM_THRESHOLD) {
        break;
      }
    }

    return this.nodes;
  }

  /**
   * Apply repulsive force between two nodes (push apart)
   */
  private applyRepulsiveForce(nodeA: Node, nodeB: Node): void {
    const dx = nodeB.position.x - nodeA.position.x;
    const dy = nodeB.position.y - nodeA.position.y;
    const dz = nodeB.position.z - nodeA.position.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;
    const force = (this.C_REPULSIVE / (distance * distance)) || 0;

    const fx = (force * dx) / distance;
    const fy = (force * dy) / distance;
    const fz = (force * dz) / distance;

    // Apply force: push away from each other
    nodeA.velocity.x -= fx;
    nodeA.velocity.y -= fy;
    nodeA.velocity.z -= fz;

    nodeB.velocity.x += fx;
    nodeB.velocity.y += fy;
    nodeB.velocity.z += fz;
  }

  /**
   * Apply attractive force along edges (pull together)
   */
  private applyAttractiveForce(nodeA: Node, nodeB: Node): void {
    const dx = nodeB.position.x - nodeA.position.x;
    const dy = nodeB.position.y - nodeA.position.y;
    const dz = nodeB.position.z - nodeA.position.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;

    // Spring-like force: F = k * distance
    const force = this.C_ATTRACTIVE * distance;

    const fx = (force * dx) / distance;
    const fy = (force * dy) / distance;
    const fz = (force * dz) / distance;

    // Apply force: pull toward each other
    nodeA.velocity.x += fx;
    nodeA.velocity.y += fy;
    nodeA.velocity.z += fz;

    nodeB.velocity.x -= fx;
    nodeB.velocity.y -= fy;
    nodeB.velocity.z -= fz;
  }

  /**
   * Apply one iteration of forces and update positions (call once per frame)
   * Returns true if layout is still converging, false if at equilibrium
   */
  public updateFrame(): boolean {
    const nodeArray = Array.from(this.nodes.values());
    const nodeCount = nodeArray.length;
    let maxVelocity = 0;

    // Reset forces for this frame
    for (const node of nodeArray) {
      node.velocity = { x: 0, y: 0, z: 0 };
    }

    // Apply repulsive forces between all node pairs
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        this.applyRepulsiveForce(nodeArray[i], nodeArray[j]);
      }
    }

    // Apply attractive forces along edges
    for (const edge of this.edges) {
      const sourceNode = this.nodes.get(edge.source);
      const targetNode = this.nodes.get(edge.target);
      if (sourceNode && targetNode) {
        this.applyAttractiveForce(sourceNode, targetNode);
      }
    }

    // Update positions and apply damping
    for (const node of nodeArray) {
      // Apply damping to velocity
      node.velocity.x *= this.DAMPING;
      node.velocity.y *= this.DAMPING;
      node.velocity.z *= this.DAMPING;

      // Update position based on velocity
      node.position.x += node.velocity.x;
      node.position.y += node.velocity.y;
      node.position.z += node.velocity.z;

      // Constrain to bounds
      node.position.x = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.x));
      node.position.y = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.y));
      node.position.z = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, node.position.z));

      // Track max velocity for convergence check
      const speed = Math.sqrt(node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2);
      maxVelocity = Math.max(maxVelocity, speed);
    }

    // Return true if still converging, false if settled
    return maxVelocity >= this.EQUILIBRIUM_THRESHOLD;
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }
}
