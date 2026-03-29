import * as BABYLON from '@babylonjs/core';
import { ForceDirectedLayout } from './ForceDirectedLayout';
import type { GraphData, GraphEdge, GraphNode } from './types';
import { toProjectRelativePath } from './PathUtils';

/**
 * LayoutPipelineService manages the physics simulation and collision resolution
 * for the hierarchical code graph layout system:
 * - Level 1: File-level layout (files as nodes, cross-file edges)
 * - Level 2: File-internal layouts (functions within same file)
 */
export class LayoutPipelineService {
  private scene: BABYLON.Scene;
  private fileLayout: ForceDirectedLayout | null = null;
  private fileInternalLayouts: Map<string, ForceDirectedLayout> = new Map();
  private fileBoxMeshes: Map<string, BABYLON.Mesh> = new Map();
  // Directory boxes for hierarchical visualization
  private nodeMeshMap: Map<string, BABYLON.Mesh> = new Map();
  private graphNodeMap: Map<string, GraphNode> = new Map();

  private physicsActive = false;
  private physicsIterationCount = 0;
  private physicsLoopInitialized = false;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  public setFileLayout(layout: ForceDirectedLayout): void {
    this.fileLayout = layout;
  }

  public getFileLayout(): ForceDirectedLayout | null {
    return this.fileLayout;
  }

  public setFileInternalLayouts(layouts: Map<string, ForceDirectedLayout>): void {
    this.fileInternalLayouts = layouts;
  }

  public getFileInternalLayouts(): Map<string, ForceDirectedLayout> {
    return this.fileInternalLayouts;
  }

  public setFileBoxMeshes(meshes: Map<string, BABYLON.Mesh>): void {
    this.fileBoxMeshes = meshes;
  }

  public getFileBoxMeshes(): Map<string, BABYLON.Mesh> {
    return this.fileBoxMeshes;
  }

  // Directory box mesh management handled separately

  public setNodeMeshMap(meshes: Map<string, BABYLON.Mesh>): void {
    this.nodeMeshMap = meshes;
  }

  public getNodeMeshMap(): Map<string, BABYLON.Mesh> {
    return this.nodeMeshMap;
  }

  public setGraphNodeMap(nodes: Map<string, GraphNode>): void {
    this.graphNodeMap = nodes;
  }

  public activatePhysics(): void {
    this.physicsActive = true;
    this.physicsIterationCount = 0;
  }

  public deactivatePhysics(): void {
    this.physicsActive = false;
  }

  /**
   * Build and settle per-file internal layouts.
   */
  public createAndSettleInternalLayouts(
    graph: GraphData,
    fileNodeIds: Map<string, Set<string>>,
    fileMap: Map<string, string>,
  ): Map<string, ForceDirectedLayout> {
    const allEdges = this.buildEdgeList(graph.edges);
    const nodeExportedMap = new Map<string, boolean>();
    const nodeSizeMap = new Map<string, number>();

    for (const node of graph.nodes) {
      nodeExportedMap.set(node.id, !!node.isExported);

      let size = 1.0;
      if (node.type === 'function' || node.type === 'class' || node.type === 'interface' || node.type === 'type-alias' || node.type === 'enum' || node.type === 'namespace') {
        size = node.isExported ? 1.8 : 1.3;
      }
      nodeSizeMap.set(node.id, size);
    }

    const nextLayouts = new Map<string, ForceDirectedLayout>();
    for (const [file, nodeIds] of fileNodeIds.entries()) {
      const nodeArray = Array.from(nodeIds);
      const sameFileEdges = allEdges.filter(e =>
        nodeIds.has(e.source) && nodeIds.has(e.target)
      );

      const internalLayout = new ForceDirectedLayout(
        nodeArray,
        sameFileEdges,
        fileMap,
        nodeExportedMap,
        undefined,
        nodeSizeMap,
      );
      nextLayouts.set(file, internalLayout);
    }

    for (const internalLayout of nextLayouts.values()) {
      internalLayout.simulate(500);
    }

    this.fileInternalLayouts = nextLayouts;
    return nextLayouts;
  }

  /**
   * Build and settle top-level file layout.
   */
  public createAndSettleFileLevelLayout(
    graph: GraphData,
    fileNodeIds: Map<string, Set<string>>,
    fileMap: Map<string, string>,
  ): { files: string[]; crossFileEdges: Array<{ source: string; target: string }>; layout: ForceDirectedLayout } {
    const files = Array.from(fileNodeIds.keys());
    const crossFileEdges = this.buildCrossFileEdges(graph.edges, fileMap);

    const layout = new ForceDirectedLayout(files, crossFileEdges);
    layout.simulate(600);

    this.fileLayout = layout;
    return { files, crossFileEdges, layout };
  }

  /**
   * Apply current file layout node positions to file box meshes.
   */
  public applyFileLayoutPositions(layout: ForceDirectedLayout | null): void {
    if (!layout) {
      return;
    }

    const filePositions = layout.getNodes();
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = filePositions.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  /**
   * Set up per-frame physics updates for two-level hierarchical layout
   */
  public setupPhysicsLoop(): void {
    if (this.physicsLoopInitialized) {
      return;
    }
    this.physicsLoopInitialized = true;

    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.physicsActive && this.fileLayout && this.fileInternalLayouts.size > 0) {
          // Step 1: Update file-level layout
          this.fileLayout.updateFrame();
          const filePositions = this.fileLayout.getNodes();

          // Step 2: Update file box positions from layout
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) continue;
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
          }

          // Step 3: Apply collision resolution
          this.applyFileBoxRepulsion(this.fileLayout);
          this.resolveInitialFileBoxOverlaps(4);
          this.enforceMinimumFileBoxGap(28.0, 4);
          this.enforceTopLevelDirectoryGap(36.0, 1);

          // Step 4: Re-apply positions after collision
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) continue;
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
          }

          // Step 5: Check convergence
          this.physicsIterationCount++;
          const maxIterations = 500;
          if (this.physicsIterationCount > maxIterations) {
            this.physicsActive = false;
            console.log(`✓ Physics converged after ${this.physicsIterationCount} iterations`);
          }
        }
      });
    }
  }

  /**
   * Apply repulsive forces between file boxes to prevent overlaps
   */
  public applyFileBoxRepulsion(layout: ForceDirectedLayout): void {
    const nodes = layout.getNodes();
    const nodeEntries = Array.from(nodes.entries());

    for (let i = 0; i < nodeEntries.length; i++) {
      for (let j = i + 1; j < nodeEntries.length; j++) {
        const [fileA, nodeA] = nodeEntries[i];
        const [fileB, nodeB] = nodeEntries[j];

        const boxA = this.fileBoxMeshes.get(fileA);
        const boxB = this.fileBoxMeshes.get(fileB);
        if (!boxA || !boxB) continue;

        const aHalf = boxA.scaling.scale(0.5);
        const bHalf = boxB.scaling.scale(0.5);

        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const dz = nodeB.position.z - nodeA.position.z;

        const minDistX = aHalf.x + bHalf.x;
        const minDistY = aHalf.y + bHalf.y;
        const minDistZ = aHalf.z + bHalf.z;

        if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY && Math.abs(dz) < minDistZ) {
          const force = 0.0015;
          const mag = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
          const fx = (dx / mag) * force;
          const fy = (dy / mag) * force;
          const fz = (dz / mag) * force;

          nodeA.velocity.x -= fx;
          nodeA.velocity.y -= fy;
          nodeA.velocity.z -= fz;
          nodeB.velocity.x += fx;
          nodeB.velocity.y += fy;
          nodeB.velocity.z += fz;
        }
      }
    }
  }

  /**
   * Resolve file box overlaps deterministically
   */
  public resolveInitialFileBoxOverlaps(maxPasses: number = 4): void {
    const boxes = Array.from(this.fileBoxMeshes.values());

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const boxA = boxes[i];
          const boxB = boxes[j];

          const aMin = boxA.position.subtract(boxA.scaling.scale(0.5));
          const aMax = boxA.position.add(boxA.scaling.scale(0.5));
          const bMin = boxB.position.subtract(boxB.scaling.scale(0.5));
          const bMax = boxB.position.add(boxB.scaling.scale(0.5));

          const overlapX = Math.min(aMax.x, bMax.x) - Math.max(aMin.x, bMin.x);
          const overlapY = Math.min(aMax.y, bMax.y) - Math.max(aMin.y, bMin.y);
          const overlapZ = Math.min(aMax.z, bMax.z) - Math.max(aMin.z, bMin.z);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            let axis: 'x' | 'y' | 'z' = 'x';
            if (overlapY < overlapX && overlapY < overlapZ) axis = 'y';
            if (overlapZ < overlapX && overlapZ < overlapY) axis = 'z';

            const correction = (overlapX > 0 && overlapY > 0 && overlapZ > 0)
              ? Math.min(overlapX, overlapY, overlapZ) * 0.5 + 0.5
              : 0;

            if (axis === 'x') {
              const sign = boxA.position.x < boxB.position.x ? -1 : 1;
              boxA.position.x += sign * correction;
              boxB.position.x -= sign * correction;
            } else if (axis === 'y') {
              const sign = boxA.position.y < boxB.position.y ? -1 : 1;
              boxA.position.y += sign * correction;
              boxB.position.y -= sign * correction;
            } else {
              const sign = boxA.position.z < boxB.position.z ? -1 : 1;
              boxA.position.z += sign * correction;
              boxB.position.z -= sign * correction;
            }
            movedAny = true;
          }
        }
      }

      if (!movedAny) break;
    }
  }

  /**
   * Enforce minimum surface gap between adjacent file boxes
   */
  public enforceMinimumFileBoxGap(minGap: number, maxPasses: number = 4): void {
    const boxes = Array.from(this.fileBoxMeshes.values());

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const boxA = boxes[i];
          const boxB = boxes[j];

          const dx = boxB.position.x - boxA.position.x;
          const dy = boxB.position.y - boxA.position.y;
          const dz = boxB.position.z - boxA.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (distance < 0.001) continue;

          const aHalf = boxA.scaling.scale(0.5);
          const bHalf = boxB.scaling.scale(0.5);
          const minDist = (aHalf.x + bHalf.x + aHalf.y + bHalf.y + aHalf.z + bHalf.z) / 3;
          const requiredDist = minDist + minGap;

          if (distance < requiredDist) {
            const ratio = requiredDist / distance;
            const moveX = (dx * ratio - dx) * 0.5;
            const moveY = (dy * ratio - dy) * 0.5;
            const moveZ = (dz * ratio - dz) * 0.5;

            boxA.position.x -= moveX;
            boxA.position.y -= moveY;
            boxA.position.z -= moveZ;
            boxB.position.x += moveX;
            boxB.position.y += moveY;
            boxB.position.z += moveZ;
            movedAny = true;
          }
        }
      }

      if (!movedAny) break;
    }
  }

  /**
   * Enforce spacing between top-level directory file groups
   */
  public enforceTopLevelDirectoryGap(minGap: number, maxPasses: number = 3): void {
    if (!this.fileLayout) return;

    const fileNodes = this.fileLayout.getNodes();
    const files = Array.from(this.fileBoxMeshes.keys()).filter(f => f !== 'external');

    const getTopLevelGroup = (filePath: string): string => {
      const rel = toProjectRelativePath(filePath);
      const parts = rel.split('/').filter(Boolean);
      return parts.length <= 1 ? '__root__' : parts[0];
    };

    const groups = new Map<string, string[]>();
    for (const file of files) {
      const group = getTopLevelGroup(file);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(file);
    }

    const groupKeys = Array.from(groups.keys());
    if (groupKeys.length < 2) return;

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < groupKeys.length; i++) {
        for (let j = i + 1; j < groupKeys.length; j++) {
          const groupA = groupKeys[i];
          const groupB = groupKeys[j];
          
          // Calculate bounds for each group (simplified)
          let minXa = Infinity, maxXa = -Infinity;
          let minXb = Infinity, maxXb = -Infinity;

          const groupAFiles = groups.get(groupA) || [];
          const groupBFiles = groups.get(groupB) || [];

          for (const file of groupAFiles) {
            const box = this.fileBoxMeshes.get(file);
            if (!box) continue;
            minXa = Math.min(minXa, box.position.x);
            maxXa = Math.max(maxXa, box.position.x);
          }

          for (const file of groupBFiles) {
            const box = this.fileBoxMeshes.get(file);
            if (!box) continue;
            minXb = Math.min(minXb, box.position.x);
            maxXb = Math.max(maxXb, box.position.x);
          }

          if (!Number.isFinite(minXa) || !Number.isFinite(minXb)) continue;

          const gapA = maxXa - minXa;
          const gapB = maxXb - minXb;
          const centerA = (minXa + maxXa) * 0.5;
          const centerB = (minXb + maxXb) * 0.5;
          const distance = Math.abs(centerB - centerA);
          const requiredDistance = (gapA + gapB) * 0.5 + minGap;

          if (distance < requiredDistance) {
            const correction = (requiredDistance - distance) * 0.5 + 0.1;
            const sign = centerB > centerA ? 1 : -1;

            for (const file of groupAFiles) {
              const node = fileNodes.get(file);
              if (node) node.position.x -= sign * correction;
            }
            for (const file of groupBFiles) {
              const node = fileNodes.get(file);
              if (node) node.position.x += sign * correction;
            }
            movedAny = true;
          }
        }
      }

      if (!movedAny) break;
    }
  }

  /**
   * Compact file box layout to minimize bounding volume
   */
  public compactFileBoxLayout(targetCentroidGap: number, _minGap: number): void {
    if (!this.fileLayout) return;

    const nodes = this.fileLayout.getNodes();
    const nodeArray = Array.from(nodes.entries());

    // Calculate centroid of all boxes
    let cx = 0, cy = 0, cz = 0;
    for (const [, node] of nodeArray) {
      cx += node.position.x;
      cy += node.position.y;
      cz += node.position.z;
    }
    cx /= Math.max(1, nodeArray.length);
    cy /= Math.max(1, nodeArray.length);
    cz /= Math.max(1, nodeArray.length);

    // Gently nudge everything toward centroid
    for (const [, node] of nodeArray) {
      const dx = cx - node.position.x;
      const dy = cy - node.position.y;
      const dz = cz - node.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 0.001) {
        const factor = Math.min(0.02, targetCentroidGap / Math.max(1, dist));
        node.position.x += dx * factor;
        node.position.y += dy * factor;
        node.position.z += dz * factor;
      }
    }

    // Update file box positions
    for (const [file, fileBox] of this.fileBoxMeshes) {
      const node = nodes.get(file);
      if (node && node.position) {
        fileBox.position.x = node.position.x;
        fileBox.position.y = node.position.y;
        fileBox.position.z = node.position.z;
      }
    }
  }

  /**
   * Clamp nodes inside their parent file boxes
   */
  public clampNodesInsideFileBoxes(): void {
    for (const [nodeId, mesh] of this.nodeMeshMap) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || !node.file) continue;

      const fileBox = this.fileBoxMeshes.get(node.file);
      if (!fileBox) continue;

      const padding = 2.0;
      const boxHalf = fileBox.scaling.scale(0.5);
      const maxX = boxHalf.x - padding;
      const maxY = boxHalf.y - padding;
      const maxZ = boxHalf.z - padding;

      mesh.position.x = Math.max(-maxX, Math.min(maxX, mesh.position.x));
      mesh.position.y = Math.max(-maxY, Math.min(maxY, mesh.position.y));
      mesh.position.z = Math.max(-maxZ, Math.min(maxZ, mesh.position.z));
    }
  }

  /**
   * Enforce minimum clearance between nodes within the same file
   */
  public enforceInFileNodeClearance(): void {
    const meshArray = Array.from(this.nodeMeshMap.values());
    const minDistance = 3.0;

    for (let i = 0; i < meshArray.length; i++) {
      for (let j = i + 1; j < meshArray.length; j++) {
        const meshA = meshArray[i];
        const meshB = meshArray[j];

        const dx = meshB.position.x - meshA.position.x;
        const dy = meshB.position.y - meshA.position.y;
        const dz = meshB.position.z - meshA.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < minDistance && distance > 0.001) {
          const ratio = minDistance / distance;
          const moveX = (dx * ratio - dx) * 0.5;
          const moveY = (dy * ratio - dy) * 0.5;
          const moveZ = (dz * ratio - dz) * 0.5;

          meshA.position.x -= moveX;
          meshA.position.y -= moveY;
          meshA.position.z -= moveZ;
          meshB.position.x += moveX;
          meshB.position.y += moveY;
          meshB.position.z += moveZ;
        }
      }
    }
  }

  /**
   * Resolve collisions between nodes and edges
   */
  public resolveNodeEdgeObstructions(_maxPasses: number = 20): void {
    // Placeholder for edge obstruction resolution
    // This would involve checking node positions against edge paths
  }

  /**
   * Resolve edge obstructions with file boxes
   */
  public resolveEdgeObstructions(_maxPasses: number = 30): void {
    // Placeholder for edge obstruction resolution
  }

  /**
   * Resolve function label obstructions
   */
  public resolveFunctionLabelObstructions(_maxPasses: number = 12): void {
    // Placeholder for label obstruction resolution
  }

  private buildEdgeList(edges: GraphEdge[]): Array<{ source: string; target: string }> {
    return edges.map(edge => ({
      source: edge.from,
      target: edge.to,
    }));
  }

  private buildCrossFileEdges(
    edges: GraphEdge[],
    fileMap: Map<string, string>,
  ): Array<{ source: string; target: string }> {
    const crossFileEdges: Array<{ source: string; target: string }> = [];
    const seen = new Set<string>();

    for (const edge of edges) {
      const sourceFile = fileMap.get(edge.from);
      const targetFile = fileMap.get(edge.to);
      if (!sourceFile || !targetFile || sourceFile === targetFile) {
        continue;
      }

      const key = `${sourceFile}->${targetFile}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      crossFileEdges.push({ source: sourceFile, target: targetFile });
    }

    return crossFileEdges;
  }
}
