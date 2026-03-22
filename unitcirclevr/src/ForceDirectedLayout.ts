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
  isExported?: boolean;  // Whether this is an exported function/variable
}

export interface Edge {
  source: string;
  target: string;
}

export class ForceDirectedLayout {
  private nodes: Map<string, Node>;
  private edges: Edge[];
  private edgeFilter?: (edge: Edge) => boolean;  // Optional filter for which edges to use
  private readonly SPACE_SIZE = 250;
  private readonly C_REPULSIVE = 2.0;      // Repulsive force for same-file nodes
  private readonly C_REPULSIVE_CROSS_FILE = 20.0;  // Much stronger repulsion for cross-file nodes (10x stronger)
  private readonly C_ATTRACTIVE = 0.05;    // Attractive force strength for cross-file edges
  private readonly C_ATTRACTIVE_SAME_FILE = 0.30;  // 6x stronger attraction for same-file connected nodes
  private readonly DAMPING = 0.88;         // Velocity damping per iteration (increased for slower motion)
  private readonly MIN_DISTANCE = 1.0;     // Minimum distance to prevent singularity in force calculations
  private readonly MIN_NODE_SEPARATION = 25.0;    // Minimum distance between unconnected same-file nodes
  private readonly MIN_CROSS_FILE_SEPARATION = 35.0;  // Stronger separation for cross-file nodes
  private readonly EQUILIBRIUM_THRESHOLD = 0.001;  // Converged when all velocities below this

  constructor(nodeIds: string[], edges: Edge[], nodeFileMap?: Map<string, string>, nodeExportedMap?: Map<string, boolean>, edgeFilter?: (edge: Edge) => boolean) {
    this.edges = edges;
    this.edgeFilter = edgeFilter;
    this.nodes = new Map();

    // Initialize nodes with random positions close to center
    // Nodes will spread apart due to sphere repulsion forces
    for (const id of nodeIds) {
      // Generate random position near center at radius ~5-15 units
      const radius = 5 + Math.random() * 10;  // 5-15 units from center
      const theta = Math.random() * Math.PI * 2;  // azimuth angle: 0-2π
      const phi = Math.acos(Math.random() * 2 - 1);  // polar angle: uniform distribution on sphere

      this.nodes.set(id, {
        id,
        label: id.split('@')[0],
        file: nodeFileMap?.get(id),
        isExported: nodeExportedMap?.get(id),
        position: {
          x: radius * Math.sin(phi) * Math.cos(theta),
          y: radius * Math.sin(phi) * Math.sin(theta),
          z: radius * Math.cos(phi)
        },
        velocity: { x: 0, y: 0, z: 0 }
      });
    }
  }

  /**
   * Run force-directed layout simulation
   * All node-node and edge forces are disabled - only sphere repulsion forces apply
   */
  public simulate(iterations: number = 300): Map<string, Node> {
    const nodeArray = Array.from(this.nodes.values());

    // Run simulation iterations - all forces disabled (handled by file sphere physics)
    for (let iter = 0; iter < iterations; iter++) {
      let maxVelocity = 0;

      // Reset forces
      for (const node of nodeArray) {
        node.velocity = { x: 0, y: 0, z: 0 };
      }

      // No node-node repulsion forces
      // No edge attractive forces
      // No edge repulsion forces
      // All layout forces disabled - only sphere repulsion applies via VRSceneManager

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

  // Force methods disabled - all physics handled by file spheres in VRSceneManager

  private applyRepulsiveForce(nodeA: Node, nodeB: Node): void {
    const dx = nodeB.position.x - nodeA.position.x;
    const dy = nodeB.position.y - nodeA.position.y;
    const dz = nodeB.position.z - nodeA.position.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;
    
    // All repulsive forces use same-file strength (cross-file nodes don't repel)
    const repulsiveConstant = this.C_REPULSIVE;
    
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
   * No minimum distance constraints - edges can be any length
   */
  private applyAttractiveForce(nodeA: Node, nodeB: Node): void {
    const dx = nodeB.position.x - nodeA.position.x;
    const dy = nodeB.position.y - nodeA.position.y;
    const dz = nodeB.position.z - nodeA.position.z;

    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;

    // Check if same file connection
    const isSameFile = nodeA.file && nodeB.file && nodeA.file === nodeB.file;

    // Use strongest attraction for same-file connected nodes (6x stronger)
    const attractionConstant = isSameFile ? this.C_ATTRACTIVE_SAME_FILE : this.C_ATTRACTIVE;

    // Spring-like force: F = k * distance
    const force = attractionConstant * distance;

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

    // Apply attractive forces along edges (filtered if edge filter is specified)
    const edgesToProcess = this.edgeFilter ? this.edges.filter(this.edgeFilter) : this.edges;
    for (const edge of edgesToProcess) {
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

    // Enforce minimum distance constraint for all node pairs (prevent overlap)
    this.enforceAllPairsMinimumDistance();
    
    // Enforce stronger minimum distance constraint between nodes from different files
    this.enforceFileCrossConstraint();

    // Return true if still converging, false if settled
    return maxVelocity >= this.EQUILIBRIUM_THRESHOLD;
  }

  /**
   * Enforce minimum distance constraint between same-file node pairs
   * Push unconnected nodes from same file apart if they get closer than MIN_NODE_SEPARATION (25 units)
   * Cross-file pairs are handled separately by enforceFileCrossConstraint with stronger constraints
   */
  private enforceAllPairsMinimumDistance(): void {
    const nodeArray = Array.from(this.nodes.values());
    const nodeCount = nodeArray.length;
    const pushForce = this.C_REPULSIVE * 4;  // Strong push to prevent overlap

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const nodeA = nodeArray[i];
        const nodeB = nodeArray[j];

        // Skip cross-file pairs - they're handled by enforceFileCrossConstraint
        if (nodeA.file && nodeB.file && nodeA.file !== nodeB.file) {
          continue;
        }

        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const dz = nodeB.position.z - nodeA.position.z;

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;

        // If same-file unconnected nodes are closer than minimum separation, push them apart
        if (distance < this.MIN_NODE_SEPARATION) {
          const direction = distance > 0 
            ? { x: dx / distance, y: dy / distance, z: dz / distance }
            : { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };

          // Calculate how much to push
          const pushAmount = (this.MIN_NODE_SEPARATION - distance) * pushForce;

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
  }

  /**
   * Enforce stronger minimum distance constraint between nodes from different source files
   * Push cross-file nodes apart to create file-based clustering
   * Uses MIN_CROSS_FILE_SEPARATION (35 units) - stronger than same-file pairs (25 units)
   */
  private enforceFileCrossConstraint(): void {
    const nodeArray = Array.from(this.nodes.values());
    const nodeCount = nodeArray.length;
    const pushForce = this.C_REPULSIVE_CROSS_FILE * 3;  // Strong push for file boundaries

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const nodeA = nodeArray[i];
        const nodeB = nodeArray[j];

        // Only enforce constraint for nodes from different files
        if (!nodeA.file || !nodeB.file || nodeA.file === nodeB.file) {
          continue;  // Skip if same file or no file info
        }

        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const dz = nodeB.position.z - nodeA.position.z;

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || this.MIN_DISTANCE;

        // If cross-file nodes are closer than minimum distance, push them apart strongly
        if (distance < this.MIN_CROSS_FILE_SEPARATION) {
          const direction = distance > 0 
            ? { x: dx / distance, y: dy / distance, z: dz / distance }
            : { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };

          // Calculate how much to push (stronger for cross-file)
          const pushAmount = (this.MIN_CROSS_FILE_SEPARATION - distance) * pushForce;

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
  }

  public getNodes(): Map<string, Node> {
    return this.nodes;
  }
}
