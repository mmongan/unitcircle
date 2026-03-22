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
  file?: string;  // Source file for this node
}

export interface Edge {
  source: string;
  target: string;
}

export class ForceDirectedLayout {
  private nodes: Map<string, Node>;
  private edges: Edge[];
  private readonly SPACE_SIZE = 250;
  private readonly C_REPULSIVE = 2.0;      // Repulsive force for same-file nodes
  private readonly C_REPULSIVE_CROSS_FILE = 4.0;  // Stronger repulsion for cross-file nodes
  private readonly C_ATTRACTIVE = 0.05;    // Attractive force strength (edge pull)
  private readonly DAMPING = 0.92;         // Velocity damping per iteration
  private readonly MIN_DISTANCE = 1.0;     // Minimum distance to prevent singularity in force calculations
  private readonly MIN_EQUILIBRIUM_DISTANCE = 6.0;  // Minimum distance nodes must maintain (configurable)
  private readonly EQUILIBRIUM_THRESHOLD = 0.001;  // Converged when all velocities below this

  constructor(nodeIds: string[], edges: Edge[], nodeFileMap?: Map<string, string>) {
    this.edges = edges;
    this.nodes = new Map();

    // Initialize nodes with random positions (will be spread by forces)
    for (const id of nodeIds) {
      this.nodes.set(id, {
        id,
        label: id.split('@')[0],
        file: nodeFileMap?.get(id),
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
   * Uses stronger force (4.0) for nodes from different source files
   */
  private applyRepulsiveForce(nodeA: Node, nodeB: Node): void {
    const dx = nodeB.position.x - nodeA.position.x;
    const dy = nodeB.position.y - nodeA.position.y;
    const dz = nodeB.position.z - nodeA.position.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;
    
    // Use stronger repulsion for cross-file nodes (different source files)
    const isDifferentFile = nodeA.file && nodeB.file && nodeA.file !== nodeB.file;
    const repulsiveConstant = isDifferentFile ? this.C_REPULSIVE_CROSS_FILE : this.C_REPULSIVE;
    
    const force = (repulsiveConstant / (distance * distance)) || 0;

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

    // Enforce minimum distance constraint only for connected nodes
    this.enforceEdgeMinimumDistance();

    // Return true if still converging, false if settled
    return maxVelocity >= this.EQUILIBRIUM_THRESHOLD;
  }

  /**
   * Enforce minimum distance constraint between nodes connected by edges
   * Push connected nodes apart if they get closer than MIN_EQUILIBRIUM_DISTANCE
   * Does NOT constrain unconnected nodes - they can get arbitrarily close
   */
  private enforceEdgeMinimumDistance(): void {
    const pushForce = this.C_REPULSIVE * 5;  // Strong push force to maintain edge distance

    // Only enforce distance for nodes that are connected by edges
    for (const edge of this.edges) {
      const nodeA = this.nodes.get(edge.source);
      const nodeB = this.nodes.get(edge.target);

      if (!nodeA || !nodeB) continue;

      const dx = nodeB.position.x - nodeA.position.x;
      const dy = nodeB.position.y - nodeA.position.y;
      const dz = nodeB.position.z - nodeA.position.z;

      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;

      // If connected nodes are closer than minimum distance, push them apart
      if (distance < this.MIN_EQUILIBRIUM_DISTANCE) {
        const direction = distance > 0 
          ? { x: dx / distance, y: dy / distance, z: dz / distance }
          : { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };

        // Calculate how much to push
        const pushAmount = (this.MIN_EQUILIBRIUM_DISTANCE - distance) * pushForce;

        // Push nodes apart
        nodeA.position.x -= direction.x * pushAmount;
        nodeA.position.y -= direction.y * pushAmount;
        nodeA.position.z -= direction.z * pushAmount;

        nodeB.position.x += direction.x * pushAmount;
        nodeB.position.y += direction.y * pushAmount;
        nodeB.position.z += direction.z * pushAmount;

        // Re-constrain to bounds after pushing
        nodeA.position.x = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeA.position.x));
        nodeA.position.y = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeA.position.y));
        nodeA.position.z = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeA.position.z));

        nodeB.position.x = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeB.position.x));
        nodeB.position.y = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeB.position.y));
        nodeB.position.z = Math.max(-this.SPACE_SIZE, Math.min(this.SPACE_SIZE, nodeB.position.z));
      }
    }
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }
}
