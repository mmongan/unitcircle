import * as BABYLON from '@babylonjs/core';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import { ForceDirectedLayout } from './ForceDirectedLayout';
import type { GraphData, GraphEdge, GraphNode } from './types';
import { MeshFactory } from './MeshFactory';
import { GraphLoader } from './GraphLoader';
import { SceneConfig } from './SceneConfig';
import { Quest3GripController, type GripState, type GripGesture } from './Quest3GripController';
import { FileColorService } from './FileColorService';
import { collectCodeViewerConnections, drawCodeViewerConnectionButtons } from './CodeViewerPanel';
import { getDirectoryPath, getParentDirectoryPath, normalizePath, toProjectRelativePath } from './PathUtils';

// VS Code Dark+ inspired token colours for Canvas 2D syntax rendering
const PRISM_TOKEN_COLORS: Readonly<Record<string, string>> = {
  keyword: '#569cd6',
  'class-name': '#4ec9b0',
  function: '#dcdcaa',
  number: '#b5cea8',
  string: '#ce9178',
  'template-string': '#ce9178',
  boolean: '#569cd6',
  nil: '#569cd6',
  operator: '#d4d4d4',
  punctuation: '#d4d4d4',
  comment: '#6a9955',
  regex: '#d16969',
  parameter: '#9cdcfe',
  property: '#9cdcfe',
  constant: '#4fc1ff',
  builtin: '#4ec9b0',
  annotation: '#9cdcfe',
  type: '#4ec9b0',
};
const PRISM_DEFAULT_COLOR = '#dce9ff';
const EDITOR_TEXTURE_WIDTH = 1536;
const EDITOR_TEXTURE_HEIGHT = 768;
const EDITOR_WORLD_WIDTH_SCALE = 1.75;
const EDITOR_WORLD_HEIGHT_SCALE = 1.08;

export class VRSceneManager {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.UniversalCamera;
  private sceneRoot!: BABYLON.TransformNode;
  private meshFactory!: MeshFactory;
  private graphLoader: GraphLoader;
  private currentEdges: Set<string> = new Set();
  private currentEdgeKinds: Map<string, GraphEdge['kind']> = new Map();
  private isAnimating: boolean = false;
  private flyObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  private fileColorMap: Map<string, BABYLON.Color3> = new Map();
  private currentFunctionId: string | null = null;
  private currentFaceNormal: BABYLON.Vector3 | null = null;
  private xrExperience: BABYLON.WebXRDefaultExperience | null = null;
  private gripController: Quest3GripController | null = null;
  private xrLoadingPanel: BABYLON.Mesh | null = null;
  private xrLoadingTexture: BABYLON.DynamicTexture | null = null;
  private xrLoadingVisible = false;
  private xrLoadingHideTimer: number | null = null;
  
  // Flight controls
  private flightSpeed = 100;  // Units per second
  private keysPressed: Map<string, boolean> = new Map();
  private isFlying = false;

  // Real-time physics - Two-level hierarchical layout system
  // Level 1: File-level layout (files as nodes, cross-file references as edges)
  private fileLayout: ForceDirectedLayout | null = null;
  
  // Level 2: File-internal layouts (functions within same file)
  private fileInternalLayouts: Map<string, ForceDirectedLayout> = new Map();

  
  // Tracking for the hierarchical system
  private nodeMeshMap: Map<string, BABYLON.Mesh> = new Map();  // Map node IDs to their meshes
  private nodeToFile: Map<string, string> = new Map();  // Map node IDs to file names
  private fileNodeIds: Map<string, Set<string>> = new Map();  // Map file names to their node IDs
  private graphNodeMap: Map<string, GraphNode> = new Map();  // Map node IDs to GraphNode data
  private fileBoxMeshes: Map<string, BABYLON.Mesh> = new Map();  // Map file names to their wireframe box meshes
  private directoryBoxMeshes: Map<string, BABYLON.Mesh> = new Map();  // Map directory paths to directory box meshes
  private currentGraphData: GraphData | null = null;  // Store full graph data for edge material selection
  
  private physicsActive = false;
  private physicsIterationCount = 0;
  private physicsLoopInitialized = false;
  private labelCollisionTick = 0;
  private lastFileBoxScales: Map<string, BABYLON.Vector3> = new Map();
  private lastDirectoryBoxScales: Map<string, BABYLON.Vector3> = new Map();
  private fileBoxLabels: Map<string, BABYLON.Mesh> = new Map();
  private directoryBoxLabels: Map<string, BABYLON.Mesh> = new Map();
  private fileLabelLookup: Map<string, BABYLON.Mesh> = new Map();
  private directoryLabelLookup: Map<string, BABYLON.Mesh> = new Map();
  private labelsVisible = false;
  private hoveredBreadcrumbChip: BABYLON.Mesh | null = null;
  private editorVisibleForNodeId: string | null = null;
  private functionEditorScreen: BABYLON.Mesh | null = null;
  private functionEditorTexture: BABYLON.DynamicTexture | null = null;
  private functionEditorMaterial: BABYLON.StandardMaterial | null = null;
  private editorCurrentNodeId: string | null = null;
  private editorCallButtons: Array<{ x: number; y: number; width: number; height: number; targetNodeId: string }> = [];
  private editorScrollButtons: Array<{ x: number; y: number; width: number; height: number; action: 'up' | 'down' }> = [];
  private editorCodeScrollByNodeId: Map<string, number> = new Map();
  private editorCurrentCodeLineCount = 0;
  private editorCurrentCodeMaxLines = 0;
  private lastEditorAttachmentSignature: string | null = null;
  private labelScaleState: Map<number, number> = new Map();
  private graphUpdateInProgress = false;
  private lastGraphReloadAtMs = 0;
  private desktopStartupRecenterDone = false;
  private lastDeclutterSignature: string | null = null;
  private readonly xrNavigationDebug = ((import.meta.env.VITE_XR_NAV_DEBUG ?? 'false').toLowerCase() === 'true');
  private readonly exportedFaceCircleLayout = ((import.meta.env.VITE_EXPORTED_FACE_CIRCLE ?? 'false').toLowerCase() === 'true');
  private readonly useLegacyExportedFaceLayout = ((import.meta.env.VITE_LEGACY_EXPORTED_FACE_LAYOUT ?? 'false').toLowerCase() === 'true');
  private lastTeleportAtByHand: Record<'left' | 'right', number> = { left: 0, right: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Initialize scene action manager for click handling
    this.scene.actionManager = new BABYLON.ActionManager(this.scene);

    // Create scene root transform - all objects will be parented to this
    this.sceneRoot = new BABYLON.TransformNode('sceneRoot', this.scene);

    // Initialize services
    this.meshFactory = new MeshFactory(this.scene);
    this.graphLoader = new GraphLoader(SceneConfig.GRAPH_POLL_INTERVAL_MS);

    // Setup lighting
    this.setupLighting();

    // Create a camera with wider view
    this.setupCamera(canvas);

    // Create a simple ground
    this.createGround();

    // Create XR-specific loading UI inside the scene so it can be shown during
    // immersive session transitions where DOM overlays are not visible.
    this.createXRLoadingPanel();

    // Setup WebXR (non-blocking)
    this.setupWebXR();

    // Handle window resize
    window.addEventListener('resize', () => this.engine.resize());

    // Setup flight controls
    this.setupFlightControls();

    // Setup single scene-level click handler
    this.setupClickHandler();
  }

  /**
   * Add a single scene-level observer for all mesh clicks.
   * Distinguishes a static click (no drag) from mouse-drag look-around:
   * flyTo is only triggered on POINTERUP when the pointer barely moved since
   * POINTERDOWN, so dragging the mouse to rotate the camera always works.
   */
  private setupClickHandler(): void {
    let downX = 0;
    let downY = 0;
    // Record mesh info on POINTERDOWN so the hit is from the initial press,
    // not from wherever the cursor ends up after a drag.
    let pendingMesh: BABYLON.AbstractMesh | null = null;
    let pendingFaceNormal: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 1);
    let pendingNodeId: string | null = null;
    let pendingEdge: { from: string; to: string } | null = null;
    let pendingBox: BABYLON.AbstractMesh | null = null;
    let pendingPickedPoint: BABYLON.Vector3 | null = null;
    let pendingEditorUv: BABYLON.Vector2 | null = null;

    this.scene.onPointerObservable.add((pointerEvent) => {
      // In XR, trigger-based navigation is handled by Quest3GripController.
      // Ignore desktop/canvas pointer events to avoid duplicate fly actions.
      if (this.isInXR()) {
        return;
      }

      if (pointerEvent.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        this.updateBreadcrumbHoverFromPointer(this.scene.pointerX, this.scene.pointerY);
        return;
      }

      if (pointerEvent.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        downX = this.scene.pointerX;
        downY = this.scene.pointerY;
        pendingMesh = null;
        pendingEdge = null;
        pendingBox = null;
        pendingPickedPoint = null;
        pendingEditorUv = null;

        const hits = this.scene.multiPick(downX, downY) || [];
        const validHits = hits.filter((h) => h?.hit && h.pickedMesh);
        const interactiveHits = validHits.filter((h) => {
          const meshAny = h.pickedMesh as any;
          const meshName = h.pickedMesh?.name || '';
          const isBoxSurface = meshName.startsWith('filebox_') || meshName.startsWith('dirbox_');
          const isEditorScreen = this.functionEditorScreen !== null && h.pickedMesh === this.functionEditorScreen;
          return meshAny.nodeData !== undefined
            || meshAny.edgeData !== undefined
            || meshAny.labelData !== undefined
            || isBoxSurface
            || isEditorScreen;
        });

        const prioritizedHit = this.selectPrioritizedInteractiveHit(interactiveHits)
          || interactiveHits[0]
          || validHits[0];

        if (prioritizedHit && prioritizedHit.pickedMesh) {
          const mesh = prioritizedHit.pickedMesh;
          if (this.functionEditorScreen && mesh === this.functionEditorScreen) {
            pendingEditorUv = prioritizedHit.getTextureCoordinates() || null;
            pendingNodeId = null;
            pendingEdge = null;
            pendingBox = null;
            pendingMesh = mesh;
            pendingFaceNormal = new BABYLON.Vector3(0, 0, 1);
            pendingPickedPoint = null;
            return;
          }

          const clickedNode = (mesh as any).nodeData as GraphNode;
          const clickedEdge = (mesh as any).edgeData as { from: string; to: string } | undefined;
          const isBoxSurface = mesh.name.startsWith('filebox_') || mesh.name.startsWith('dirbox_');
          let faceNormal = (prioritizedHit as any).normal || new BABYLON.Vector3(0, 0, 1);
          const pickedPoint = (prioritizedHit as any).pickedPoint as BABYLON.Vector3 | null;
          if (clickedNode) {
            faceNormal = this.quantizeFaceNormalFromPickedPoint(mesh as BABYLON.Mesh, pickedPoint, faceNormal);
            pendingNodeId = clickedNode.id;
            pendingEdge = null;
            pendingBox = null;
          } else {
            pendingNodeId = null;
            pendingEdge = clickedEdge || null;
            pendingBox = isBoxSurface ? mesh : null;
          }
          pendingMesh = mesh;
          pendingFaceNormal = faceNormal.clone();
          pendingPickedPoint = pickedPoint?.clone() || null;
        }
      }

      if (pointerEvent.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (!pendingMesh) return;
        // Ignore if the pointer moved more than 5px — that was a drag, not a click.
        const dx = this.scene.pointerX - downX;
        const dy = this.scene.pointerY - downY;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          pendingMesh = null;
          return;
        }

        if (pendingEditorUv) {
          this.handleEditorScreenClick(pendingEditorUv);
          pendingMesh = null;
          pendingEdge = null;
          pendingBox = null;
          pendingPickedPoint = null;
          pendingEditorUv = null;
          return;
        }

        if (pendingNodeId !== null) {
          const targetMesh = pendingMesh as BABYLON.Mesh;
          this.navigateToFunctionMesh(targetMesh, pendingFaceNormal.clone());
          pendingMesh = null;
          pendingEdge = null;
          pendingBox = null;
          pendingPickedPoint = null;
          return;
        } else if (pendingEdge) {
          const fromMesh = this.nodeMeshMap.get(pendingEdge.from);
          const toMesh = this.nodeMeshMap.get(pendingEdge.to);

          if (fromMesh && toMesh) {
            const fromPos = fromMesh.getAbsolutePosition();
            const toPos = toMesh.getAbsolutePosition();
            const pickedPoint = pendingPickedPoint || pendingMesh.getAbsolutePosition();

            const nearSource = BABYLON.Vector3.DistanceSquared(pickedPoint, fromPos)
              <= BABYLON.Vector3.DistanceSquared(pickedPoint, toPos);
            const destinationMesh = nearSource ? toMesh : fromMesh;
            const destinationId = nearSource ? pendingEdge.to : pendingEdge.from;

            this.currentFunctionId = destinationId;
            this.currentFaceNormal = null;
            this.flyToWorldPosition(destinationMesh.getAbsolutePosition(), destinationMesh);
            pendingMesh = null;
            pendingEdge = null;
            pendingBox = null;
            pendingPickedPoint = null;
            return;
          }
        } else if (pendingBox) {
          const boxMesh = pendingBox as BABYLON.Mesh;
          const pickedPoint = pendingPickedPoint || boxMesh.getAbsolutePosition();
          const boxBounds = boxMesh.getBoundingInfo().boundingBox;
          const cameraInside = boxBounds.intersectsPoint(this.camera.position);

          if (cameraInside) {
            let outwardNormal = pendingFaceNormal.normalize();
            if (!Number.isFinite(outwardNormal.length()) || outwardNormal.length() < 0.001) {
              outwardNormal = pickedPoint.subtract(boxBounds.centerWorld).normalize();
            }
            const outsideTarget = pickedPoint.add(outwardNormal.scale(8.0));
            this.currentFunctionId = null;
            this.currentFaceNormal = null;
            this.flyToWorldPosition(outsideTarget);
            pendingMesh = null;
            pendingEdge = null;
            pendingBox = null;
            pendingPickedPoint = null;
            return;
          }
        }
        const pendingLabelData = (pendingMesh as any).labelData as { kind: 'file' | 'directory'; path: string } | undefined;
        if (pendingLabelData) {
          this.currentFunctionId = null;
          this.currentFaceNormal = null;
          const targetLabel = this.resolveBreadcrumbNavigationTarget(pendingLabelData.kind, pendingLabelData.path, pendingMesh);
          this.flyToWorldPosition(targetLabel.getAbsolutePosition(), targetLabel, 12);
          pendingMesh = null;
          pendingEdge = null;
          pendingBox = null;
          pendingPickedPoint = null;
          return;
        }
        try {
          this.currentFaceNormal = pendingFaceNormal.clone();
          const targetWorldPos = pendingMesh.getAbsolutePosition();
          this.flyToWorldPosition(targetWorldPos, pendingMesh);
        } catch (error) {
          console.error('Error during animation setup:', error);
          this.isAnimating = false;
        }
        pendingMesh = null;
        pendingEdge = null;
        pendingBox = null;
        pendingPickedPoint = null;
        pendingEditorUv = null;
      }
    });
  }

  private isBreadcrumbChipMesh(mesh: BABYLON.AbstractMesh | null | undefined): mesh is BABYLON.Mesh {
    return !!mesh && (mesh as any).labelData !== undefined;
  }

  private setBreadcrumbChipHoverState(chip: BABYLON.Mesh, hovered: boolean): void {
    const baseScale = ((chip as any).__breadcrumbBaseScale as BABYLON.Vector3 | undefined) || chip.scaling.clone();
    (chip as any).__breadcrumbBaseScale = baseScale.clone();

    const chipMaterial = chip.material as BABYLON.StandardMaterial | null;
    chip.renderOutline = hovered;
    chip.scaling = hovered ? baseScale.scale(1.08) : baseScale.clone();

    if (chipMaterial) {
      chipMaterial.emissiveColor = hovered
        ? new BABYLON.Color3(1.2, 1.2, 1.2)
        : new BABYLON.Color3(1, 1, 1);
    }
  }

  private clearBreadcrumbHoverState(): void {
    if (!this.hoveredBreadcrumbChip) {
      return;
    }

    this.setBreadcrumbChipHoverState(this.hoveredBreadcrumbChip, false);
    this.hoveredBreadcrumbChip = null;
  }

  private updateBreadcrumbHoverFromPointer(pointerX: number, pointerY: number): void {
    if (!this.labelsVisible) {
      this.clearBreadcrumbHoverState();
      return;
    }

    const hits = this.scene.multiPick(pointerX, pointerY) || [];
    const validHits = hits.filter((h) => h?.hit && this.isBreadcrumbChipMesh(h.pickedMesh));
    const hoveredHit = this.getNearestHitByPredicate(validHits, (mesh) => this.isBreadcrumbChipMesh(mesh));
    const nextHovered = this.isBreadcrumbChipMesh(hoveredHit?.pickedMesh)
      ? hoveredHit!.pickedMesh
      : null;

    if (nextHovered === this.hoveredBreadcrumbChip) {
      return;
    }

    if (this.hoveredBreadcrumbChip) {
      this.setBreadcrumbChipHoverState(this.hoveredBreadcrumbChip, false);
    }

    this.hoveredBreadcrumbChip = nextHovered;
    if (this.hoveredBreadcrumbChip) {
      this.setBreadcrumbChipHoverState(this.hoveredBreadcrumbChip, true);
    }
  }

  private getNearestHitByPredicate(
    hits: BABYLON.PickingInfo[],
    predicate: (mesh: BABYLON.AbstractMesh) => boolean,
  ): BABYLON.PickingInfo | null {
    let nearest: BABYLON.PickingInfo | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const hit of hits) {
      const mesh = hit.pickedMesh;
      if (!mesh || !predicate(mesh)) {
        continue;
      }

      const hitDistance = typeof hit.distance === 'number' ? hit.distance : Number.POSITIVE_INFINITY;
      if (hitDistance < nearestDistance) {
        nearestDistance = hitDistance;
        nearest = hit;
      }
    }

    return nearest;
  }

  private selectPrioritizedInteractiveHit(hits: BABYLON.PickingInfo[]): BABYLON.PickingInfo | null {
    if (this.functionEditorScreen) {
      const nearestEditorHit = this.getNearestHitByPredicate(hits, (mesh) => mesh === this.functionEditorScreen);
      if (nearestEditorHit) {
        return nearestEditorHit;
      }
    }

    // Breadcrumb/label chips must win when overlapping with nodes/edges.
    const nearestLabelHit = this.getNearestHitByPredicate(hits, (mesh) => (mesh as any).labelData !== undefined);
    if (nearestLabelHit) {
      return nearestLabelHit;
    }

    // For non-label picks, prefer edges only when they are effectively as close
    // as the nearest node, otherwise honor the actually closer object.
    const nearestEdgeHit = this.getNearestHitByPredicate(hits, (mesh) => (mesh as any).edgeData !== undefined);
    const nearestNodeHit = this.getNearestHitByPredicate(hits, (mesh) => (mesh as any).nodeData !== undefined);
    const EDGE_PRIORITY_DISTANCE_EPSILON = 1.0;

    if (nearestEdgeHit && nearestNodeHit) {
      const edgeDistance = typeof nearestEdgeHit.distance === 'number'
        ? nearestEdgeHit.distance
        : Number.POSITIVE_INFINITY;
      const nodeDistance = typeof nearestNodeHit.distance === 'number'
        ? nearestNodeHit.distance
        : Number.POSITIVE_INFINITY;

      if (edgeDistance <= nodeDistance + EDGE_PRIORITY_DISTANCE_EPSILON) {
        return nearestEdgeHit;
      }

      return nearestNodeHit;
    }

    return nearestEdgeHit || nearestNodeHit || null;
  }

  /**
   * Check if click is within 10% of a cube edge and return adjacent face normal if so
   */
  /**
   * Setup keyboard and mouse controls for free flight
   */
  private setupFlightControls(): void {
    // Keyboard event listeners for WASD movement
    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'shift', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        this.keysPressed.set(key, true);
        this.isFlying = true;
        // Cancel any in-progress fly-to animation so manual flight takes over
        // immediately instead of fighting the tween.
        if (this.isAnimating) {
          this.scene.stopAnimation(this.camera);
          if (this.flyObserver) {
            this.scene.onBeforeRenderObservable.remove(this.flyObserver);
            this.flyObserver = null;
          }
          this.isAnimating = false;
        }
      }
    });

    document.addEventListener('keyup', (event) => {
      const key = event.key.toLowerCase();
      this.keysPressed.set(key, false);
      // Stop flying if no keys are pressed
      if ([...this.keysPressed.values()].every(v => !v)) {
        this.isFlying = false;
      }
    });

    // Update flight each frame
    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        this.updateLabelDistanceScaling();

        if (this.isInXR()) {
          this.updateXRFlight();
        } else if (this.isFlying) {
          this.updateFlight();
        }
      });
    }
  }

  /**
   * Update XR locomotion from controller thumbsticks by moving the sceneRoot.
   * In immersive mode the headset owns the camera, so locomotion must move the world.
   */
  private updateXRFlight(): void {
    if (!this.gripController) {
      return;
    }

    const leftGrip = this.gripController.getGripState('left');
    const rightGrip = this.gripController.getGripState('right');
    const deadzone = 0.15;

    const strafeInput = Math.abs(leftGrip.thumbstickX) > deadzone ? leftGrip.thumbstickX : 0;
    const forwardInput = Math.abs(leftGrip.thumbstickY) > deadzone ? -leftGrip.thumbstickY : 0;
    const verticalInput = Math.abs(rightGrip.thumbstickY) > deadzone ? rightGrip.thumbstickY : 0;

    if (strafeInput === 0 && forwardInput === 0 && verticalInput === 0) {
      return;
    }

    // Manual thumbstick locomotion must override any in-progress XR fly animation.
    if (this.isAnimating) {
      this.scene.stopAnimation(this.sceneRoot);
      this.isAnimating = false;
    }

    const deltaTime = Math.min(this.engine.getDeltaTime() / 1000, 1 / 30);
    const distance = this.flightSpeed * deltaTime;
    const activeCamera = this.scene.activeCamera;
    if (!activeCamera) {
      return;
    }

    const cameraForward = activeCamera.getForwardRay().direction;
    const flatForward = new BABYLON.Vector3(cameraForward.x, 0, cameraForward.z);
    const forward = flatForward.lengthSquared() > 0.0001
      ? flatForward.normalize()
      : new BABYLON.Vector3(0, 0, 1);
    const right = new BABYLON.Vector3(forward.z, 0, -forward.x);
    const up = BABYLON.Axis.Y;

    const desiredMovement = BABYLON.Vector3.Zero();
    desiredMovement.addInPlace(forward.scale(forwardInput * distance));
    desiredMovement.addInPlace(right.scale(strafeInput * distance));
    desiredMovement.addInPlace(up.scale(verticalInput * distance));

    if (desiredMovement.lengthSquared() === 0) {
      return;
    }

    // Move the world opposite the user's intended locomotion.
    this.sceneRoot.position.subtractInPlace(desiredMovement);
  }

  /**
   * Update camera position based on keyboard input for free flight
   */
  private updateFlight(): void {
    // Clamp delta to avoid large per-frame movement spikes that look like vibration.
    const deltaTime = Math.min(this.engine.getDeltaTime() / 1000, 1 / 30);
    const distance = this.flightSpeed * deltaTime;

    // Get camera direction vectors
    const forward = this.camera.getDirection(BABYLON.Axis.Z);
    const right = this.camera.getDirection(BABYLON.Axis.X);
    const up = BABYLON.Axis.Y;

    const movement = BABYLON.Vector3.Zero();

    // Process keyboard input
    if (this.keysPressed.get('w') || this.keysPressed.get('arrowup')) {
      // Move forward
      movement.addInPlace(forward.scale(distance));
    }
    if (this.keysPressed.get('s') || this.keysPressed.get('arrowdown')) {
      // Move backward
      movement.addInPlace(forward.scale(-distance));
    }
    if (this.keysPressed.get('a') || this.keysPressed.get('arrowleft')) {
      // Move left
      movement.addInPlace(right.scale(-distance));
    }
    if (this.keysPressed.get('d') || this.keysPressed.get('arrowright')) {
      // Move right
      movement.addInPlace(right.scale(distance));
    }
    if (this.keysPressed.get(' ')) {
      // Move up
      movement.addInPlace(up.scale(distance));
    }
    if (this.keysPressed.get('shift') || this.keysPressed.get('control')) {
      // Move down
      movement.addInPlace(up.scale(-distance));
    }

    if (movement.lengthSquared() > 0) {
      this.camera.position.addInPlace(movement);
    }
  }

  /**
   * Set up per-frame physics updates for two-level hierarchical layout
   * Level 1: File-level layout positions file boxes
   * Level 2: File-internal layouts position nodes within their boxes
   */
  private setupPhysicsLoop(): void {
    if (this.physicsLoopInitialized) {
      return;
    }
    this.physicsLoopInitialized = true;

    if (this.scene.registerBeforeRender) {
      this.scene.registerBeforeRender(() => {
        if (this.physicsActive && this.fileLayout && this.fileInternalLayouts.size > 0) {
          // Re-anchor labels only while layout motion is active.
          this.refreshLabelTransformsIfScaleChanged(false);

          // Resolve function-vs-label overlap only while boxes are moving.
          this.labelCollisionTick++;
          if ((this.labelCollisionTick % 3) === 0) {
            this.resolveFunctionLabelObstructions(1);
          }

          // Step 1: Update file-level layout (positions the file boxes)
          this.fileLayout.updateFrame();
          const filePositions = this.fileLayout.getNodes();
          
          // DO NOT update internal layouts during physics loop
          // They are pre-converged in loadGraph and should remain stable
          // Moving the file box automatically moves all child nodes
          
          // Step 3: Update node positions within their file boxes (local positioning)
          // Nodes are parented to file boxes, so local position = position within the box
          // Positions are already set during renderNodes and shouldn't change
          // Note: Nodes don't need updating here - they stay parented to their file boxes

          // Step 3.5: Update file box positions and sizes based on file-level layout
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) {
              // Skip if file node not found (shouldn't happen)
              continue;
            }
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
            
            // File box sizes are now pre-calculated from node bounds and don't change
            // during physics simulation - they were set in renderFileBoxes()
          }
          
          // Step 3b: Apply repulsive forces to prevent file box intersections
          this.applyFileBoxRepulsion(this.fileLayout);

          // Step 3c: Enforce deterministic non-overlap each frame so boxes
          // cannot remain interpenetrating under ongoing layout forces.
          this.resolveInitialFileBoxOverlaps(4);

          // Step 3d: Enforce a minimum surface gap between file boxes.
          this.enforceMinimumFileBoxGap(28.0, 4);

          // Step 3e: Enforce folder-group spacing so file clusters from
          // different top-level directories do not interpenetrate.
          this.enforceTopLevelDirectoryGap(36.0, 1);

          // Re-apply file box transforms after collision resolution so visual meshes
          // immediately match corrected file-level positions in the same frame.
          for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
            const fileNode = filePositions.get(file);
            if (!fileNode) {
              continue;
            }
            fileBox.position.x = fileNode.position.x;
            fileBox.position.y = fileNode.position.y;
            fileBox.position.z = fileNode.position.z;
          }
          
          // Step 5: Check convergence
          this.physicsIterationCount++;
          const maxIterations = 500;  // Reasonable limit for convergence
          if (this.physicsIterationCount > maxIterations) {
            this.physicsActive = false;
            console.log(`✓ Physics converged after ${this.physicsIterationCount} iterations`);
          }
        }
      });
    }
  }

  private quantizeFaceNormalFromPickedPoint(
    mesh: BABYLON.Mesh,
    pickedPoint: BABYLON.Vector3 | null,
    fallbackNormal: BABYLON.Vector3,
  ): BABYLON.Vector3 {
    if (!pickedPoint) {
      return fallbackNormal.clone();
    }

    const center = mesh.getAbsolutePosition();
    const delta = pickedPoint.subtract(center);
    if (!Number.isFinite(delta.length()) || delta.lengthSquared() < 0.000001) {
      return fallbackNormal.clone();
    }

    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    const absZ = Math.abs(delta.z);
    let quantized: BABYLON.Vector3;
    if (absX >= absY && absX >= absZ) {
      quantized = new BABYLON.Vector3(delta.x >= 0 ? 1 : -1, 0, 0);
    } else if (absY >= absX && absY >= absZ) {
      quantized = new BABYLON.Vector3(0, delta.y >= 0 ? 1 : -1, 0);
    } else {
      quantized = new BABYLON.Vector3(0, 0, delta.z >= 0 ? 1 : -1);
    }

    return this.coerceFaceNormalToSide(quantized, fallbackNormal);
  }

  private coerceFaceNormalToSide(
    faceNormal: BABYLON.Vector3,
    fallbackNormal: BABYLON.Vector3,
  ): BABYLON.Vector3 {
    // Code view is only shown on side faces (+/-X, +/-Z), never top/bottom.
    if (Math.abs(faceNormal.y) < 0.5) {
      return faceNormal.clone();
    }

    const absFallbackX = Math.abs(fallbackNormal.x);
    const absFallbackZ = Math.abs(fallbackNormal.z);
    if (absFallbackX >= absFallbackZ) {
      return new BABYLON.Vector3(fallbackNormal.x >= 0 ? 1 : -1, 0, 0);
    }
    return new BABYLON.Vector3(0, 0, fallbackNormal.z >= 0 ? 1 : -1);
  }

  /**
   * Compare two face normals with floating-point tolerance
   */
  private isFaceNormalEqual(a: BABYLON.Vector3 | null, b: BABYLON.Vector3 | null): boolean {
    if (!a || !b) return false;
    const tolerance = 0.1;  // Allow small floating-point differences
    return (
      Math.abs(a.x - b.x) < tolerance &&
      Math.abs(a.y - b.y) < tolerance &&
      Math.abs(a.z - b.z) < tolerance
    );
  }

  /**
   * Initialize the scene visualization - must be called after construction
   */
  async initialize(): Promise<void> {
    console.log('📦 Initializing code visualization...');
    
    // Load and render the code graph
    await this.initializeCodeVisualization();
    
    // Start polling for graph updates
    this.setupGraphPolling();
  }

  /**
   * Generate a unique, consistent color for a file based on its name
   */
  private getFileColor(fileName: string): BABYLON.Color3 {
    return FileColorService.getFileColor(fileName, this.fileColorMap);
  }

  private setupLighting(): void {
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
    light.intensity = SceneConfig.LIGHT_INTENSITY;

    const pointLight = new BABYLON.PointLight(
      'pointLight',
      SceneConfig.POINT_LIGHT_POSITION,
      this.scene
    );
    pointLight.intensity = SceneConfig.POINT_LIGHT_INTENSITY;
  }

  private createXRLoadingPanel(): void {
    const panel = BABYLON.MeshBuilder.CreatePlane(
      'xrLoadingPanel',
      { width: 3.2, height: 0.8 },
      this.scene
    );
    panel.isPickable = false;
    panel.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    panel.setEnabled(false);

    const texture = new BABYLON.DynamicTexture(
      'xrLoadingTexture',
      { width: 1024, height: 256 },
      this.scene,
      true
    );
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial('xrLoadingMaterial', this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    material.disableLighting = true;
    material.backFaceCulling = false;
    panel.material = material;

    this.xrLoadingPanel = panel;
    this.xrLoadingTexture = texture;
    this.updateXRLoadingPanelText(0);

    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.xrLoadingVisible || !this.xrLoadingPanel) {
        return;
      }

      const activeCamera = this.scene.activeCamera;
      if (!activeCamera) {
        return;
      }

      const forward = activeCamera.getForwardRay().direction.normalize();
      const targetPosition = activeCamera.globalPosition.add(forward.scale(2.2));
      this.xrLoadingPanel.position.copyFrom(targetPosition);
      this.updateXRLoadingPanelText(Math.floor(performance.now() / 400) % 4);
    });
  }

  private setXRLoadingPanelVisible(visible: boolean): void {
    this.xrLoadingVisible = visible;
    if (this.xrLoadingPanel) {
      this.xrLoadingPanel.setEnabled(visible);
    }
  }

  private updateXRLoadingPanelText(dotCount: number): void {
    if (!this.xrLoadingTexture) {
      return;
    }

    const ctx = this.xrLoadingTexture.getContext() as CanvasRenderingContext2D;
    const width = 1024;
    const height = 256;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(6, 8, 13, 0.88)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(188, 228, 255, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.fillStyle = '#eef3ff';
    ctx.font = '600 96px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`imagining${'.'.repeat(dotCount)}`, width / 2, height / 2);
    this.xrLoadingTexture.update();
  }

  private setupCamera(canvas: HTMLCanvasElement): void {
    this.camera = new BABYLON.UniversalCamera(
      'camera',
      SceneConfig.CAMERA_POSITION,
      this.scene
    );
    this.camera.attachControl(canvas, true);
    // Use only custom flight controls to avoid double-applied keyboard movement jitter.
    const keyboardInput = (this.camera.inputs.attached as any).keyboard;
    if (keyboardInput) {
      this.camera.inputs.remove(keyboardInput);
    }
    this.camera.inertia = SceneConfig.CAMERA_INERTIA;
    this.camera.angularSensibility = SceneConfig.CAMERA_ANGULAR_SENSIBILITY;
    // Set camera to look at the center of the scene
    this.camera.target = BABYLON.Vector3.Zero();
    // Tighten frustum depth range to improve depth precision and reduce shimmer.
    this.camera.minZ = 0.05;
    this.camera.maxZ = 2000;
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      'ground',
      { width: SceneConfig.GROUND_WIDTH, height: SceneConfig.GROUND_HEIGHT },
      this.scene
    );
    ground.parent = this.sceneRoot;
    ground.visibility = 0;
  }

  private async initializeCodeVisualization(): Promise<void> {
    try {
      const rawGraph = await this.graphLoader.loadGraph();
      const graph = rawGraph ? this.sanitizeGraphData(rawGraph) : null;
      
      if (!graph) {
        console.error('❌ Failed to load graph: graph is null or undefined');
        return;
      }
      
      if (!graph.nodes || graph.nodes.length === 0) {
        console.error('❌ Failed to load graph: no nodes found');
        return;
      }
      
      console.log(`✓ Graph loaded: ${graph.nodes.length} nodes, ${graph.edges?.length || 0} edges`);
      this.validateGraphData(graph);
      this.renderCodeGraph(graph);
    } catch (error) {
      console.error('❌ Error initializing code visualization:', error);
    }
  }

  private validateGraphData(graph: GraphData): boolean {
    return graph.nodes && graph.nodes.length > 0 && graph.edges && Array.isArray(graph.edges);
  }

  private setupGraphPolling(): void {
    setInterval(async () => {
      if (this.graphUpdateInProgress) {
        return;
      }

      const now = Date.now();
      if (now - this.lastGraphReloadAtMs < SceneConfig.GRAPH_POLL_INTERVAL_MS) {
        return;
      }

      try {
        if (!this.graphLoader.shouldPoll()) {
          return;
        }

        // Check for updates via lightweight version.json (only ~100 bytes)
        const hasUpdates = await this.graphLoader.checkForUpdates();
        if (!hasUpdates) {
          return;  // No updates, skip loading full graph
        }

        this.graphUpdateInProgress = true;

        // Only load full graph.json if version changed
        const rawGraph = await this.graphLoader.loadGraph();
        const graph = rawGraph ? this.sanitizeGraphData(rawGraph) : null;
        if (graph) {
          const incomingVersion = graph.lastUpdated || '';
          const currentVersion = this.currentGraphData?.lastUpdated || '';
          const incomingSignature = this.computeGraphContentSignature(graph);
          const currentSignature = this.currentGraphData
            ? this.computeGraphContentSignature(this.currentGraphData)
            : '';
          if (incomingVersion && incomingVersion === currentVersion) {
            this.lastGraphReloadAtMs = Date.now();
            return;
          }
          if (incomingSignature && incomingSignature === currentSignature) {
            this.lastGraphReloadAtMs = Date.now();
            return;
          }
          console.log('📊 Graph updated, refreshing visualization...');
          this.updateCodeGraph(graph);
          this.lastGraphReloadAtMs = Date.now();
        }
      } catch (error) {
        // Silent fail - polling is optional
      } finally {
        this.graphUpdateInProgress = false;
      }
    }, SceneConfig.GRAPH_POLL_INTERVAL_MS);
  }

  private isRenderableSourceFile(filePath: string): boolean {
    if (!filePath || filePath === 'external') {
      return false;
    }

    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.endsWith('.html')) {
      return true;
    }
    if (normalized.startsWith('src/') || normalized.startsWith('scripts/')) {
      return true;
    }

    return normalized === 'vite.config.ts' || normalized === 'vitest.config.ts';
  }

  private isHtmlFilePath(filePath: string): boolean {
    return filePath.replace(/\\/g, '/').endsWith('.html');
  }

  private positionHtmlFilesAtTop(minVerticalGap: number = 24): void {
    const htmlFiles = Array.from(this.fileBoxMeshes.keys()).filter((file) => this.isHtmlFilePath(file));
    if (htmlFiles.length === 0) {
      return;
    }

    let maxNonHtmlTop = -Infinity;
    for (const [file, box] of this.fileBoxMeshes.entries()) {
      if (this.isHtmlFilePath(file)) {
        continue;
      }
      maxNonHtmlTop = Math.max(maxNonHtmlTop, box.position.y + (box.scaling.y * 0.5));
    }

    const baselineTop = Number.isFinite(maxNonHtmlTop) ? maxNonHtmlTop : 0;
    let nextTop = baselineTop + minVerticalGap;

    const sortedHtmlFiles = htmlFiles.sort((a, b) => a.localeCompare(b));
    const fileLayoutNodes = this.fileLayout?.getNodes();

    for (const file of sortedHtmlFiles) {
      const box = this.fileBoxMeshes.get(file);
      if (!box) {
        continue;
      }

      const halfHeight = box.scaling.y * 0.5;
      const targetCenterY = nextTop + halfHeight;
      box.position.y = targetCenterY;

      const fileNode = fileLayoutNodes?.get(file);
      if (fileNode) {
        fileNode.position.y = targetCenterY;
      }

      nextTop = targetCenterY + halfHeight + minVerticalGap;
    }
  }

  private sanitizeGraphData(graph: GraphData): GraphData {
    const keptNodes = graph.nodes.filter((node) => {
      if (!node.file) {
        return true;
      }
      return this.isRenderableSourceFile(node.file);
    });

    const keptNodeIds = new Set(keptNodes.map((n) => n.id));
    const keptEdges = graph.edges.filter((edge) => keptNodeIds.has(edge.from) && keptNodeIds.has(edge.to));

    const sourceFiles = new Set<string>();
    for (const node of keptNodes) {
      if (node.file && this.isRenderableSourceFile(node.file)) {
        sourceFiles.add(node.file);
      }
    }

    const sanitizedFiles = Array.from(sourceFiles).sort();

    const sanitized: GraphData = {
      ...graph,
      nodes: keptNodes,
      edges: keptEdges,
      files: sanitizedFiles,
    };

    if (
      sanitized.nodes.length !== graph.nodes.length
      || sanitized.edges.length !== graph.edges.length
      || (graph.files?.length || 0) !== sanitizedFiles.length
    ) {
      console.log(
        `🧹 Graph sanitized: nodes ${graph.nodes.length}->${sanitized.nodes.length}, edges ${graph.edges.length}->${sanitized.edges.length}, files ${(graph.files?.length || 0)}->${sanitizedFiles.length}`
      );
    }

    return sanitized;
  }

  private computeGraphContentSignature(graph: GraphData): string {
    let hash = 2166136261;
    const append = (value: string): void => {
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    };

    const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
    for (const node of nodes) {
      append(`n|${node.id}|${node.file || ''}|${node.line || 0}|${node.isExported ? 1 : 0}|${node.type || ''}|${node.code || ''}`);
    }

    const edges = [...graph.edges].sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
    for (const edge of edges) {
      append(`e|${edge.from}|${edge.to}|${edge.kind || 'call'}`);
    }

    const files = [...(graph.files || [])].sort();
    for (const file of files) {
      append(`f|${file}`);
    }

    return `${hash >>> 0}`;
  }



  public renderCodeGraph(graph: GraphData): void {
    this.prepareRenderState(graph);

    const fileMap = this.buildFileNodeMaps(graph);
    this.createAndSettleInternalLayouts(graph, fileMap);

    const indegreeMap = this.calculateIndegree(graph.edges);
    this.renderFileBoxes();

    const files = this.createAndSettleFileLevelLayout(graph, fileMap);
    this.applyFileLayoutPositions();

    this.renderNodes(graph.nodes, indegreeMap);
    this.layoutAndPopulateExternalLibraries(graph);
    this.fitAndSeparateFileBoxes();
    this.renderDirectoryBoxes();
    this.forceLayoutWithCurrentBoxSizes(2);
    this.refreshLabelTransformsIfScaleChanged(true);

    this.populateCurrentEdges(graph);
    this.resolveEdgeObstructions(30);
    this.resolveNodeEdgeObstructions(20);
    if (this.useLegacyExportedFaceLayout) {
      this.placeExportedFunctionsOnOptimalFace();
      this.spreadExportedFunctionsOnFaces(12);
      this.pullInternalNodesToExportedFace();
      this.rerunInternalLayoutsAfterExportPlacement(120);
      this.resizeAndResolveAfterInternalRelayout();
      this.resolveNodeEdgeObstructions(20);
      this.resolveExportedFaceEdgeObstructions(15);
      this.spreadExportedFunctionsOnFaces(8);
      this.resolveFunctionLabelObstructions(12);
    }
    this.positionHtmlFilesAtTop(30);
    this.resolveNodeEdgeObstructions(10);
    this.resolveInternalNodeCollisions(10, true);
    this.enforceInFileNodeClearance(8);
    this.clampNodesInsideFileBoxes();
    this.autosizeFileBoxes();
    this.resolveInitialFileBoxOverlaps(6);
    this.enforceMinimumFileBoxGap(32.0, 6);
    this.enforceTopLevelDirectoryGap(40.0, 2);
    this.renderDirectoryBoxes();
    this.refreshLabelTransformsIfScaleChanged(true);

    this.frameCameraToExportedFunctions();
    this.recenterGraphInFrontOfDesktopCameraOnce();
    this.renderEdges();
    this.meshFactory.updateEdges();
    this.startNavigationAtIndexHtmlIfAvailable();

    this.physicsActive = false;
    this.physicsIterationCount = 0;
    this.setupPhysicsLoop();

    console.log(`✓ Rendered code graph with ${graph.nodes.length} functions in ${files.length} files and ${graph.edges.length} calls`);
  }

  private startNavigationAtIndexHtmlIfAvailable(): void {
    const indexNode = this.currentGraphData?.nodes.find((n) => n.id === 'html:index.html');
    if (!indexNode) {
      return;
    }

    const indexMesh = this.nodeMeshMap.get(indexNode.id);
    if (!indexMesh || !indexMesh.isEnabled() || !indexMesh.isVisible) {
      return;
    }

    this.currentFunctionId = indexNode.id;
    this.currentFaceNormal = null;
    this.flyToWorldPosition(indexMesh.getAbsolutePosition(), indexMesh);
    this.logXRNavigationDebug('startup:index-html-focus', {
      nodeId: indexNode.id,
      worldPos: this.formatDebugVector(indexMesh.getAbsolutePosition()),
    });
  }

  private prepareRenderState(graph: GraphData): void {
    // Always start new graph renders from the world origin so objects are not
    // biased by any prior camera-follow animation offsets.
    this.sceneRoot.position = BABYLON.Vector3.Zero();
    this.currentFunctionId = null;
    this.currentFaceNormal = null;
    this.isAnimating = false;
    this.hideFunctionEditor();

    this.currentGraphData = graph;
    this.graphNodeMap.clear();
    this.desktopStartupRecenterDone = false;
    for (const node of graph.nodes) {
      this.graphNodeMap.set(node.id, node);
    }
  }

  private recenterGraphInFrontOfDesktopCameraOnce(): void {
    if (this.desktopStartupRecenterDone || this.isInXR()) {
      return;
    }

    const activeCamera = this.scene.activeCamera || this.camera;
    if (!activeCamera) {
      return;
    }

    const cameraPos = activeCamera.position.clone();
    let forward = activeCamera.getForwardRay(1).direction;
    if (!Number.isFinite(forward.length()) || forward.lengthSquared() < 0.000001) {
      forward = this.camera.target.subtract(this.camera.position);
    }
    if (!Number.isFinite(forward.length()) || forward.lengthSquared() < 0.000001) {
      forward = new BABYLON.Vector3(0, 0, 1);
    }
    forward.normalize();

    let sum = BABYLON.Vector3.Zero();
    let count = 0;
    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.type === 'external') {
        continue;
      }
      if (!mesh.isEnabled() || !mesh.isVisible) {
        continue;
      }
      sum = sum.add(mesh.getAbsolutePosition());
      count++;
    }
    if (count === 0) {
      return;
    }

    const currentCenterWorld = sum.scale(1 / count);
    const desiredDistance = 70;
    const desiredCenterWorld = cameraPos.add(forward.scale(desiredDistance));
    const delta = desiredCenterWorld.subtract(currentCenterWorld);

    this.sceneRoot.position.addInPlace(delta);
    this.camera.setTarget(desiredCenterWorld);
    this.desktopStartupRecenterDone = true;

    this.logXRNavigationDebug('desktop-recenter:on-startup', {
      cameraPos: this.formatDebugVector(cameraPos),
      desiredCenterWorld: this.formatDebugVector(desiredCenterWorld),
      currentCenterWorld: this.formatDebugVector(currentCenterWorld),
      sceneRootDelta: this.formatDebugVector(delta),
      sceneRootAfter: this.formatDebugVector(this.sceneRoot.position),
      nodeCount: count,
    });
  }

  private buildFileNodeMaps(graph: GraphData): Map<string, string> {
    const fileMap = new Map<string, string>();

    // Seed file set from full project inventory (all file types) when available.
    if (graph.files) {
      for (const filePath of graph.files) {
        if (!filePath || filePath === 'external') {
          continue;
        }
        if (!this.fileNodeIds.has(filePath)) {
          this.fileNodeIds.set(filePath, new Set());
        }
      }
    }

    for (const node of graph.nodes) {
      if (!node.file) {
        continue;
      }

      fileMap.set(node.id, node.file);
      this.nodeToFile.set(node.id, node.file);

      if (!this.fileNodeIds.has(node.file)) {
        this.fileNodeIds.set(node.file, new Set());
      }
      this.fileNodeIds.get(node.file)!.add(node.id);
    }
    return fileMap;
  }

  private createAndSettleInternalLayouts(graph: GraphData, fileMap: Map<string, string>): void {
    const allEdges = this.buildEdgeList(graph.edges);
    const nodeExportedMap = new Map<string, boolean>();
    const nodeSizeMap = new Map<string, number>();

    for (const node of graph.nodes) {
      nodeExportedMap.set(node.id, !!node.isExported);

      // Functions are rendered with different box sizes, so mirror that in
      // layout radii to preserve spacing in the force simulation.
      let size = 1.0;
      if (node.type === 'function') {
        size = node.isExported ? 1.8 : 1.3;
      }
      nodeSizeMap.set(node.id, size);
    }

    for (const [file, nodeIds] of this.fileNodeIds.entries()) {
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
        nodeSizeMap
      );
      this.fileInternalLayouts.set(file, internalLayout);
    }

    for (const internalLayout of this.fileInternalLayouts.values()) {
      internalLayout.simulate(500);
    }

    this.recenterInternalLayouts();
  }

  private createAndSettleFileLevelLayout(graph: GraphData, fileMap: Map<string, string>): string[] {
    const files = Array.from(this.fileNodeIds.keys());
    const crossFileEdges = this.buildCrossFileEdges(graph.edges, fileMap);

    console.log(`📍 File-level layout: ${files.length} files, ${crossFileEdges.length} cross-file edges`);
    console.log(`   Files: ${files.join(', ')}`);
    console.log(`   Cross-file edges: ${crossFileEdges.map(e => `${e.source}->${e.target}`).join(', ')}`);

    this.fileLayout = new ForceDirectedLayout(files, crossFileEdges);
    this.fileLayout.simulate(600);
    return files;
  }

  private applyFileLayoutPositions(): void {
    if (!this.fileLayout) {
      return;
    }

    const initialFilePositions = this.fileLayout.getNodes();
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = initialFilePositions.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  private fitAndSeparateFileBoxes(): void {
    this.autosizeFileBoxes();
    this.ensureExportedFunctionsParentedToFileBoxes();
    this.clampNodesInsideFileBoxes();
    this.resolveInternalNodeCollisions(12);
    this.enforceInFileNodeClearance();
    this.clampNodesInsideFileBoxes();

    this.positionFileBoxesInGrid();

    // Always resolve collisions immediately after any resize/reposition.
    this.resolveInitialFileBoxOverlaps(6);
    this.enforceMinimumFileBoxGap(28.0, 6);

    // Pull boxes toward their mutual centroid to minimise total bounding volume.
    this.compactFileBoxLayout(80, 28.0);
  }

  /**
   * After exported functions are pinned/spread on faces, run a short same-file
   * force pass for non-exported internal nodes, then apply resulting local
   * positions back to meshes.
   */
  private rerunInternalLayoutsAfterExportPlacement(iterations: number = 120): void {
    for (const [file, internalLayout] of this.fileInternalLayouts.entries()) {
      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) {
        continue;
      }

      const layoutNodes = internalLayout.getNodes();

      // Seed layout from current mesh local positions so this is a refinement,
      // not a random reset.
      for (const [nodeId, layoutNode] of layoutNodes.entries()) {
        const mesh = this.nodeMeshMap.get(nodeId);
        if (!mesh || mesh.parent !== fileBox) {
          continue;
        }
        layoutNode.position.x = mesh.position.x;
        layoutNode.position.y = mesh.position.y;
        layoutNode.position.z = mesh.position.z;
        layoutNode.velocity = { x: 0, y: 0, z: 0 };
      }

      internalLayout.simulate(iterations);

      // Apply back only to non-exported nodes; exported nodes stay face-pinned.
      for (const [nodeId, layoutNode] of layoutNodes.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.isExported) {
          continue;
        }

        const mesh = this.nodeMeshMap.get(nodeId);
        if (!mesh || mesh.parent !== fileBox) {
          continue;
        }

        mesh.position.x = layoutNode.position.x;
        mesh.position.y = layoutNode.position.y;
        mesh.position.z = layoutNode.position.z;
      }
    }

    this.clampNodesInsideFileBoxes();
    this.enforceInFileNodeClearance();
    this.clampNodesInsideFileBoxes();
  }

  /**
   * Resize file boxes to current internal node placement, then resolve file-box
   * collisions/gaps before continuing with edge cleanup.
   */
  private resizeAndResolveAfterInternalRelayout(): void {
    this.autosizeFileBoxes();
    this.resolveInitialFileBoxOverlaps(6);
    this.enforceMinimumFileBoxGap(32.0, 6);
    this.enforceTopLevelDirectoryGap(40.0, 2);
    this.renderDirectoryBoxes();
    this.refreshLabelTransformsIfScaleChanged(true);
  }

  /**
   * After box sizes are updated, run an additional deterministic layout pass so
   * the new volumes are respected by spacing/compaction, then rebuild directories.
   */
  private forceLayoutWithCurrentBoxSizes(iterations: number = 2): void {
    if (!this.fileLayout) {
      return;
    }

    for (let i = 0; i < iterations; i++) {
      this.resolveInitialFileBoxOverlaps(8);
      this.enforceMinimumFileBoxGap(32.0, 8);
      this.enforceTopLevelDirectoryGap(40.0, 3);
      this.compactFileBoxLayout(60, 32.0);

      // Directory sizes/positions are derived from file boxes, so rebuild each pass.
      this.renderDirectoryBoxes();
    }
  }

  /**
   * Push top-level directory file groups apart by moving file-layout nodes.
   * This makes folder clusters participate in layout resolution, not just files.
   */
  private enforceTopLevelDirectoryGap(minGap: number, maxPasses: number = 3): void {
    if (!this.fileLayout) {
      return;
    }

    const fileNodes = this.fileLayout.getNodes();
    const files = Array.from(this.fileBoxMeshes.keys()).filter((f) => f !== 'external');

    const getTopLevelGroup = (filePath: string): string => {
      const rel = toProjectRelativePath(filePath);
      const parts = rel.split('/').filter(Boolean);
      if (parts.length <= 1) {
        return '__root__';
      }
      return parts[0];
    };

    const groups = new Map<string, string[]>();
    for (const file of files) {
      const group = getTopLevelGroup(file);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(file);
    }

    const groupKeys = Array.from(groups.keys());
    if (groupKeys.length < 2) {
      return;
    }

    type Bounds = {
      cx: number; cy: number; cz: number;
      hx: number; hy: number; hz: number;
    };

    const computeBounds = (group: string): Bounds | null => {
      const fileList = groups.get(group);
      if (!fileList || fileList.length === 0) return null;

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (const file of fileList) {
        const box = this.fileBoxMeshes.get(file);
        if (!box) continue;
        const hx = box.scaling.x * 0.5;
        const hy = box.scaling.y * 0.5;
        const hz = box.scaling.z * 0.5;
        minX = Math.min(minX, box.position.x - hx);
        minY = Math.min(minY, box.position.y - hy);
        minZ = Math.min(minZ, box.position.z - hz);
        maxX = Math.max(maxX, box.position.x + hx);
        maxY = Math.max(maxY, box.position.y + hy);
        maxZ = Math.max(maxZ, box.position.z + hz);
      }

      if (!Number.isFinite(minX)) return null;

      return {
        cx: (minX + maxX) * 0.5,
        cy: (minY + maxY) * 0.5,
        cz: (minZ + maxZ) * 0.5,
        hx: (maxX - minX) * 0.5,
        hy: (maxY - minY) * 0.5,
        hz: (maxZ - minZ) * 0.5,
      };
    };

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < groupKeys.length; i++) {
        for (let j = i + 1; j < groupKeys.length; j++) {
          const groupA = groupKeys[i];
          const groupB = groupKeys[j];
          const a = computeBounds(groupA);
          const b = computeBounds(groupB);
          if (!a || !b) continue;

          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const dz = b.cz - a.cz;

          const overlapX = (a.hx + b.hx + minGap) - Math.abs(dx);
          const overlapY = (a.hy + b.hy + minGap) - Math.abs(dy);
          const overlapZ = (a.hz + b.hz + minGap) - Math.abs(dz);

          if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) {
            continue;
          }

          let axis: 'x' | 'y' | 'z' = 'x';
          let penetration = overlapX;
          if (overlapY < penetration) {
            axis = 'y';
            penetration = overlapY;
          }
          if (overlapZ < penetration) {
            axis = 'z';
            penetration = overlapZ;
          }

          const sign = axis === 'x'
            ? (dx >= 0 ? 1 : -1)
            : axis === 'y'
              ? (dy >= 0 ? 1 : -1)
              : (dz >= 0 ? 1 : -1);

          const correction = (penetration * 0.5) + 0.5;

          const moveGroup = (group: string, dir: number) => {
            const fileList = groups.get(group);
            if (!fileList) return;
            for (const file of fileList) {
              const node = fileNodes.get(file);
              if (!node) continue;
              if (axis === 'x') node.position.x += dir * correction;
              else if (axis === 'y') node.position.y += dir * correction;
              else node.position.z += dir * correction;
            }
          };

          moveGroup(groupA, -sign);
          moveGroup(groupB, sign);
          movedAny = true;
        }
      }

      if (!movedAny) {
        break;
      }

      // Sync file box positions from updated file-layout nodes.
      for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
        const fileNode = fileNodes.get(file);
        if (!fileNode) continue;
        fileBox.position.x = fileNode.position.x;
        fileBox.position.y = fileNode.position.y;
        fileBox.position.z = fileNode.position.z;
      }
    }
  }

  private populateCurrentEdges(graph: GraphData): void {
    this.currentEdges.clear();
    this.currentEdgeKinds.clear();
    for (const edge of graph.edges) {
      const key = `${edge.from}→${edge.to}`;
      this.currentEdges.add(key);
      this.currentEdgeKinds.set(key, edge.kind ?? 'call');
    }
  }

  /**
   * Incrementally update the scene - only create/remove changed objects
   * New nodes are added and physics pushes them apart
   */
  private updateCodeGraph(graph: GraphData): void {
    // For now, just re-render the entire graph when it updates
    // TODO: Implement incremental updates for better performance
    this.clearScene();
    this.renderCodeGraph(graph);
  }

  private clearScene(): void {
    this.hideFunctionEditor();

    // Dispose all node meshes
    for (const mesh of this.nodeMeshMap.values()) {
      mesh.dispose(false, true);
    }
    this.nodeMeshMap.clear();
    this.meshFactory.clearNodeReferences();

    // Dispose all edge meshes/materials via factory-managed caches.
    this.meshFactory.clearEdges();

    // Dispose all file box outlines
    for (const mesh of this.fileBoxMeshes.values()) {
      mesh.dispose(false, true);
    }
    this.fileBoxMeshes.clear();

    // Dispose all directory box outlines
    for (const mesh of this.directoryBoxMeshes.values()) {
      mesh.dispose(false, true);
    }
    this.directoryBoxMeshes.clear();

    // Dispose labels (parented to sceneRoot, not to boxes)
    for (const mesh of this.fileBoxLabels.values()) {
      mesh.dispose(false, true);
    }
    this.fileBoxLabels.clear();
    this.fileLabelLookup.clear();
    for (const mesh of this.directoryBoxLabels.values()) {
      mesh.dispose(false, true);
    }
    this.directoryBoxLabels.clear();
    this.directoryLabelLookup.clear();
    this.labelScaleState.clear();

    // Clear tracking maps
    this.fileInternalLayouts.clear();
    this.fileNodeIds.clear();
    this.nodeToFile.clear();
    this.fileLayout = null;
    this.lastFileBoxScales.clear();
    this.lastDirectoryBoxScales.clear();
  }

  private buildEdgeList(edges: Array<{ from: string; to: string }>): Array<{ source: string; target: string }> {
    return edges.map(e => ({ source: e.from, target: e.to }));
  }

  /**
   * Build edges between file nodes for file-level layout
   * Creates edges between files when there are references crossing file boundaries
   */
  private buildCrossFileEdges(
    edges: Array<{ from: string; to: string }>,
    fileMap: Map<string, string>
  ): Array<{ source: string; target: string }> {
    const fileEdges = new Set<string>();
    
    for (const edge of edges) {
      const sourceFile = fileMap.get(edge.from);
      const targetFile = fileMap.get(edge.to);
      
      // Only create file edge if it's between different files
      if (sourceFile && targetFile && sourceFile !== targetFile) {
        // Create a unique key to avoid duplicate file edges
        const edgeKey = `${sourceFile}->${targetFile}`;
        fileEdges.add(edgeKey);
      }
    }
    
    // Convert edge keys to edge objects
    return Array.from(fileEdges).map(key => {
      const [source, target] = key.split('->');
      return { source, target };
    });
  }

  private renderNodes(
    nodes: GraphNode[],
    indegreeMap: Map<string, number> = new Map()
  ): void {
    const isRenderableNode = (_node: GraphNode): boolean => true;

    let renderCount = 0;

    for (const node of nodes) {
      if (!isRenderableNode(node)) {
        continue;
      }

      const file = node.file || 'external';
      const fileLayout = this.fileInternalLayouts.get(file);

      let position = BABYLON.Vector3.Zero();
      if (fileLayout) {
        const layoutNode = fileLayout.getNodes().get(node.id);
        if (layoutNode) {
          position = new BABYLON.Vector3(
            layoutNode.position.x,
            layoutNode.position.y,
            layoutNode.position.z
          );
        }
      }

      // Get or generate color for this file
      const fileColor = file ? this.getFileColor(file) : null;
      const indegree = indegreeMap.get(node.id) || 0;

      this.meshFactory.createNodeMesh(node, position, fileColor, indegree, (mesh, material, n) => {
        this.setupNodeInteraction(mesh, material, n);

        // Ensure exported functions are visibly rendered from first frame.
        if (n.type === 'function' && n.isExported) {
          mesh.isVisible = true;
          mesh.setEnabled(true);
          material.alpha = 1.0;
          material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
          material.disableLighting = true;
          material.emissiveColor = new BABYLON.Color3(0.95, 0.95, 1.0);
        }

        // Track mesh for physics updates
        this.nodeMeshMap.set(node.id, mesh);
        
        // Parent renderable nodes to their file box and keep local placement.
        const fileBox = this.fileBoxMeshes.get(file);
        if (fileBox) {
          mesh.parent = fileBox;
          mesh.position = position.clone();
          this.applyChildScaleCompensation(mesh, fileBox);
        } else {
          mesh.parent = this.sceneRoot;
          mesh.position = position.clone();
        }

        renderCount++;
      });
    }

    console.log(`📦 Rendered in-file nodes: ${renderCount}`);
  }

  private layoutAndPopulateExternalLibraries(graph: GraphData): void {
    const externalNodes = graph.nodes.filter((n) => n.type === 'external');
    if (externalNodes.length === 0) {
      return;
    }

    const calledExportedByExternal = new Map<string, GraphNode[]>();
    for (const edge of graph.edges) {
      if (!edge.to.startsWith('ext:')) {
        continue;
      }

      const caller = this.graphNodeMap.get(edge.from);
      if (!caller || caller.type !== 'function' || !caller.isExported) {
        continue;
      }

      if (!calledExportedByExternal.has(edge.to)) {
        calledExportedByExternal.set(edge.to, []);
      }

      const callers = calledExportedByExternal.get(edge.to)!;
      if (!callers.some((existing) => existing.id === caller.id)) {
        callers.push(caller);
      }
    }

    const spacing = 34;
    const center = (externalNodes.length - 1) * 0.5;
    for (let i = 0; i < externalNodes.length; i++) {
      const externalNode = externalNodes[i];
      const externalMesh = this.nodeMeshMap.get(externalNode.id);
      if (!externalMesh) {
        continue;
      }

      // Place external libraries in a stable row below primary file clusters.
      externalMesh.parent = this.sceneRoot;
      externalMesh.position.x = (i - center) * spacing;
      externalMesh.position.y = -95;
      externalMesh.position.z = -120;

      const calledExported = (calledExportedByExternal.get(externalNode.id) || []).sort((a, b) => a.name.localeCompare(b.name));
      const childCount = Math.max(1, Math.min(10, calledExported.length));
      // Make the base notably wider so the bottom face region can hold full library names.
      const targetDiameter = Math.max(20, 15.0 + (childCount * 2.2));
      // Increase vertical size so long library names fit more comfortably on sloped faces.
      const targetHeight = Math.max(22, 15.0 + (childCount * 2.2));
      externalMesh.scaling = new BABYLON.Vector3(
        targetDiameter / SceneConfig.EXTERNAL_PYRAMID_BASE,
        targetHeight / SceneConfig.EXTERNAL_PYRAMID_HEIGHT,
        targetDiameter / SceneConfig.EXTERNAL_PYRAMID_BASE,
      );

      const material = externalMesh.material as BABYLON.StandardMaterial | null;
      if (material) {
        material.diffuseColor = new BABYLON.Color3(0.90, 0.72, 0.18);
        material.emissiveColor = new BABYLON.Color3(0.26, 0.20, 0.04);
        material.specularColor = new BABYLON.Color3(1.0, 0.92, 0.56);
        material.specularPower = 96;
        material.alpha = 1.0;
        material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
        material.backFaceCulling = false;
        material.needDepthPrePass = false;
      }

      // Remove prior synthetic child boxes before repopulating embedded caller nodes.
      for (const child of externalMesh.getChildren()) {
        const childMesh = child as BABYLON.Mesh;
        if ((childMesh as any).__externalCallerChild) {
          childMesh.dispose(false, true);
        }
      }

      const visibleCallers = calledExported.slice(0, 10);
      for (let ci = 0; ci < visibleCallers.length; ci++) {
        const caller = visibleCallers[ci];
        const angle = (Math.PI * 2 * ci) / Math.max(1, visibleCallers.length);
        const ringRadius = 0.33;
        const yStep = visibleCallers.length > 1 ? (ci / (visibleCallers.length - 1)) : 0.5;
        const localY = -0.34 + (yStep * 0.68);

        const child = BABYLON.MeshBuilder.CreateBox(
          `extCaller_${externalNode.id}_${ci}`,
          { size: 0.22 },
          this.scene,
        );
        child.parent = externalMesh;
        child.position = new BABYLON.Vector3(
          Math.cos(angle) * ringRadius,
          localY,
          Math.sin(angle) * ringRadius,
        );
        this.applyChildScaleCompensation(child, externalMesh);
        child.isPickable = true;
        (child as any).__externalCallerChild = true;

        const childMat = new BABYLON.StandardMaterial(`extCallerMat_${externalNode.id}_${ci}`, this.scene);
        childMat.diffuseColor = new BABYLON.Color3(0.76, 0.88, 1.0);
        childMat.emissiveColor = new BABYLON.Color3(0.32, 0.45, 0.62);
        childMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        child.material = childMat;

        this.setupNodeInteraction(child, childMat, caller);
      }
    }
  }

  /**
   * Keep child mesh world scale stable when parent file boxes are resized.
   */
  private applyChildScaleCompensation(child: BABYLON.Mesh, fileBox: BABYLON.Mesh): void {
    const safeX = Math.max(0.0001, fileBox.scaling.x);
    const safeY = Math.max(0.0001, fileBox.scaling.y);
    const safeZ = Math.max(0.0001, fileBox.scaling.z);
    child.scaling = new BABYLON.Vector3(1 / safeX, 1 / safeY, 1 / safeZ);
  }

  private setupNodeInteraction(
    mesh: BABYLON.Mesh,
    _material: BABYLON.StandardMaterial,
    node: GraphNode
  ): void {
    // Store node reference on the mesh for later retrieval during clicks
    (mesh as any).nodeData = node;
    
    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        // Outline highlight keeps lighting/material response unchanged.
        mesh.outlineColor = SceneConfig.HOVER_COLOR.clone();
        mesh.outlineWidth = 0.08;
        mesh.renderOutline = true;
      })
    );
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        mesh.renderOutline = false;
      })
    );
  }

  private isInXR(): boolean {
    return this.xrExperience?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
  }

  private formatDebugVector(v: BABYLON.Vector3): { x: number; y: number; z: number } {
    return {
      x: Number(v.x.toFixed(3)),
      y: Number(v.y.toFixed(3)),
      z: Number(v.z.toFixed(3)),
    };
  }

  private logXRNavigationDebug(event: string, details: Record<string, unknown>): void {
    if (!this.xrNavigationDebug) {
      return;
    }
    console.log(`[XR-NAV] ${event}`, details);
  }

  /**
   * Fly camera (desktop) or move sceneRoot (XR) so the target is centred in view.
   */
  private flyToWorldPosition(
    targetWorldPos: BABYLON.Vector3,
    targetMesh?: BABYLON.AbstractMesh,
    labelStandoff: number | false = false,
    faceNormal?: BABYLON.Vector3,
  ): void {
    if (this.isInXR()) {
      this.flyToViaSceneRoot(targetWorldPos, labelStandoff);
    } else {
      this.flyToViaCamera(targetWorldPos, targetMesh, labelStandoff, faceNormal);
    }
  }

  /**
   * Desktop: animate camera position and target to the clicked object.
   * Camera ends up a short distance in front of the target, looking at it.
   */
  private flyToViaCamera(
    targetWorldPos: BABYLON.Vector3,
    targetMesh?: BABYLON.AbstractMesh,
    labelStandoff: number | false = false,
    faceNormal?: BABYLON.Vector3,
  ): void {
    // Cancel any in-progress fly animation before starting a new one.
    this.scene.stopAnimation(this.camera);
    if (this.flyObserver) {
      this.scene.onBeforeRenderObservable.remove(this.flyObserver);
      this.flyObserver = null;
    }
    this.isAnimating = false;

    const currentDir = this.camera.target.subtract(this.camera.position).normalize();
    let newCamPos: BABYLON.Vector3;
    if (labelStandoff !== false) {
      // For labels: position camera a fixed distance in front of the label,
      // offset toward the camera so the text is readable.
      let toCamera = this.camera.position.subtract(targetWorldPos);
      if (!Number.isFinite(toCamera.length()) || toCamera.lengthSquared() < 0.000001) {
        toCamera = currentDir.scale(-1);
      }
      toCamera = toCamera.normalize();
      const labelRadius = targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
      const effectiveLabelStandoff = Math.max(
        labelStandoff as number,
        8,
        (labelRadius * 1.35) + 5,
      );
      newCamPos = targetWorldPos.add(toCamera.scale(effectiveLabelStandoff));
    } else if (faceNormal && faceNormal.lengthSquared() > 0.000001) {
      // Position camera orthogonally in front of the clicked face, close enough
      // that the code panel nearly fills the viewport.
      const meshAny = targetMesh as any;
      const boxSize = typeof meshAny?.boxSize === 'number'
        ? meshAny.boxSize
        : Math.max(1.0, (targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);
      const panelOffset = (boxSize * 0.5) + Math.max(0.14, boxSize * 0.045);

      const activeCamera = this.scene.activeCamera || this.camera;
      const fovY = Math.max(0.45, activeCamera.fov || this.camera.fov || 0.8);
      const renderWidth = Math.max(1, this.engine.getRenderWidth());
      const renderHeight = Math.max(1, this.engine.getRenderHeight());
      const aspect = renderWidth / renderHeight;
      const fovX = 2 * Math.atan(Math.tan(fovY * 0.5) * aspect);

      // Editor plane is square in world units (scaled by box size).
      const panelWorldHeight = boxSize * EDITOR_WORLD_HEIGHT_SCALE;
      const panelWorldWidth = boxSize * EDITOR_WORLD_WIDTH_SCALE;

      // Target fraction of viewport occupied by panel dimensions.
      const targetVerticalFill = 0.86;
      const targetHorizontalFill = 0.80;

      const distanceByHeight = (panelWorldHeight * 0.5) / Math.tan((fovY * targetVerticalFill) * 0.5);
      const distanceByWidth = (panelWorldWidth * 0.5) / Math.tan((fovX * targetHorizontalFill) * 0.5);
      const requiredPanelDistance = Math.max(distanceByHeight, distanceByWidth);

      // Keep a small but stable buffer from the panel surface.
      const desiredPanelGap = Math.max(2.2, requiredPanelDistance);

      const standoffDistance = panelOffset + desiredPanelGap;
      newCamPos = targetWorldPos.add(faceNormal.normalize().scale(standoffDistance));
    } else {
      const radius = targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
      const standoffDistance = Math.max(2, radius + 1.5);
      newCamPos = targetWorldPos.subtract(currentDir.scale(standoffDistance));
    }

    const fps = SceneConfig.FLY_TO_ANIMATION_FPS;
    const totalFrames = (SceneConfig.FLY_TO_ANIMATION_TIME_MS / 1000) * fps;

    // Only animate position — never animate camera.target directly on a
    // UniversalCamera as it corrupts internal rotation state and breaks
    // mouse look after the animation ends.
    const posAnim = new BABYLON.Animation('camFlyPos', 'position', fps, BABYLON.Animation.ANIMATIONTYPE_VECTOR3);
    const startPos = this.camera.position.clone();
    const startTgt = this.camera.target.clone();
    const posKeys: { frame: number; value: BABYLON.Vector3 }[] = [];

    for (let i = 0; i <= totalFrames; i++) {
      const t = i / totalFrames;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      posKeys.push({ frame: i, value: BABYLON.Vector3.Lerp(startPos, newCamPos, e) });
    }
    posAnim.setKeys(posKeys);

    // Drive camera.setTarget() each frame via an observer so rotation state
    // stays consistent and mouse look works after landing.
    const animStart = performance.now();
    const durationMs = SceneConfig.FLY_TO_ANIMATION_TIME_MS;
    this.flyObserver = this.scene.onBeforeRenderObservable.add(() => {
      const elapsed = performance.now() - animStart;
      const t = Math.min(elapsed / durationMs, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.setTarget(BABYLON.Vector3.Lerp(startTgt, targetWorldPos, e));
      if (t >= 1) {
        this.scene.onBeforeRenderObservable.remove(this.flyObserver!);
        this.flyObserver = null;
        this.isAnimating = false;
      }
    });

    this.isAnimating = true;
    this.scene.beginDirectAnimation(this.camera, [posAnim], 0, totalFrames, false, 1, () => {
      this.isAnimating = false;
    });
  }

  /**
   * XR: move sceneRoot so the target ends up at the camera's look-at point.
   * Camera must not be moved in XR (headset controls it).
   */
  private flyToViaSceneRoot(
    targetWorldPos: BABYLON.Vector3,
    labelStandoff: number | false = false,
  ): void {
    this.scene.stopAnimation(this.sceneRoot);

    const localPos = targetWorldPos.subtract(this.sceneRoot.position);

    // In XR, camera.target is not a reliable gaze point. Use active camera world
    // position + forward direction to derive a stable focus point in front of the user.
    const activeCamera = this.scene.activeCamera || this.camera;
    const activeGlobal = (activeCamera as any).globalPosition as BABYLON.Vector3 | undefined;
    const cameraWorldPos = (activeGlobal && Number.isFinite(activeGlobal.x))
      ? activeGlobal.clone()
      : activeCamera.position.clone();

    let forward = activeCamera.getForwardRay(1).direction;
    if (!Number.isFinite(forward.length()) || forward.lengthSquared() < 0.000001) {
      forward = this.camera.target.subtract(this.camera.position);
    }
    forward = forward.normalize();

    const focusDistance = labelStandoff !== false
      ? Math.max(8, labelStandoff as number)
      : 4.5;
    const desiredTargetWorld = cameraWorldPos.add(forward.scale(focusDistance));
    const targetSceneRootPosition = desiredTargetWorld.subtract(localPos);

    this.logXRNavigationDebug('flyToViaSceneRoot:computed', {
      targetWorldPos: this.formatDebugVector(targetWorldPos),
      sceneRootStart: this.formatDebugVector(this.sceneRoot.position),
      localPos: this.formatDebugVector(localPos),
      cameraWorldPos: this.formatDebugVector(cameraWorldPos),
      cameraForward: this.formatDebugVector(forward),
      desiredTargetWorld: this.formatDebugVector(desiredTargetWorld),
      sceneRootDestination: this.formatDebugVector(targetSceneRootPosition),
      focusDistance,
    });

    const fps = SceneConfig.FLY_TO_ANIMATION_FPS;
    const totalFrames = (SceneConfig.FLY_TO_ANIMATION_TIME_MS / 1000) * fps;

    const posAnim = new BABYLON.Animation('srFlyPos', 'position', fps, BABYLON.Animation.ANIMATIONTYPE_VECTOR3);
    const startPos = this.sceneRoot.position.clone();
    const keys: { frame: number; value: BABYLON.Vector3 }[] = [];

    for (let i = 0; i <= totalFrames; i++) {
      const t = i / totalFrames;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      keys.push({ frame: i, value: BABYLON.Vector3.Lerp(startPos, targetSceneRootPosition, e) });
    }
    posAnim.setKeys(keys);

    this.isAnimating = true;
    this.scene.beginDirectAnimation(this.sceneRoot, [posAnim], 0, totalFrames, false, 1, () => {
      this.logXRNavigationDebug('flyToViaSceneRoot:complete', {
        sceneRootEnd: this.formatDebugVector(this.sceneRoot.position),
        expectedSceneRoot: this.formatDebugVector(targetSceneRootPosition),
        targetWorldPos: this.formatDebugVector(targetWorldPos),
      });
      this.isAnimating = false;
    });

    setTimeout(() => { this.isAnimating = false; }, SceneConfig.FLY_TO_ANIMATION_TIME_MS + 200);
  }

  /**
   * Slide view to show a specific face of the cube, positioning orthogonally to that face.
   * Desktop: moves camera. XR: moves sceneRoot.
   */
  private slideFaceView(cubePosition: BABYLON.Vector3, faceNormal: BABYLON.Vector3, targetMesh?: BABYLON.AbstractMesh): void {
    this.currentFaceNormal = faceNormal.clone();

    if (!this.isInXR()) {
      // Desktop: animate camera to sit orthogonally in front of the face.
      this.flyToViaCamera(cubePosition, targetMesh, false, faceNormal);
      return;
    }

    // XR: move sceneRoot so the world face ends up in front of the headset.
    this.scene.stopAnimation(this.sceneRoot);

    const cameraPosition = SceneConfig.CAMERA_POSITION;
    const radius = targetMesh?.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
    const viewDistance = Math.max(8, radius + 8);
    const faceOffset = faceNormal.normalize().scale(viewDistance);
    const targetSceneRootPosition = cameraPosition.subtract(cubePosition.add(faceOffset));

    const fps = SceneConfig.FLY_TO_ANIMATION_FPS;
    const totalFrames = (300 / 1000) * fps;
    const slideAnimation = new BABYLON.Animation(
      'slidePosition', 'position', fps, BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
    );
    const startPos = this.sceneRoot.position.clone();
    const keys = [];
    for (let i = 0; i <= totalFrames; i++) {
      const t = i / totalFrames;
      const easeT = 1 - Math.pow(1 - t, 3);
      keys.push({ frame: i, value: BABYLON.Vector3.Lerp(startPos, targetSceneRootPosition, easeT) });
    }
    slideAnimation.setKeys(keys);
    this.isAnimating = true;
    this.scene.beginDirectAnimation(this.sceneRoot, [slideAnimation], 0, totalFrames, false, 1, () => {
      this.isAnimating = false;
    });
    setTimeout(() => { this.isAnimating = false; }, 600);
  }

  private calculateIndegree(edges: Array<{ from: string; to: string }>): Map<string, number> {
    const indegreeMap = new Map<string, number>();
    for (const edge of edges) {
      indegreeMap.set(edge.to, (indegreeMap.get(edge.to) || 0) + 1);
    }
    return indegreeMap;
  }

  /**
   * Calculate bounding box dimensions for a group of nodes in world coordinates
   */
  /**
   * Apply repulsive forces between file boxes to prevent intersections
   */
  private applyFileBoxRepulsion(layout: ForceDirectedLayout | null): void {
    if (!layout) return;

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = layout.getNodes();
    const minSeparationPadding = 28.0;

    // Check all pairs of files for intersection
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const file1 = files[i];
        const file2 = files[j];

        const node1 = fileNodes.get(file1);
        const node2 = fileNodes.get(file2);
        if (!node1 || !node2) continue;

        const box1 = this.fileBoxMeshes.get(file1);
        const box2 = this.fileBoxMeshes.get(file2);
        if (!box1 || !box2) continue;

        // Use per-axis half extents so resized (non-uniform) file boxes are separated accurately.
        const half1 = {
          x: box1.scaling.x / 2,
          y: box1.scaling.y / 2,
          z: box1.scaling.z / 2
        };
        const half2 = {
          x: box2.scaling.x / 2,
          y: box2.scaling.y / 2,
          z: box2.scaling.z / 2
        };

        const dx = node2.position.x - node1.position.x;
        const dy = node2.position.y - node1.position.y;
        const dz = node2.position.z - node1.position.z;

        const reqX = half1.x + half2.x + minSeparationPadding;
        const reqY = half1.y + half2.y + minSeparationPadding;
        const reqZ = half1.z + half2.z + minSeparationPadding;

        const overlapX = reqX - Math.abs(dx);
        const overlapY = reqY - Math.abs(dy);
        const overlapZ = reqZ - Math.abs(dz);

        // Collision only if overlaps exist on all three axes.
        if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
          // Push along the axis with smallest penetration to resolve quickly and stably.
          let axis: 'x' | 'y' | 'z' = 'x';
          let penetration = overlapX;
          if (overlapY < penetration) {
            axis = 'y';
            penetration = overlapY;
          }
          if (overlapZ < penetration) {
            axis = 'z';
            penetration = overlapZ;
          }

          const sign = axis === 'x'
            ? (dx >= 0 ? 1 : -1)
            : axis === 'y'
              ? (dy >= 0 ? 1 : -1)
              : (dz >= 0 ? 1 : -1);

          const correction = (penetration / 2) + 0.5;
          const repulsionStrength = Math.max(500, penetration * 40);

          if (axis === 'x') {
            node1.position.x -= sign * correction;
            node2.position.x += sign * correction;
            node1.velocity.x -= sign * repulsionStrength;
            node2.velocity.x += sign * repulsionStrength;
          } else if (axis === 'y') {
            node1.position.y -= sign * correction;
            node2.position.y += sign * correction;
            node1.velocity.y -= sign * repulsionStrength;
            node2.velocity.y += sign * repulsionStrength;
          } else {
            node1.position.z -= sign * correction;
            node2.position.z += sign * correction;
            node1.velocity.z -= sign * repulsionStrength;
            node2.velocity.z += sign * repulsionStrength;
          }

          if (this.physicsIterationCount < 3) {
            console.log(`  🔄 Collision: ${file1} <-> ${file2} axis=${axis} penetration=${penetration.toFixed(1)}`);
          }
        }
      }
    }
  }

  /**
   * Perform deterministic overlap separation for file boxes.
   * Used both before physics starts and during physics updates.
   */
  private resolveInitialFileBoxOverlaps(maxPasses: number = 10): void {
    if (!this.fileLayout) {
      return;
    }

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = this.fileLayout.getNodes();
    const padding = 28.0;

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const file1 = files[i];
          const file2 = files[j];

          const node1 = fileNodes.get(file1);
          const node2 = fileNodes.get(file2);
          const box1 = this.fileBoxMeshes.get(file1);
          const box2 = this.fileBoxMeshes.get(file2);
          if (!node1 || !node2 || !box1 || !box2) {
            continue;
          }

          const half1 = {
            x: box1.scaling.x / 2,
            y: box1.scaling.y / 2,
            z: box1.scaling.z / 2
          };
          const half2 = {
            x: box2.scaling.x / 2,
            y: box2.scaling.y / 2,
            z: box2.scaling.z / 2
          };

          const dx = node2.position.x - node1.position.x;
          const dy = node2.position.y - node1.position.y;
          const dz = node2.position.z - node1.position.z;

          const overlapX = (half1.x + half2.x + padding) - Math.abs(dx);
          const overlapY = (half1.y + half2.y + padding) - Math.abs(dy);
          const overlapZ = (half1.z + half2.z + padding) - Math.abs(dz);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            let axis: 'x' | 'y' | 'z' = 'x';
            let penetration = overlapX;
            if (overlapY < penetration) {
              axis = 'y';
              penetration = overlapY;
            }
            if (overlapZ < penetration) {
              axis = 'z';
              penetration = overlapZ;
            }

            const sign = axis === 'x'
              ? (dx >= 0 ? 1 : -1)
              : axis === 'y'
                ? (dy >= 0 ? 1 : -1)
                : (dz >= 0 ? 1 : -1);

            const correction = (penetration / 2) + 0.5;
            if (axis === 'x') {
              node1.position.x -= sign * correction;
              node2.position.x += sign * correction;
            } else if (axis === 'y') {
              node1.position.y -= sign * correction;
              node2.position.y += sign * correction;
            } else {
              node1.position.z -= sign * correction;
              node2.position.z += sign * correction;
            }
            movedAny = true;
          }
        }
      }

      if (!movedAny) {
        break;
      }
    }

    // Sync corrected positions back to file box meshes.
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = fileNodes.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  /**
   * Enforce a strict minimum surface gap between all file boxes.
   * Gap is measured using bounding spheres around each (possibly non-uniform) box.
   */
  private enforceMinimumFileBoxGap(minGap: number, maxPasses: number = 6): void {
    if (!this.fileLayout) {
      return;
    }

    const files = Array.from(this.fileNodeIds.keys());
    const fileNodes = this.fileLayout.getNodes();

    for (let pass = 0; pass < maxPasses; pass++) {
      let movedAny = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const file1 = files[i];
          const file2 = files[j];
          const node1 = fileNodes.get(file1);
          const node2 = fileNodes.get(file2);
          const box1 = this.fileBoxMeshes.get(file1);
          const box2 = this.fileBoxMeshes.get(file2);
          if (!node1 || !node2 || !box1 || !box2) {
            continue;
          }

          const radius1 = Math.sqrt(
            (box1.scaling.x * 0.5) ** 2 +
            (box1.scaling.y * 0.5) ** 2 +
            (box1.scaling.z * 0.5) ** 2
          );
          const radius2 = Math.sqrt(
            (box2.scaling.x * 0.5) ** 2 +
            (box2.scaling.y * 0.5) ** 2 +
            (box2.scaling.z * 0.5) ** 2
          );

          const dx = node2.position.x - node1.position.x;
          const dy = node2.position.y - node1.position.y;
          const dz = node2.position.z - node1.position.z;
          let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          let dirX = 0;
          let dirY = 0;
          let dirZ = 0;
          if (distance < 0.0001) {
            // Deterministic fallback for coincident centers.
            const fallbackX = ((i + 1) % 3) - 1;
            const fallbackY = ((j + 2) % 3) - 1;
            const fallbackZ = 1;
            const fallbackLen = Math.sqrt(fallbackX * fallbackX + fallbackY * fallbackY + fallbackZ * fallbackZ);
            dirX = fallbackX / fallbackLen;
            dirY = fallbackY / fallbackLen;
            dirZ = fallbackZ / fallbackLen;
            distance = 0.0001;
          } else {
            dirX = dx / distance;
            dirY = dy / distance;
            dirZ = dz / distance;
          }

          const requiredCenterDistance = radius1 + radius2 + minGap;
          if (distance < requiredCenterDistance) {
            const deficit = requiredCenterDistance - distance;
            const correction = (deficit / 2) + 0.1;

            node1.position.x -= dirX * correction;
            node1.position.y -= dirY * correction;
            node1.position.z -= dirZ * correction;

            node2.position.x += dirX * correction;
            node2.position.y += dirY * correction;
            node2.position.z += dirZ * correction;

            movedAny = true;
          }
        }
      }

      if (!movedAny) {
        break;
      }
    }

    // Sync corrected positions back onto meshes.
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = fileNodes.get(file);
      if (!fileNode) {
        continue;
      }
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  /**
   * Recenter each file's internal layout so local node coordinates are centered
   * around (0,0,0), which keeps file boxes naturally containing their children.
   */
  private recenterInternalLayouts(): void {
    // Target local half-extent: children should fit within ±TARGET of the unit box (±0.5 local).
    // This prevents world positions from exploding when parent scaling is applied.
    const TARGET_LOCAL_HALF_EXTENT = 0.46;

    for (const internalLayout of this.fileInternalLayouts.values()) {
      const nodes = Array.from(internalLayout.getNodes().values());
      if (nodes.length === 0) {
        continue;
      }

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        maxX = Math.max(maxX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxY = Math.max(maxY, node.position.y);
        minZ = Math.min(minZ, node.position.z);
        maxZ = Math.max(maxZ, node.position.z);
      }

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;

      for (const node of nodes) {
        node.position.x -= centerX;
        node.position.y -= centerY;
        node.position.z -= centerZ;
      }

      // Normalize positions so the max extent equals TARGET_LOCAL_HALF_EXTENT.
      // ForceDirectedLayout seeds positions at 5-20% of SPACE_SIZE (up to ±30 for internal
      // layouts), so without normalization child world positions = scaling * 30 = 600+, which
      // makes the scene span thousands of world units and renders nodes as sub-pixel dots.
      let maxExtent = 0;
      for (const node of nodes) {
        maxExtent = Math.max(
          maxExtent,
          Math.abs(node.position.x),
          Math.abs(node.position.y),
          Math.abs(node.position.z)
        );
      }
      if (maxExtent > 0.001) {
        const normScale = TARGET_LOCAL_HALF_EXTENT / maxExtent;
        for (const node of nodes) {
          node.position.x *= normScale;
          node.position.y *= normScale;
          node.position.z *= normScale;
        }
      }
    }
  }

  /**
   * Clamp child node meshes so they remain fully contained in their file box.
   */
  public clampNodesInsideFileBoxes(): void {
    for (const fileBox of this.fileBoxMeshes.values()) {
      if (fileBox.scaling.x <= 0 || fileBox.scaling.y <= 0 || fileBox.scaling.z <= 0) {
        continue;
      }

      fileBox.computeWorldMatrix(true);
      const localHalfExtent = 0.5;

      for (const child of fileBox.getChildren()) {
        const mesh = child as BABYLON.Mesh;
        if (!mesh.getBoundingInfo) {
          continue;
        }

        // Exported function nodes are intentionally placed on/outside faces.
        // Do not clamp them back inside the file box volume.
        const nodeData = (mesh as any).nodeData as GraphNode | undefined;
        if (nodeData?.isExported) {
          continue;
        }

        mesh.computeWorldMatrix(true);
        const radiusWorld = mesh.getBoundingInfo().boundingSphere.radiusWorld;
        const parentMaxScale = Math.max(fileBox.scaling.x, fileBox.scaling.y, fileBox.scaling.z);
        const radiusLocal = (radiusWorld / Math.max(parentMaxScale, 0.0001)) + 0.01;
        const maxOffset = Math.max(0, localHalfExtent - radiusLocal);

        mesh.position.x = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.x));
        mesh.position.y = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.y));
        mesh.position.z = Math.max(-maxOffset, Math.min(maxOffset, mesh.position.z));
      }
    }
  }

  /**
   * Push sibling in-file nodes apart in local X/Z space so vertical edges
   * (top/bottom entry) have clear lanes and don't clip neighboring boxes.
   */
  private enforceInFileNodeClearance(maxPasses: number = 6): void {
    const routePaddingWorld = 2.4;

    for (const fileBox of this.fileBoxMeshes.values()) {
      const children = fileBox.getChildren()
        .map((child) => child as BABYLON.Mesh)
        .filter((mesh) => {
          const nodeData = (mesh as any).nodeData as GraphNode | undefined;
          return !!nodeData && !nodeData.isExported && !!mesh.getBoundingInfo;
        });

      if (children.length < 2) {
        continue;
      }

      const parentMaxScale = Math.max(fileBox.scaling.x, fileBox.scaling.y, fileBox.scaling.z, 0.0001);
      const routePaddingLocal = routePaddingWorld / parentMaxScale;

      for (let pass = 0; pass < maxPasses; pass++) {
        let movedAny = false;

        for (let i = 0; i < children.length; i++) {
          for (let j = i + 1; j < children.length; j++) {
            const a = children[i];
            const b = children[j];

            const aRadiusLocal = (a.getBoundingInfo().boundingSphere.radiusWorld / parentMaxScale) + routePaddingLocal;
            const bRadiusLocal = (b.getBoundingInfo().boundingSphere.radiusWorld / parentMaxScale) + routePaddingLocal;
            const minLaneDistance = aRadiusLocal + bRadiusLocal;

            const dx = b.position.x - a.position.x;
            const dz = b.position.z - a.position.z;
            let laneDistance = Math.sqrt((dx * dx) + (dz * dz));

            if (laneDistance >= minLaneDistance) {
              continue;
            }

            let dirX = 0;
            let dirZ = 0;
            if (laneDistance < 0.0001) {
              dirX = ((i + 1) % 2 === 0) ? 1 : -1;
              dirZ = ((j + 1) % 2 === 0) ? -1 : 1;
              const len = Math.sqrt((dirX * dirX) + (dirZ * dirZ));
              dirX /= len;
              dirZ /= len;
              laneDistance = 0.0001;
            } else {
              dirX = dx / laneDistance;
              dirZ = dz / laneDistance;
            }

            const correction = ((minLaneDistance - laneDistance) * 0.5) + 0.01;
            a.position.x -= dirX * correction;
            a.position.z -= dirZ * correction;
            b.position.x += dirX * correction;
            b.position.z += dirZ * correction;
            movedAny = true;
          }
        }

        if (!movedAny) {
          break;
        }
      }
    }
  }

  /**
   * Create wireframe boxes to outline each file's containing region
   * Sizes are calculated from actual laid-out node positions
   */
  private renderFileBoxes(): void {
    for (const file of this.fileNodeIds.keys()) {
      // Skip external modules
      if (file === 'external') continue;

      // Skip files with no parsed nodes — they would create empty boxes with no content.
      if (this.fileNodeIds.get(file)!.size === 0) continue;
      
      // Seed size before per-axis autosizing runs.
      const boxSize = 20.0;
      
      // Create a wireframe box for this file
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `filebox_${file}`,
        { size: 1 },
        this.scene
      );

      // Unit box uses scaling for dimensions; autosize updates this per-axis.
      boxMesh.scaling = new BABYLON.Vector3(boxSize, boxSize, boxSize);
      
      // Get file color and create transparent glass material
      const fileColor = this.getFileColor(file);
      const material = new BABYLON.StandardMaterial(`fileboxmat_${file}`, this.scene);
      // Tint the glass with the file's unique colour at medium intensity
      material.diffuseColor = new BABYLON.Color3(
        fileColor.r * 0.6,
        fileColor.g * 0.6,
        fileColor.b * 0.6
      );
      // Self-illumination so the tint is visible even without direct lighting
      material.emissiveColor = new BABYLON.Color3(
        fileColor.r * 0.28,
        fileColor.g * 0.28,
        fileColor.b * 0.28
      );
      // Strong specular highlight for a glassy look
      material.specularColor = new BABYLON.Color3(1, 1, 1);
      material.specularPower = 128;
      // Cull inner faces to reduce overlapping transparent surfaces and flicker.
      material.backFaceCulling = true;
      material.alpha = 0.18;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.needDepthPrePass = true;
      // Disable depth write so edges render on top of transparent faces
      material.disableDepthWrite = true;
      // Use refraction-style index of refraction for glass feel
      material.indexOfRefraction = 1.5;
      material.wireframe = false;
      
      boxMesh.material = material;
      boxMesh.enableEdgesRendering();
      // Keep edge color strong so structure remains readable when faces are transparent
      boxMesh.edgesColor = new BABYLON.Color4(
        Math.min(1, fileColor.r * 0.75 + 0.2),
        Math.min(1, fileColor.g * 0.75 + 0.2),
        Math.min(1, fileColor.b * 0.75 + 0.2),
        1.0
      );
      boxMesh.edgesWidth = SceneConfig.FILE_BOX_EDGE_WIDTH;
      boxMesh.parent = this.sceneRoot;
      
      // Initially position at origin, will be updated by physics loop
      boxMesh.position = BABYLON.Vector3.Zero();
      
      // Store reference for updates
      this.fileBoxMeshes.set(file, boxMesh);

      // Hover tooltip for file box – shows file name when not hovering a function
      const originalEmissive = material.emissiveColor.clone();
      boxMesh.actionManager = new BABYLON.ActionManager(this.scene);
      boxMesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
          material.emissiveColor = new BABYLON.Color3(
            fileColor.r * 0.5,
            fileColor.g * 0.5,
            fileColor.b * 0.5
          );
        })
      );
      boxMesh.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
          material.emissiveColor = originalEmissive.clone();
        })
      );

      // Add a readable file-name plaque on each file box.
      this.createFileBoxLabel(file, boxMesh);
    }
  }

  /**
   * Create nested directory boxes that mirror file-system hierarchy and
   * enclose file boxes under each directory.
   */
  private renderDirectoryBoxes(): void {
    for (const mesh of this.directoryBoxMeshes.values()) {
      mesh.dispose();
    }
    this.directoryBoxMeshes.clear();

    const filePaths = Array.from(this.fileBoxMeshes.keys())
      .filter((f) => f !== 'external')
      .map((f) => toProjectRelativePath(f));

    const directories = new Set<string>();
    for (const filePath of filePaths) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        directories.add(parts.slice(0, i).join('/'));
      }
    }

    if (directories.size === 0) {
      return;
    }

    // Create meshes first.
    for (const dir of directories) {
      const boxMesh = BABYLON.MeshBuilder.CreateBox(
        `dirbox_${dir}`,
        { size: 1 },
        this.scene
      );

      const dirColor = this.getFileColor(dir);
      const material = new BABYLON.StandardMaterial(`dirboxmat_${dir}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(dirColor.r * 0.5, dirColor.g * 0.5, dirColor.b * 0.5);
      material.emissiveColor = new BABYLON.Color3(dirColor.r * 0.2, dirColor.g * 0.2, dirColor.b * 0.2);
      material.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
      material.specularPower = 64;
      material.backFaceCulling = true;
      material.alpha = 0.08;
      material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      material.needDepthPrePass = true;

      boxMesh.material = material;
      boxMesh.enableEdgesRendering();
      boxMesh.edgesColor = new BABYLON.Color4(
        Math.min(1, dirColor.r * 0.75 + 0.2),
        Math.min(1, dirColor.g * 0.75 + 0.2),
        Math.min(1, dirColor.b * 0.75 + 0.2),
        1.0
      );
      boxMesh.edgesWidth = Math.max(2, SceneConfig.FILE_BOX_EDGE_WIDTH - 1);
      boxMesh.parent = this.sceneRoot;
      boxMesh.isPickable = true;
      boxMesh.scaling = new BABYLON.Vector3(1, 1, 1);
      boxMesh.position = BABYLON.Vector3.Zero();

      this.directoryBoxMeshes.set(dir, boxMesh);
    }

    // Size and position bottom-up so parent directories include child directories.
    const sortedDirs = Array.from(directories).sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      return depthB - depthA;
    });

    const directoryPadding = 10.0;
    for (const dir of sortedDirs) {
      const dirMesh = this.directoryBoxMeshes.get(dir);
      if (!dirMesh) continue;

      const childMeshes: BABYLON.Mesh[] = [];

      // Direct file children.
      for (const [filePath, fileMesh] of this.fileBoxMeshes.entries()) {
        if (filePath === 'external') continue;
        const fileDir = getDirectoryPath(filePath);
        if (normalizePath(fileDir) === dir) {
          childMeshes.push(fileMesh);
        }
      }

      // Direct directory children.
      for (const [childDir, childMesh] of this.directoryBoxMeshes.entries()) {
        if (childDir === dir) continue;
        if (getParentDirectoryPath(childDir) === dir) {
          childMeshes.push(childMesh);
        }
      }

      if (childMeshes.length === 0) {
        continue;
      }

      let minX = Infinity; let minY = Infinity; let minZ = Infinity;
      let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;

      for (const child of childMeshes) {
        child.computeWorldMatrix(true);
        const bounds = child.getBoundingInfo().boundingBox;
        minX = Math.min(minX, bounds.minimumWorld.x);
        minY = Math.min(minY, bounds.minimumWorld.y);
        minZ = Math.min(minZ, bounds.minimumWorld.z);
        maxX = Math.max(maxX, bounds.maximumWorld.x);
        maxY = Math.max(maxY, bounds.maximumWorld.y);
        maxZ = Math.max(maxZ, bounds.maximumWorld.z);
      }

      minX -= directoryPadding;
      minY -= directoryPadding;
      minZ -= directoryPadding;
      maxX += directoryPadding;
      maxY += directoryPadding;
      maxZ += directoryPadding;

      dirMesh.scaling = new BABYLON.Vector3(
        Math.max(1, maxX - minX),
        Math.max(1, maxY - minY),
        Math.max(1, maxZ - minZ)
      );
      dirMesh.position = new BABYLON.Vector3(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5
      );

      this.createDirectoryBoxLabel(dir, dirMesh);
    }
  }

  /**
   * Create a label plaque for a directory box.
   */
  private buildBreadcrumbSegments(
    kind: 'file' | 'directory',
    fullPath: string,
  ): Array<{ text: string; kind: 'file' | 'directory'; path: string }> {
    const normalized = (fullPath || '').replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const segments: Array<{ text: string; kind: 'file' | 'directory'; path: string }> = [];

    let runningPath = '';
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      runningPath = runningPath ? `${runningPath}/${part}` : part;
      const isLast = index === parts.length - 1;
      segments.push({
        text: part,
        kind: kind === 'file' && isLast ? 'file' : 'directory',
        path: runningPath,
      });
    }

    if (segments.length === 0) {
      segments.push({ text: kind === 'directory' ? 'root' : fullPath, kind, path: fullPath });
    }

    return segments;
  }

  private createLabelChip(
    name: string,
    text: string,
    fillStyle: string,
    strokeStyle: string,
    textStyle: string,
  ): { mesh: BABYLON.Mesh; width: number; height: number } {
    const fontSize = 440;
    const horizontalPadding = 220;
    const textureHeight = 720;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d') as CanvasRenderingContext2D;
    measureCtx.font = `bold ${fontSize}px monospace`;
    const textWidth = measureCtx.measureText(text).width;
    const textureWidth = Math.max(980, Math.ceil(textWidth + (horizontalPadding * 2)));

    const texture = new BABYLON.DynamicTexture(
      `${name}_texture`,
      { width: textureWidth, height: textureHeight },
      this.scene,
      false,
    );
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, textureWidth, textureHeight);
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, textureWidth, textureHeight);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, textureWidth - 16, textureHeight - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textStyle;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillText(text, textureWidth / 2, textureHeight / 2 + 2);
    texture.update();

    const worldHeight = 9.6;
    const worldWidth = Math.max(17.0, worldHeight * (textureWidth / textureHeight));
    const mesh = BABYLON.MeshBuilder.CreatePlane(
      name,
      { width: worldWidth, height: worldHeight },
      this.scene,
    );
    const material = new BABYLON.StandardMaterial(`${name}_material`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.depthFunction = BABYLON.Constants.ALWAYS;
    mesh.material = material;
    mesh.renderingGroupId = 3;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.outlineColor = new BABYLON.Color3(0.95, 0.98, 1.0);
    mesh.outlineWidth = 0.16;

    const baseScaling = mesh.scaling.clone();
    mesh.actionManager = new BABYLON.ActionManager(this.scene);
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        mesh.renderOutline = true;
        material.emissiveColor = new BABYLON.Color3(1.2, 1.2, 1.2);
        mesh.scaling = baseScaling.scale(1.08);
      })
    );
    mesh.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        mesh.renderOutline = false;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mesh.scaling = baseScaling.clone();
      })
    );

    return { mesh, width: worldWidth, height: worldHeight };
  }

  private withAdjustedAlpha(style: string, alpha: number): string {
    const rgbaMatch = style.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i);
    if (!rgbaMatch) {
      return style;
    }

    const [, r, g, b] = rgbaMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private createBreadcrumbLabelAnchor(
    name: string,
    segments: Array<{ text: string; kind: 'file' | 'directory'; path: string }>,
    fillStyle: string,
    strokeStyle: string,
    textStyle: string,
  ): BABYLON.Mesh {
    const anchor = BABYLON.MeshBuilder.CreatePlane(
      `${name}_anchor`,
      { width: 1, height: 1 },
      this.scene,
    );
    anchor.visibility = 0;
    anchor.isPickable = false;
    anchor.parent = this.sceneRoot;
    anchor.scaling = new BABYLON.Vector3(1, 1, 1);
    anchor.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    anchor.renderingGroupId = 3;
    anchor.alwaysSelectAsActiveMesh = true;
    anchor.setEnabled(this.labelsVisible);

    const horizontalGap = 1.4;
    const verticalGap = 1.15;
    const maxRowWidth = 52;
    const rowHeight = 4.8;
    const rows: Array<Array<{ mesh: BABYLON.Mesh; width: number }>> = [];
    let currentRow: Array<{ mesh: BABYLON.Mesh; width: number }> = [];
    let currentRowWidth = 0;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const isCurrentSegment = index === segments.length - 1;
      const chipFill = this.withAdjustedAlpha(fillStyle, isCurrentSegment ? 0.96 : 0.56);
      const chipStroke = this.withAdjustedAlpha(strokeStyle, isCurrentSegment ? 1.0 : 0.72);
      const chipText = isCurrentSegment ? textStyle : 'rgba(232, 238, 244, 0.82)';
      const chip = this.createLabelChip(`${name}_chip_${index}`, segment.text, chipFill, chipStroke, chipText);
      chip.mesh.parent = anchor;
      chip.mesh.isPickable = this.labelsVisible;
      (chip.mesh as any).labelData = { kind: segment.kind, path: segment.path };

      const widthWithGap = currentRow.length === 0 ? chip.width : chip.width + horizontalGap;
      if (currentRow.length > 0 && (currentRowWidth + widthWithGap) > maxRowWidth) {
        rows.push(currentRow);
        currentRow = [];
        currentRowWidth = 0;
      }

      currentRow.push({ mesh: chip.mesh, width: chip.width });
      currentRowWidth += currentRow.length === 1 ? chip.width : chip.width + horizontalGap;
    }

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    const totalHeight = (rows.length * rowHeight) + (Math.max(0, rows.length - 1) * verticalGap);
    rows.forEach((row, rowIndex) => {
      const rowWidth = row.reduce((sum, chip, chipIndex) => sum + chip.width + (chipIndex > 0 ? horizontalGap : 0), 0);
      let cursorX = -rowWidth * 0.5;
      const y = (totalHeight * 0.5) - (rowIndex * (rowHeight + verticalGap)) - (rowHeight * 0.5);

      row.forEach((chip) => {
        chip.mesh.position.x = cursorX + (chip.width * 0.5);
        chip.mesh.position.y = y;
        chip.mesh.position.z = 0;
        cursorX += chip.width + horizontalGap;
      });
    });

    return anchor;
  }

  private findExactNavigationLabelTarget(kind: 'file' | 'directory', path: string): BABYLON.Mesh | null {
    const normalized = toProjectRelativePath(path) || path;
    if (!normalized) {
      return kind === 'directory' ? (this.directoryLabelLookup.get('root') || null) : null;
    }

    if (kind === 'file') {
      const fileTarget = this.fileLabelLookup.get(normalized);
      if (fileTarget) {
        return fileTarget;
      }

      for (const [filePath, label] of this.fileBoxLabels.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) {
          return label;
        }
      }

      return null;
    }

    const directoryTarget = this.directoryLabelLookup.get(normalized);
    if (directoryTarget) {
      return directoryTarget;
    }

    for (const [directoryPath, label] of this.directoryBoxLabels.entries()) {
      if ((toProjectRelativePath(directoryPath) || directoryPath) === normalized) {
        return label;
      }
    }

    return null;
  }

  private resolveBreadcrumbNavigationTarget(
    kind: 'file' | 'directory',
    path: string,
    fallbackMesh: BABYLON.AbstractMesh,
  ): BABYLON.AbstractMesh {
    const exactLabelTarget = this.findExactNavigationLabelTarget(kind, path);
    if (exactLabelTarget) {
      return exactLabelTarget;
    }

    const normalized = toProjectRelativePath(path) || path;
    if (kind === 'file') {
      for (const [filePath, mesh] of this.fileBoxMeshes.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) {
          return mesh;
        }
      }
    } else {
      for (const [directoryPath, mesh] of this.directoryBoxMeshes.entries()) {
        if ((toProjectRelativePath(directoryPath) || directoryPath) === normalized) {
          return mesh;
        }
      }
    }

    return this.findNavigationLabelTarget(kind, path) || fallbackMesh;
  }

  private findNavigationLabelTarget(kind: 'file' | 'directory', path: string): BABYLON.Mesh | null {
    const normalized = toProjectRelativePath(path) || path;
    if (kind === 'file') {
      const fileTarget = this.fileLabelLookup.get(normalized);
      if (fileTarget) {
        return fileTarget;
      }

      for (const [filePath, label] of this.fileBoxLabels.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) {
          return label;
        }
      }

      for (const [filePath, mesh] of this.fileBoxMeshes.entries()) {
        if ((toProjectRelativePath(filePath) || filePath) === normalized) {
          return mesh;
        }
      }
    }

    let currentPath = normalized;
    while (currentPath) {
      const directoryTarget = this.directoryLabelLookup.get(currentPath);
      if (directoryTarget) {
        return directoryTarget;
      }

      for (const [directoryPath, label] of this.directoryBoxLabels.entries()) {
        if ((toProjectRelativePath(directoryPath) || directoryPath) === currentPath) {
          return label;
        }
      }

      for (const [directoryPath, mesh] of this.directoryBoxMeshes.entries()) {
        if ((toProjectRelativePath(directoryPath) || directoryPath) === currentPath) {
          return mesh;
        }
      }

      const slashIndex = currentPath.lastIndexOf('/');
      currentPath = slashIndex >= 0 ? currentPath.slice(0, slashIndex) : '';
    }

    return null;
  }

  private createDirectoryBoxLabel(directoryPath: string, directoryBox: BABYLON.Mesh): void {
    const dirMat = directoryBox.material as BABYLON.StandardMaterial | null;
    const dirTint = dirMat?.diffuseColor || new BABYLON.Color3(0.10, 0.14, 0.18);
    const dirR = Math.max(0, Math.min(255, Math.floor(dirTint.r * 255)));
    const dirG = Math.max(0, Math.min(255, Math.floor(dirTint.g * 255)));
    const dirB = Math.max(0, Math.min(255, Math.floor(dirTint.b * 255)));

    const displayPath = toProjectRelativePath(directoryPath) || 'root';
    const label = this.createBreadcrumbLabelAnchor(
      `dirlabel_${directoryPath}`,
      this.buildBreadcrumbSegments('directory', displayPath),
      `rgba(${dirR}, ${dirG}, ${dirB}, 0.88)`,
      'rgba(128, 188, 255, 0.95)',
      '#f4fbff',
    );

    this.updateDirectoryBoxLabelTransform(label, directoryBox);
    this.directoryBoxLabels.set(directoryPath, label);
    this.directoryLabelLookup.set(displayPath, label);
  }

  /**
   * Keep directory label offset stable as directory box moves/scales.
   * Label is parented to sceneRoot so position is in sceneRoot-local space.
   */
  private updateDirectoryBoxLabelTransform(label: BABYLON.Mesh, directoryBox: BABYLON.Mesh): void {
    directoryBox.computeWorldMatrix(true);
    const bounds = directoryBox.getBoundingInfo().boundingBox;
    const worldPos = new BABYLON.Vector3(
      bounds.centerWorld.x,
      bounds.maximumWorld.y + 9.2,
      bounds.centerWorld.z
    );
    // Convert world position to sceneRoot-local space.
    this.sceneRoot.computeWorldMatrix(true);
    label.position = BABYLON.Vector3.TransformCoordinates(
      worldPos,
      BABYLON.Matrix.Invert(this.sceneRoot.getWorldMatrix())
    );
  }

  /**
   * Create a label plaque for a file box.
   */
  private createFileBoxLabel(file: string, fileBox: BABYLON.Mesh): void {
    const fileMat = fileBox.material as BABYLON.StandardMaterial | null;
    const fileTint = fileMat?.diffuseColor || new BABYLON.Color3(0.2, 0.2, 0.2);
    const fileR = Math.max(0, Math.min(255, Math.floor(fileTint.r * 255)));
    const fileG = Math.max(0, Math.min(255, Math.floor(fileTint.g * 255)));
    const fileB = Math.max(0, Math.min(255, Math.floor(fileTint.b * 255)));

    const displayPath = toProjectRelativePath(file);
    const label = this.createBreadcrumbLabelAnchor(
      `filelabel_${file}`,
      this.buildBreadcrumbSegments('file', displayPath),
      `rgba(${fileR}, ${fileG}, ${fileB}, 0.84)`,
      'rgba(255, 255, 255, 0.92)',
      '#ffffff',
    );

    this.updateFileBoxLabelTransform(label, fileBox);
    this.fileBoxLabels.set(file, label);
    this.fileLabelLookup.set(displayPath, label);
  }

  /**
   * Keep file label offset stable as file box moves/scales.
   * Label is parented to sceneRoot so position is in sceneRoot-local space.
   */
  private updateFileBoxLabelTransform(label: BABYLON.Mesh, fileBox: BABYLON.Mesh): void {
    fileBox.computeWorldMatrix(true);
    const bounds = fileBox.getBoundingInfo().boundingBox;
    const worldPos = new BABYLON.Vector3(
      bounds.centerWorld.x,
      bounds.maximumWorld.y + 8.1,
      bounds.centerWorld.z
    );
    // Convert world position to sceneRoot-local space.
    this.sceneRoot.computeWorldMatrix(true);
    label.position = BABYLON.Vector3.TransformCoordinates(
      worldPos,
      BABYLON.Matrix.Invert(this.sceneRoot.getWorldMatrix())
    );
  }

  /**
   * Re-anchor labels to their boxes every frame during physics (boxes move each frame).
   * Labels are parented to sceneRoot so positions are tracked independently.
   */
  private refreshLabelTransformsIfScaleChanged(_force: boolean = false): void {
    for (const [file, label] of this.fileBoxLabels.entries()) {
      const fileBox = this.fileBoxMeshes.get(file);
      if (fileBox) {
        this.updateFileBoxLabelTransform(label, fileBox);
      }
    }

    for (const [dir, label] of this.directoryBoxLabels.entries()) {
      const dirBox = this.directoryBoxMeshes.get(dir);
      if (dirBox) {
        this.updateDirectoryBoxLabelTransform(label, dirBox);
      }
    }
  }

  /**
   * Scale labels based on camera distance so they remain readable at range.
   */
  private updateLabelDistanceScaling(): void {
    if (this.fileBoxLabels.size === 0 && this.directoryBoxLabels.size === 0) {
      return;
    }

    // Keep baseline size uniform (1x), but scale up at distance when projected
    // width falls below a readable minimum on-screen fraction.
    const activeCamera = this.scene.activeCamera || this.camera;
    if (!activeCamera) {
      return;
    }

    const activeGlobal = (activeCamera as any).globalPosition as BABYLON.Vector3 | undefined;
    const cameraWorldPos = (activeGlobal && Number.isFinite(activeGlobal.x))
      ? activeGlobal
      : activeCamera.position;

    const renderWidth = Math.max(1, this.engine.getRenderWidth());
    const renderHeight = Math.max(1, this.engine.getRenderHeight());
    const aspect = renderWidth / renderHeight;
    const verticalFov = Math.max(0.25, activeCamera.fov || this.camera.fov || 1.0);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * aspect);

    const fallbackBaseLabelWidth = 36.0;
    const readableMinScale = this.isInXR() ? 1.25 : 1.05;
    const hardMinScale = 0.35;
    const nearDistanceThreshold = this.isInXR() ? 45 : 90;
    const minViewportFraction = this.isInXR() ? 0.27 : 0.20;
    const maxViewportFraction = this.isInXR() ? 0.16 : 0.13;
    const maxScale = this.isInXR() ? 2.1 : 1.8;

    const applyScale = (label: BABYLON.Mesh) => {
      const hierarchyBounds = label.getHierarchyBoundingVectors(true);
      const hierarchyWidth = Math.abs(hierarchyBounds.max.x - hierarchyBounds.min.x);
      const currentScale = Math.max(0.0001, label.scaling.x);
      const baseLabelWidth = Number.isFinite(hierarchyWidth) && hierarchyWidth > 0.001
        ? hierarchyWidth / currentScale
        : fallbackBaseLabelWidth;

      const distance = BABYLON.Vector3.Distance(cameraWorldPos, label.getAbsolutePosition());
      const minAngularWidth = horizontalFov * minViewportFraction;
      const maxAngularWidth = horizontalFov * maxViewportFraction;
      const minWorldWidthAtDistance = 2 * Math.max(0.01, distance) * Math.tan(minAngularWidth * 0.5);
      const maxWorldWidthAtDistance = 2 * Math.max(0.01, distance) * Math.tan(maxAngularWidth * 0.5);
      const floorScale = minWorldWidthAtDistance / baseLabelWidth;
      const viewportCapScale = maxWorldWidthAtDistance / baseLabelWidth;
      const effectiveMinScale = distance < nearDistanceThreshold ? hardMinScale : readableMinScale;

      const desiredScale = Math.max(effectiveMinScale, floorScale);
      // Keep labels readable by default, but never let them overgrow the viewport.
      const scale = Math.max(hardMinScale, Math.min(maxScale, viewportCapScale, desiredScale));
      if (Math.abs(label.scaling.x - scale) > 0.001) {
        label.scaling.copyFromFloats(scale, scale, scale);
      }
    };

    this.labelScaleState.clear();
    for (const label of this.fileBoxLabels.values()) {
      applyScale(label);
    }
    for (const label of this.directoryBoxLabels.values()) {
      applyScale(label);
    }
  }

  /**
   * Calculate file box size from actual node positions
   */
  public calculateFileBoxSize(_file: string, internalLayout: ForceDirectedLayout | undefined): number {
    if (!internalLayout) {
      return 120.0;  // Default size if no layout
    }

    const nodes = internalLayout.getNodes();
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    // Find bounds of all nodes in this file
    for (const node of nodes.values()) {
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y);
      minZ = Math.min(minZ, node.position.z);
      maxZ = Math.max(maxZ, node.position.z);
    }

    // Calculate dimensions
    const width = maxX === -Infinity ? 0 : maxX - minX;
    const height = maxY === -Infinity ? 0 : maxY - minY;
    const depth = maxZ === -Infinity ? 0 : maxZ - minZ;

    // Find max dimension and add padding
    const maxDim = Math.max(width, height, depth);
    const padding = 40.0;  // Extra space around nodes
    const boxSize = Math.max(120.0, maxDim + padding);  // Minimum 120 units

    return boxSize;
  }

  /**
   * Auto-size file boxes to fit their child nodes based on actual mesh bounds
   */
  public autosizeFileBoxes(): void {
    // Node world size as created by MeshFactory (Math.max(3.0, FUNCTION_BOX_SIZE)).
    const nodeWorldSize = Math.max(3.0, SceneConfig.FUNCTION_BOX_SIZE);

    for (const fileBox of this.fileBoxMeshes.values()) {
      const children = fileBox.getChildren().filter(
        c => !c.name?.startsWith('filelabel_') && (c as BABYLON.Mesh).getBoundingInfo
      ) as BABYLON.Mesh[];

      if (children.length === 0) {
        // Empty file box: keep a sensible minimum size.
        const minSize = nodeWorldSize * 8;
        fileBox.scaling = new BABYLON.Vector3(minSize, minSize, minSize);
        continue;
      }

      // ── Step 1: read LOCAL positions (child.position is already in parent-local space) ──
      // Do NOT use world→local inverse-transform because that inherits the current scaling
      // and then re-setting the scaling causes world positions to explode: a circular bug.
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const child of children) {
        minX = Math.min(minX, child.position.x);
        maxX = Math.max(maxX, child.position.x);
        minY = Math.min(minY, child.position.y);
        maxY = Math.max(maxY, child.position.y);
        minZ = Math.min(minZ, child.position.z);
        maxZ = Math.max(maxZ, child.position.z);
      }

      if (!Number.isFinite(minX)) {
        continue;
      }

      // ── Step 2: center children around the file-box local origin ──
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      for (const child of children) {
        child.position.x -= cx;
        child.position.y -= cy;
        child.position.z -= cz;
      }

      // ── Step 3: compute per-axis local extents of children ──
      const currentScaleX = fileBox.scaling.x;
      const currentScaleY = fileBox.scaling.y;
      const currentScaleZ = fileBox.scaling.z;
      let maxLocalExtentX = 0, maxLocalExtentY = 0, maxLocalExtentZ = 0;
      for (const child of children) {
        maxLocalExtentX = Math.max(maxLocalExtentX, Math.abs(child.position.x));
        maxLocalExtentY = Math.max(maxLocalExtentY, Math.abs(child.position.y));
        maxLocalExtentZ = Math.max(maxLocalExtentZ, Math.abs(child.position.z));
      }

      // ── Step 4: compute desired per-axis world scale ──
      // Each axis: scale = (worldHalfExtent + padding) * 2.
      // Dense files (many function nodes) get extra volume to reduce edge clutter.
      const functionCount = children.filter((child) => {
        const node = (child as any).nodeData as GraphNode | undefined;
        return node?.type === 'function';
      }).length;
      const densityBoost = functionCount > 1
        ? Math.min(2.0, 1.0 + (Math.log2(functionCount) * 0.20))
        : 1.0;

      const axisPadding = nodeWorldSize * 8 * densityBoost;
      const minAxisSize = nodeWorldSize * 8 * densityBoost;
      const desiredScaleX = Math.max(minAxisSize, (maxLocalExtentX * currentScaleX + axisPadding) * 2);
      const desiredScaleY = Math.max(minAxisSize, (maxLocalExtentY * currentScaleY + axisPadding) * 2);
      const desiredScaleZ = Math.max(minAxisSize, (maxLocalExtentZ * currentScaleZ + axisPadding) * 2);

      // ── Step 5: rescale LOCAL positions per axis to preserve world positions ──
      // world = scale * local  →  new_local = old_local * (oldScale / newScale)
      for (const child of children) {
        if (desiredScaleX !== currentScaleX) child.position.x *= currentScaleX / desiredScaleX;
        if (desiredScaleY !== currentScaleY) child.position.y *= currentScaleY / desiredScaleY;
        if (desiredScaleZ !== currentScaleZ) child.position.z *= currentScaleZ / desiredScaleZ;
      }

      fileBox.scaling = new BABYLON.Vector3(desiredScaleX, desiredScaleY, desiredScaleZ);

      for (const child of fileBox.getChildren()) {
        const mesh = child as BABYLON.Mesh;
        if (mesh.name?.startsWith('filelabel_')) {
          this.updateFileBoxLabelTransform(mesh, fileBox);
          continue;
        }
        this.applyChildScaleCompensation(mesh, fileBox);
      }
    }
  }

  /**
   * Ensure exported function meshes are children of their file boxes.
   */
  public ensureExportedFunctionsParentedToFileBoxes(): void {
    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node) {
        continue;
      }

      if (node.type !== 'function' || !node.isExported) {
        continue;
      }

      const file = node.file;
      if (!file || file === 'external') {
        continue;
      }

      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) {
        continue;
      }

      // Enforce visibility for exported function meshes.
      mesh.isVisible = true;
      mesh.setEnabled(true);
      mesh.renderOutline = false;
      const meshMaterial = mesh.material as BABYLON.StandardMaterial | null;
      if (meshMaterial) {
        meshMaterial.alpha = 1.0;
        meshMaterial.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
        meshMaterial.disableLighting = true;
        meshMaterial.emissiveColor = new BABYLON.Color3(0.95, 0.95, 1.0);
      }

      if (mesh.parent !== fileBox) {
        // Preserve world transform while switching parent.
        const worldPos = mesh.getAbsolutePosition().clone();
        mesh.parent = fileBox;
        const localPos = BABYLON.Vector3.TransformCoordinates(
          worldPos,
          BABYLON.Matrix.Invert(fileBox.getWorldMatrix())
        );
        mesh.position = localPos;
      }

      // Keep exported function world size stable while parent file box scales.
      this.applyChildScaleCompensation(mesh, fileBox);
    }
  }

  /**
   * For each exported function node, find the face of its parent file box
   * whose centre minimises the total Euclidean distance to all connected nodes
   * in other files, then snap the node's local position to that face centre.
   *
   * The parent file box is a unit cube (local coords −0.5 → +0.5) scaled by
   * fileBox.scaling, so each face centre in LOCAL space is ±0.5 on one axis.
   * World position = fileBox.position + fileBox.scaling ⊙ localPos.
   */
  private placeExportedFunctionsOnOptimalFace(): void {
    // Build a quick lookup: nodeId → world positions of all cross-file neighbours.
    // We use file-box positions as a proxy for neighbours inside the same remote file
    // (the exported function of the target file hasn't been repositioned yet during
    // the same loop, so using the box centre is stable and avoids ordering issues).
    const crossFileNeighbours = new Map<string, BABYLON.Vector3[]>();

    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const from = edgeId.slice(0, arrow);
      const to   = edgeId.slice(arrow + 1);

      const fromFile = this.nodeToFile.get(from);
      const toFile   = this.nodeToFile.get(to);
      if (!fromFile || !toFile || fromFile === toFile) continue;

      // For the `from` side: neighbour world pos is the `to` node mesh world pos
      // (or its file box centre if the mesh is not available).
      const toMesh   = this.nodeMeshMap.get(to);
      const toBox    = this.fileBoxMeshes.get(toFile);
      const toWorld  = toMesh
        ? toMesh.getAbsolutePosition().clone()
        : (toBox ? toBox.position.clone() : null);
      if (toWorld) {
        if (!crossFileNeighbours.has(from)) crossFileNeighbours.set(from, []);
        crossFileNeighbours.get(from)!.push(toWorld);
      }

      // For the `to` side symmetrically.
      const fromMesh  = this.nodeMeshMap.get(from);
      const fromBox   = this.fileBoxMeshes.get(fromFile);
      const fromWorld = fromMesh
        ? fromMesh.getAbsolutePosition().clone()
        : (fromBox ? fromBox.position.clone() : null);
      if (fromWorld) {
        if (!crossFileNeighbours.has(to)) crossFileNeighbours.set(to, []);
        crossFileNeighbours.get(to)!.push(fromWorld);
      }
    }

    // The unit box has face centres at ±0.5 along each local axis.
    const faceCentresLocal: Array<BABYLON.Vector3> = [
      new BABYLON.Vector3( 0.5,  0,    0),
      new BABYLON.Vector3(-0.5,  0,    0),
      new BABYLON.Vector3( 0,    0.5,  0),
      new BABYLON.Vector3( 0,   -0.5,  0),
      new BABYLON.Vector3( 0,    0,    0.5),
      new BABYLON.Vector3( 0,    0,   -0.5),
    ];

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.type !== 'function' || !node.isExported) continue;

      const file = node.file;
      if (!file || file === 'external') continue;

      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) continue;

      const neighbours = crossFileNeighbours.get(nodeId);
      if (!neighbours || neighbours.length === 0) {
        // No cross-file neighbours: still force exported node onto a face.
        // Use the dominant local axis from its current placement.
        const lp = mesh.position;
        const ax = Math.abs(lp.x);
        const ay = Math.abs(lp.y);
        const az = Math.abs(lp.z);

        if (ax >= ay && ax >= az) {
          const sign = lp.x >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'x', sign);
          mesh.position = new BABYLON.Vector3(target, 0, 0);
        } else if (ay >= ax && ay >= az) {
          const sign = lp.y >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'y', sign);
          mesh.position = new BABYLON.Vector3(0, target, 0);
        } else {
          const sign = lp.z >= 0 ? 1 : -1;
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'z', sign);
          mesh.position = new BABYLON.Vector3(0, 0, target);
        }

        this.applyChildScaleCompensation(mesh, fileBox);
        continue;
      }

      // Find the face whose world centre has the smallest sum of distances to
      // all cross-file neighbours.
      let bestLocalPos = faceCentresLocal[0];
      let bestCost     = Infinity;

      for (const localFace of faceCentresLocal) {
        // world = boxPos + scaling ⊙ localPos  (component-wise, no rotation)
        const worldX = fileBox.position.x + fileBox.scaling.x * localFace.x;
        const worldY = fileBox.position.y + fileBox.scaling.y * localFace.y;
        const worldZ = fileBox.position.z + fileBox.scaling.z * localFace.z;

        let cost = 0;
        for (const nb of neighbours) {
          const dx = worldX - nb.x;
          const dy = worldY - nb.y;
          const dz = worldZ - nb.z;
          cost += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        if (cost < bestCost) {
          bestCost     = cost;
          bestLocalPos = localFace;
        }
      }

      // Move the mesh to the best face, protruding outside the file box.
      if (Math.abs(bestLocalPos.x) > 0) {
        const sign = bestLocalPos.x > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'x', sign);
        mesh.position = new BABYLON.Vector3(target, 0, 0);
      } else if (Math.abs(bestLocalPos.y) > 0) {
        const sign = bestLocalPos.y > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'y', sign);
        mesh.position = new BABYLON.Vector3(0, target, 0);
      } else {
        const sign = bestLocalPos.z > 0 ? 1 : -1;
        const target = this.getExportedFaceLocalTarget(fileBox, mesh, 'z', sign);
        mesh.position = new BABYLON.Vector3(0, 0, target);
      }
      this.applyChildScaleCompensation(mesh, fileBox);
    }
  }

  /**
   * Compute the local coordinate for an exported node centre so the node sits
   * just outside a file-box face on the given axis/sign.
   */
  private getExportedFaceLocalTarget(
    fileBox: BABYLON.Mesh,
    mesh: BABYLON.Mesh,
    axis: 'x' | 'y' | 'z',
    sign: number
  ): number {
    const boxScale = axis === 'x'
      ? Math.max(0.0001, fileBox.scaling.x)
      : axis === 'y'
        ? Math.max(0.0001, fileBox.scaling.y)
        : Math.max(0.0001, fileBox.scaling.z);

    const clearance = 0.01;

    // Test doubles may not implement full Babylon bounding APIs.
    if (typeof (mesh as any).getBoundingInfo !== 'function') {
      const exportedBoxSize = Math.max(6.0, SceneConfig.FUNCTION_BOX_SIZE);
      const worldHalf = exportedBoxSize * 0.5;
      const localProtrusion = worldHalf / boxScale;
      return (sign >= 0 ? 1 : -1) * (0.5 + localProtrusion + clearance);
    }

    if (typeof (mesh as any).computeWorldMatrix === 'function') {
      mesh.computeWorldMatrix(true);
    }
    const bbox = mesh.getBoundingInfo().boundingBox;

    const maxWorld = (bbox as any).maximumWorld ?? bbox.maximum;
    const minWorld = (bbox as any).minimumWorld ?? bbox.minimum;
    const worldHalf = axis === 'x'
      ? (maxWorld.x - minWorld.x) * 0.5
      : axis === 'y'
        ? (maxWorld.y - minWorld.y) * 0.5
        : (maxWorld.z - minWorld.z) * 0.5;

    const localProtrusion = worldHalf / boxScale;
    return (sign >= 0 ? 1 : -1) * (0.5 + localProtrusion + clearance);
  }

  /**
   * Push non-endpoint file boxes away from every cross-file edge path so
   * edges do not visually collide with unconnected file boxes.
   *
   * Algorithm (repeated up to `iterations` times):
   *   For each unique cross-file edge (boxA → boxB):
   *     For each other box C (not A or B):
   *       Find the closest point on segment A→B to C's centre.
   *       If the distance is less than C's bounding-sphere radius + padding,
   *       push C perpendicularly away from the segment by the deficit amount.
   *   After each full edge-obstruction pass, re-resolve any new overlaps.
   */
  private resolveEdgeObstructions(iterations: number = 30): void {
    // Collect unique cross-file edge pairs.
    const crossFileEdges: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const from = edgeId.slice(0, arrow);
      const to   = edgeId.slice(arrow + 1);
      const fromFile = this.nodeToFile.get(from);
      const toFile   = this.nodeToFile.get(to);
      if (!fromFile || !toFile || fromFile === toFile) continue;
      const key = fromFile < toFile
        ? `${fromFile}⟷${toFile}`
        : `${toFile}⟷${fromFile}`;
      if (!seen.has(key)) {
        seen.add(key);
        crossFileEdges.push([fromFile, toFile]);
      }
    }
    if (crossFileEdges.length === 0) return;

    const allFiles = Array.from(this.fileBoxMeshes.keys());
    const edgePadding = 6.0; // clearance beyond bounding-sphere radius

    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;

      for (const [fileA, fileB] of crossFileEdges) {
        const boxA = this.fileBoxMeshes.get(fileA);
        const boxB = this.fileBoxMeshes.get(fileB);
        if (!boxA || !boxB) continue;

        const Ax = boxA.position.x, Ay = boxA.position.y, Az = boxA.position.z;
        const Bx = boxB.position.x, By = boxB.position.y, Bz = boxB.position.z;
        const ABx = Bx - Ax, ABy = By - Ay, ABz = Bz - Az;
        const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
        if (AB2 < 0.0001) continue; // degenerate (same position)
        const ABlen = Math.sqrt(AB2);

        // Compute t-range that excludes the interiors of the endpoint boxes.
        const rA = Math.sqrt(
          (boxA.scaling.x * 0.5) ** 2 +
          (boxA.scaling.y * 0.5) ** 2 +
          (boxA.scaling.z * 0.5) ** 2
        );
        const rB = Math.sqrt(
          (boxB.scaling.x * 0.5) ** 2 +
          (boxB.scaling.y * 0.5) ** 2 +
          (boxB.scaling.z * 0.5) ** 2
        );
        const tMin = rA / ABlen;
        const tMax = 1.0 - rB / ABlen;
        if (tMin >= tMax) continue; // boxes are touching / overlapping

        for (const fileC of allFiles) {
          if (fileC === fileA || fileC === fileB) continue;
          const boxC = this.fileBoxMeshes.get(fileC);
          if (!boxC) continue;

          const Cx = boxC.position.x, Cy = boxC.position.y, Cz = boxC.position.z;

          // Closest point on segment AB to C, clamped to [tMin, tMax]
          const ACx = Cx - Ax, ACy = Cy - Ay, ACz = Cz - Az;
          const tRaw = (ACx * ABx + ACy * ABy + ACz * ABz) / AB2;
          const t = Math.max(tMin, Math.min(tMax, tRaw));

          const closestX = Ax + t * ABx;
          const closestY = Ay + t * ABy;
          const closestZ = Az + t * ABz;

          const dx = Cx - closestX;
          const dy = Cy - closestY;
          const dz = Cz - closestZ;
          const dist2 = dx * dx + dy * dy + dz * dz;

          const rC = Math.sqrt(
            (boxC.scaling.x * 0.5) ** 2 +
            (boxC.scaling.y * 0.5) ** 2 +
            (boxC.scaling.z * 0.5) ** 2
          );
          const required = rC + edgePadding;

          if (dist2 < required * required) {
            const dist    = Math.sqrt(dist2);
            const deficit = required - dist;

            let pushX: number, pushY: number, pushZ: number;
            if (dist < 0.001) {
              // Box centre lies exactly on the edge — push perpendicular to edge.
              const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
              // Cross with Y-up to get a perpendicular; fall back to X-right if parallel.
              let perpX = ey * 0 - ez * 1;   // cross(e, up=(0,1,0))
              let perpZ = ex * 1 - ey * 0;
              let perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
              if (perpLen < 0.001) { perpX = 1; perpZ = 0; perpLen = 1; }
              pushX = (perpX / perpLen) * required;
              pushY = 0;
              pushZ = (perpZ / perpLen) * required;
            } else {
              pushX = (dx / dist) * deficit;
              pushY = (dy / dist) * deficit;
              pushZ = (dz / dist) * deficit;
            }

            boxC.position.x += pushX;
            boxC.position.y += pushY;
            boxC.position.z += pushZ;
            moved = true;
          }
        }
      }

      // Re-resolve any overlaps created by the pushes before the next pass.
      this.resolveFileBoxOverlapsByMesh(3);

      if (!moved) break;
    }
  }

  /**
   * Resolve AABB overlaps between all file boxes working directly with mesh
   * positions (does not touch ForceDirectedLayout node data).
   */
  private resolveFileBoxOverlapsByMesh(maxPasses: number = 10): void {
    const files = Array.from(this.fileBoxMeshes.keys());
    const padding = 6.0;

    for (let pass = 0; pass < maxPasses; pass++) {
      let moved = false;

      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const box1 = this.fileBoxMeshes.get(files[i]);
          const box2 = this.fileBoxMeshes.get(files[j]);
          if (!box1 || !box2) continue;

          const dx = box2.position.x - box1.position.x;
          const dy = box2.position.y - box1.position.y;
          const dz = box2.position.z - box1.position.z;

          const overlapX = (box1.scaling.x * 0.5 + box2.scaling.x * 0.5 + padding) - Math.abs(dx);
          const overlapY = (box1.scaling.y * 0.5 + box2.scaling.y * 0.5 + padding) - Math.abs(dy);
          const overlapZ = (box1.scaling.z * 0.5 + box2.scaling.z * 0.5 + padding) - Math.abs(dz);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            let axis: 'x' | 'y' | 'z' = 'x';
            let penetration = overlapX;
            if (overlapY < penetration) { axis = 'y'; penetration = overlapY; }
            if (overlapZ < penetration) { axis = 'z'; penetration = overlapZ; }

            const correction = penetration * 0.5 + 0.5;
            if (axis === 'x') {
              const sign = dx >= 0 ? 1 : -1;
              box1.position.x -= sign * correction;
              box2.position.x += sign * correction;
            } else if (axis === 'y') {
              const sign = dy >= 0 ? 1 : -1;
              box1.position.y -= sign * correction;
              box2.position.y += sign * correction;
            } else {
              const sign = dz >= 0 ? 1 : -1;
              box1.position.z -= sign * correction;
              box2.position.z += sign * correction;
            }
            moved = true;
          }
        }
      }

      if (!moved) break;
    }
  }

  /**
   * For each exported function that has been placed on a file-box face, find all
   * internal (non-exported) nodes in the same file that share an edge with it and
   * slide them toward the same face surface (along the face-normal axis). This
   * creates a visual cluster of "incoming callers" near the gateway of each box.
   *
   * The pull target is LOCAL_PULL_TARGET (≈ ±0.38) — inside the face but close
   * enough to be visually adjacent to the exported box at ±0.5.
   * After pulling, internal-node collisions are resolved.
   */
  private pullInternalNodesToExportedFace(): void {
    const PULL_TARGET = 0.38; // local-space depth to pull toward (face is at ±0.5)
    type Axis = 'x' | 'y' | 'z';

    // Build pull targets from edges that connect non-exported internal nodes to
    // exported functions.
    // - Cross-file: pull toward the face that points at the exported target file.
    // - Same-file caller→exported: pull toward the SAME inside face as exported.
    // If multiple candidates exist for a node, choose the shortest edge.
    const pullTargets = new Map<string, {
      normalAxis: Axis;
      normalSign: number;
      edgeLength: number;
    }>();

    for (const edgeId of this.currentEdges) {
      const arrow = edgeId.indexOf('→');
      if (arrow < 0) continue;
      const fromId = edgeId.slice(0, arrow);
      const toId   = edgeId.slice(arrow + 1);

      const fromFile = this.nodeToFile.get(fromId);
      const toFile   = this.nodeToFile.get(toId);
      if (!fromFile || !toFile) continue;
      const isCrossFile = fromFile !== toFile;

      const fromNode = this.graphNodeMap.get(fromId);
      const toNode   = this.graphNodeMap.get(toId);
      if (!fromNode || !toNode) continue;

      // Identify which side is the non-exported internal node and which is exported.
      let internalId:   string | null = null;
      let internalFile: string | null = null;
      let exportedId:   string | null = null;

      if (isCrossFile) {
        if (toNode.isExported && fromNode.type === 'function' && !fromNode.isExported) {
          internalId = fromId; internalFile = fromFile; exportedId = toId;
        } else if (fromNode.isExported && toNode.type === 'function' && !toNode.isExported) {
          internalId = toId;   internalFile = toFile;   exportedId = fromId;
        }
      } else {
        // Same-file caller -> exported callee.
        if (fromNode.type === 'function' && !fromNode.isExported && toNode.isExported) {
          internalId = fromId; internalFile = fromFile; exportedId = toId;
        }
      }
      if (!internalId || !internalFile || !exportedId) continue;

      // World position of the exported function (fall back to its file box centre).
      const exportedMesh = this.nodeMeshMap.get(exportedId);
      const exportedBox  = this.fileBoxMeshes.get(this.nodeToFile.get(exportedId) || '');
      const exportedWorld = exportedMesh
        ? exportedMesh.getAbsolutePosition().clone()
        : (exportedBox ? exportedBox.position.clone() : null);
      if (!exportedWorld) continue;

      // Direction from the internal node's file box centre to the exported node,
      // expressed in the file box's local space (divide by scaling, no rotation).
      const internalBox = this.fileBoxMeshes.get(internalFile);
      if (!internalBox) continue;

      const internalMesh = this.nodeMeshMap.get(internalId);
      const internalWorld = internalMesh
        ? internalMesh.getAbsolutePosition().clone()
        : internalBox.position.clone();

      // Use actual edge length (node-to-node in world space when available)
      // to choose the strongest pull target.
      const edgeLength = exportedWorld.subtract(internalWorld).length();

      let normalAxis: Axis = 'x';
      let normalSign = 1;

      if (exportedMesh) {
        // Use the exported function's pinned face axis/sign for all connected
        // internal nodes (same-file and cross-file). This keeps pull direction
        // consistent with the surface direction of the exported function.
        const lp = exportedMesh.position;
        const ax = Math.abs(lp.x), ay = Math.abs(lp.y), az = Math.abs(lp.z);
        if (ax >= ay && ax >= az) {
          normalAxis = 'x';
          normalSign = lp.x >= 0 ? 1 : -1;
        } else if (ay >= ax && ay >= az) {
          normalAxis = 'y';
          normalSign = lp.y >= 0 ? 1 : -1;
        } else {
          normalAxis = 'z';
          normalSign = lp.z >= 0 ? 1 : -1;
        }
      } else {
        const dx = (exportedWorld.x - internalBox.position.x) / Math.max(0.0001, internalBox.scaling.x);
        const dy = (exportedWorld.y - internalBox.position.y) / Math.max(0.0001, internalBox.scaling.y);
        const dz = (exportedWorld.z - internalBox.position.z) / Math.max(0.0001, internalBox.scaling.z);

        // Fallback when exported mesh is unavailable: choose face that points
        // toward the exported target world position.
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        normalAxis = 'x';
        normalSign = dx >= 0 ? 1 : -1;
        if (ay > ax && ay >= az) { normalAxis = 'y'; normalSign = dy >= 0 ? 1 : -1; }
        else if (az > ax && az > ay) { normalAxis = 'z'; normalSign = dz >= 0 ? 1 : -1; }
      }

      const existing = pullTargets.get(internalId);
      if (!existing || edgeLength < existing.edgeLength) {
        pullTargets.set(internalId, { normalAxis, normalSign, edgeLength });
      }
    }

    // Apply the pulls toward the chosen shortest-edge face target.
    for (const [internalId, { normalAxis, normalSign }] of pullTargets.entries()) {
      const mesh    = this.nodeMeshMap.get(internalId);
      if (!mesh) continue;
      const fileBox = this.fileBoxMeshes.get(this.nodeToFile.get(internalId) || '');
      if (!mesh.parent || mesh.parent !== fileBox) continue;

      const target  = normalSign * PULL_TARGET;
      (mesh.position as any)[normalAxis] = target;
    }

    this.clampNodesInsideFileBoxes();
    this.resolveInternalNodeCollisions(10);
  }

  /**
   * Push apart internal (non-exported) node meshes that sit in the same file box
   * and overlap in world space. Exported nodes are left pinned to their faces.
   * Operates in world space for push computation, converts result to local space.
   */
  private resolveInternalNodeCollisions(maxPasses: number = 10, includeExported: boolean = false): void {
    // Additional world-space padding beyond the sum of node radii.
    const collisionPaddingWorld = 1.8;

    for (const [, fileBox] of this.fileBoxMeshes.entries()) {
      // Gather function children of this file box.
      const children: BABYLON.Mesh[] = [];
      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.type !== 'function') continue;
        if (!includeExported && node.isExported) continue;
        if (mesh.parent !== fileBox) continue;
        children.push(mesh);
      }
      if (children.length < 2) continue;

      for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (let i = 0; i < children.length; i++) {
          for (let j = i + 1; j < children.length; j++) {
            const a = children[i];
            const b = children[j];
            const wa = a.getAbsolutePosition();
            const wb = b.getAbsolutePosition();
            const dx = wb.x - wa.x;
            const dy = wb.y - wa.y;
            const dz = wb.z - wa.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const aRadiusWorld = Math.max(0.2, a.getBoundingInfo().boundingSphere.radiusWorld);
            const bRadiusWorld = Math.max(0.2, b.getBoundingInfo().boundingSphere.radiusWorld);
            const minSepWorld = aRadiusWorld + bRadiusWorld + collisionPaddingWorld;
            if (dist >= minSepWorld) continue;

            const deficit = (minSepWorld - dist) * 0.5;
            let nx: number, ny: number, nz: number;
            if (dist < 0.001) {
              nx = 1; ny = 0; nz = 0;
            } else {
              nx = dx / dist; ny = dy / dist; nz = dz / dist;
            }

            // Convert world-space push to local space.
            const safeX = Math.max(0.0001, fileBox.scaling.x);
            const safeY = Math.max(0.0001, fileBox.scaling.y);
            const safeZ = Math.max(0.0001, fileBox.scaling.z);
            a.position.x -= (nx * deficit) / safeX;
            a.position.y -= (ny * deficit) / safeY;
            a.position.z -= (nz * deficit) / safeZ;
            b.position.x += (nx * deficit) / safeX;
            b.position.y += (ny * deficit) / safeY;
            b.position.z += (nz * deficit) / safeZ;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }

    this.clampNodesInsideFileBoxes();
  }

  /**
   * Spread exported function meshes across their pinned face so they do not
   * overlap each other. Movement is constrained to the face tangent plane.
   */
  private spreadExportedFunctionsOnFaces(maxPasses: number = 10): void {
    const minSepWorld = 12.0; // increase spacing between exported face nodes
    const faceThresh = 0.45;
    const maxTangent = 0.48;
    type Axis = 'x' | 'y' | 'z';

    for (const [, fileBox] of this.fileBoxMeshes.entries()) {
      const groups = new Map<string, BABYLON.Mesh[]>();

      // Group exported meshes by pinned face (axis + sign).
      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.type !== 'function' || !node.isExported) continue;
        if (mesh.parent !== fileBox) continue;

        const lp = mesh.position;
        let normalAxis: Axis | null = null;
        let normalSign = 1;
        if (Math.abs(lp.x) >= faceThresh) { normalAxis = 'x'; normalSign = Math.sign(lp.x) || 1; }
        else if (Math.abs(lp.y) >= faceThresh) { normalAxis = 'y'; normalSign = Math.sign(lp.y) || 1; }
        else if (Math.abs(lp.z) >= faceThresh) { normalAxis = 'z'; normalSign = Math.sign(lp.z) || 1; }
        if (!normalAxis) continue;

        const key = `${normalAxis}:${normalSign}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(mesh);
      }

      for (const [faceKey, meshes] of groups.entries()) {
        if (meshes.length < 2) continue;

        const [normalAxis, signStr] = faceKey.split(':');
        const normalSign = Number(signStr) >= 0 ? 1 : -1;
        const tangentAxes = (['x', 'y', 'z'] as Axis[]).filter(a => a !== normalAxis as Axis);

        if (this.exportedFaceCircleLayout) {
          this.arrangeExportedFaceGroupInCircle(
            fileBox,
            meshes,
            normalAxis as Axis,
            normalSign,
            tangentAxes,
            minSepWorld,
            maxTangent,
          );
          continue;
        }

        for (let pass = 0; pass < maxPasses; pass++) {
          let moved = false;

          for (let i = 0; i < meshes.length; i++) {
            for (let j = i + 1; j < meshes.length; j++) {
              const a = meshes[i];
              const b = meshes[j];

              // Compare only tangential components in world space.
              const da0 = ((b.position as any)[tangentAxes[0]] - (a.position as any)[tangentAxes[0]])
                * (fileBox.scaling as any)[tangentAxes[0]];
              const da1 = ((b.position as any)[tangentAxes[1]] - (a.position as any)[tangentAxes[1]])
                * (fileBox.scaling as any)[tangentAxes[1]];
              const dist = Math.sqrt(da0 * da0 + da1 * da1);
              if (dist >= minSepWorld) continue;

              const deficit = (minSepWorld - dist) * 0.5;
              let n0: number, n1: number;
              if (dist < 0.001) {
                n0 = 1;
                n1 = 0;
              } else {
                n0 = da0 / dist;
                n1 = da1 / dist;
              }

              const push0World = n0 * deficit;
              const push1World = n1 * deficit;

              const safeScale0 = Math.max(0.0001, (fileBox.scaling as any)[tangentAxes[0]]);
              const safeScale1 = Math.max(0.0001, (fileBox.scaling as any)[tangentAxes[1]]);
              const push0Local = push0World / safeScale0;
              const push1Local = push1World / safeScale1;

              (a.position as any)[tangentAxes[0]] -= push0Local;
              (a.position as any)[tangentAxes[1]] -= push1Local;
              (b.position as any)[tangentAxes[0]] += push0Local;
              (b.position as any)[tangentAxes[1]] += push1Local;

              (a.position as any)[tangentAxes[0]] = Math.max(-maxTangent, Math.min(maxTangent, (a.position as any)[tangentAxes[0]]));
              (a.position as any)[tangentAxes[1]] = Math.max(-maxTangent, Math.min(maxTangent, (a.position as any)[tangentAxes[1]]));
              (b.position as any)[tangentAxes[0]] = Math.max(-maxTangent, Math.min(maxTangent, (b.position as any)[tangentAxes[0]]));
              (b.position as any)[tangentAxes[1]] = Math.max(-maxTangent, Math.min(maxTangent, (b.position as any)[tangentAxes[1]]));

              const targetA = this.getExportedFaceLocalTarget(fileBox, a, normalAxis as Axis, normalSign);
              const targetB = this.getExportedFaceLocalTarget(fileBox, b, normalAxis as Axis, normalSign);
              (a.position as any)[normalAxis] = targetA;
              (b.position as any)[normalAxis] = targetB;

              moved = true;
            }
          }

          if (!moved) break;
        }
      }
    }

    this.clampNodesInsideFileBoxes();
  }

  /**
   * Arrange a pinned-face exported group on a tangential circle/ellipse.
   * Keeps each mesh pinned to the face normal while distributing angles evenly.
   */
  private arrangeExportedFaceGroupInCircle(
    fileBox: BABYLON.Mesh,
    meshes: BABYLON.Mesh[],
    normalAxis: 'x' | 'y' | 'z',
    normalSign: number,
    tangentAxes: Array<'x' | 'y' | 'z'>,
    minSepWorld: number,
    maxTangent: number,
  ): void {
    if (meshes.length === 0) {
      return;
    }

    const sorted = [...meshes].sort((a, b) => a.name.localeCompare(b.name));
    const axisA = tangentAxes[0];
    const axisB = tangentAxes[1];
    const safeScaleA = Math.max(0.0001, (fileBox.scaling as any)[axisA] as number);
    const safeScaleB = Math.max(0.0001, (fileBox.scaling as any)[axisB] as number);

    let centerA = 0;
    let centerB = 0;
    for (const mesh of sorted) {
      centerA += (mesh.position as any)[axisA] as number;
      centerB += (mesh.position as any)[axisB] as number;
    }
    centerA /= sorted.length;
    centerB /= sorted.length;

    const radiusWorld = (sorted.length * minSepWorld) / (2 * Math.PI);
    const maxRadiusLocal = maxTangent * 0.90;
    const radiusA = Math.min(maxRadiusLocal, radiusWorld / safeScaleA);
    const radiusB = Math.min(maxRadiusLocal, radiusWorld / safeScaleB);

    const centerLimitA = Math.max(0, maxTangent - radiusA);
    const centerLimitB = Math.max(0, maxTangent - radiusB);
    centerA = Math.max(-centerLimitA, Math.min(centerLimitA, centerA));
    centerB = Math.max(-centerLimitB, Math.min(centerLimitB, centerB));

    const startAngle = -Math.PI * 0.5;
    const step = (Math.PI * 2) / sorted.length;

    for (let i = 0; i < sorted.length; i++) {
      const mesh = sorted[i];
      const angle = startAngle + (i * step);

      (mesh.position as any)[axisA] = centerA + (Math.cos(angle) * radiusA);
      (mesh.position as any)[axisB] = centerB + (Math.sin(angle) * radiusB);

      (mesh.position as any)[axisA] = Math.max(-maxTangent, Math.min(maxTangent, (mesh.position as any)[axisA]));
      (mesh.position as any)[axisB] = Math.max(-maxTangent, Math.min(maxTangent, (mesh.position as any)[axisB]));
      (mesh.position as any)[normalAxis] = this.getExportedFaceLocalTarget(fileBox, mesh, normalAxis, normalSign);
    }
  }

  /**
   * Slide exported function nodes along their pinned face to avoid edges
   * that pass too close. Movement is constrained to the face plane so the
  * node never leaves its face (face-normal local coordinate stays outside the
  * box at ±(0.5 + protrusion)).
   * The two tangential local axes are clamped to ±0.45 so the node stays
   * visibly on the face.
   */
  private resolveExportedFaceEdgeObstructions(iterations: number = 15): void {
    const nodeRadius = 0.5;
    const nodePadding = 5.0;
    const required = nodeRadius + nodePadding;
    const maxTangent = 0.45; // local-space limit along face tangent axes
    // Threshold at or above which a local axis is treated as the face normal.
    const faceThresh = 0.45;

    for (let iter = 0; iter < iterations; iter++) {
      // Rebuild world-space edge segments each pass.
      const segments: Array<{
        fromId: string; toId: string;
        from: BABYLON.Vector3; to: BABYLON.Vector3;
      }> = [];
      for (const edgeId of this.currentEdges) {
        const arrow = edgeId.indexOf('→');
        if (arrow < 0) continue;
        const fromId = edgeId.slice(0, arrow);
        const toId   = edgeId.slice(arrow + 1);
        const fromMesh = this.nodeMeshMap.get(fromId);
        const toMesh   = this.nodeMeshMap.get(toId);
        if (!fromMesh || !toMesh) continue;
        segments.push({
          fromId, toId,
          from: fromMesh.getAbsolutePosition().clone(),
          to:   toMesh.getAbsolutePosition().clone(),
        });
      }
      if (segments.length === 0) break;

      let moved = false;

      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || !node.isExported || node.type !== 'function') continue;

        const fileBox = this.fileBoxMeshes.get(node.file || '');
        if (!fileBox) continue;

        const lp = mesh.position; // local position in file-box space

        // Determine face normal axis (whichever local coord has |value| ≥ faceThresh).
        type Axis = 'x' | 'y' | 'z';
        let normalAxis: Axis | null = null;
        let normalSign = 1;
        if (Math.abs(lp.x) >= faceThresh) { normalAxis = 'x'; normalSign = Math.sign(lp.x); }
        else if (Math.abs(lp.y) >= faceThresh) { normalAxis = 'y'; normalSign = Math.sign(lp.y); }
        else if (Math.abs(lp.z) >= faceThresh) { normalAxis = 'z'; normalSign = Math.sign(lp.z); }
        if (!normalAxis) continue; // not yet face-placed

        const tangentAxes: Axis[] = (['x', 'y', 'z'] as Axis[]).filter(a => a !== normalAxis);

        const wp = mesh.getAbsolutePosition();

        for (const seg of segments) {
          if (seg.fromId === nodeId || seg.toId === nodeId) continue;

          const ABx = seg.to.x - seg.from.x;
          const ABy = seg.to.y - seg.from.y;
          const ABz = seg.to.z - seg.from.z;
          const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
          if (AB2 < 0.0001) continue;

          const t = Math.max(0, Math.min(1,
            ((wp.x - seg.from.x) * ABx +
             (wp.y - seg.from.y) * ABy +
             (wp.z - seg.from.z) * ABz) / AB2
          ));

          const cx = seg.from.x + t * ABx;
          const cy = seg.from.y + t * ABy;
          const cz = seg.from.z + t * ABz;

          const dx = wp.x - cx;
          const dy = wp.y - cy;
          const dz = wp.z - cz;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 >= required * required) continue;

          const dist    = Math.sqrt(dist2);
          const deficit = required - dist;

          let pushX: number, pushY: number, pushZ: number;
          if (dist < 0.001) {
            const ABlen = Math.sqrt(AB2);
            const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
            let perpX = ey * 0 - ez * 1;
            let perpZ = ex * 1 - ey * 0;
            const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
            if (perpLen > 0.001) { perpX /= perpLen; perpZ /= perpLen; } else { perpX = 1; perpZ = 0; }
            pushX = perpX * required;
            pushY = 0;
            pushZ = perpZ * required;
          } else {
            pushX = (dx / dist) * deficit;
            pushY = (dy / dist) * deficit;
            pushZ = (dz / dist) * deficit;
          }

          // Convert world push to local, zero out normal axis, apply tangents only.
          const push: Record<Axis, number> = {
            x: pushX / Math.max(0.0001, fileBox.scaling.x),
            y: pushY / Math.max(0.0001, fileBox.scaling.y),
            z: pushZ / Math.max(0.0001, fileBox.scaling.z),
          };
          push[normalAxis] = 0;

          for (const axis of tangentAxes) {
            (mesh.position as any)[axis] = Math.max(-maxTangent,
              Math.min(maxTangent, (mesh.position as any)[axis] + push[axis]));
          }
          // Keep normal axis pinned outside the chosen face.
          const target = this.getExportedFaceLocalTarget(fileBox, mesh, normalAxis, normalSign);
          (mesh.position as any)[normalAxis] = target;

          moved = true;
        }
      }

      if (!moved) break;
    }
  }

  /**
   * Nudge non-exported internal function-node meshes away from any edge segment
   * to improve visual clarity. Exported functions are left in place because
   * they are pinned to their file-box face by placeExportedFunctionsOnOptimalFace.
   * After all nudges, nodes are re-clamped inside their parent file box.
   */
  private resolveNodeEdgeObstructions(iterations: number = 20): void {
    // Internal function nodes have world-space size ≈ 1.0 after scale compensation.
    const nodeRadius = 0.5;
    const nodePadding = 5.0; // additional world-space clearance around each node
    const required = nodeRadius + nodePadding;

    for (let iter = 0; iter < iterations; iter++) {
      // Rebuild segments each pass – endpoints may have shifted from prior nudges.
      const segments: Array<{
        fromId: string; toId: string;
        from: BABYLON.Vector3; to: BABYLON.Vector3;
      }> = [];

      for (const edgeId of this.currentEdges) {
        const arrow = edgeId.indexOf('→');
        if (arrow < 0) continue;
        const fromId = edgeId.slice(0, arrow);
        const toId   = edgeId.slice(arrow + 1);
        const fromMesh = this.nodeMeshMap.get(fromId);
        const toMesh   = this.nodeMeshMap.get(toId);
        if (!fromMesh || !toMesh) continue;
        segments.push({
          fromId, toId,
          from: fromMesh.getAbsolutePosition().clone(),
          to:   toMesh.getAbsolutePosition().clone(),
        });
      }

      if (segments.length === 0) break;

      let moved = false;

      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.type === 'variable' || node.type === 'external') continue;
        if (node.isExported) continue; // pinned to face – do not move

        const fileBox = this.fileBoxMeshes.get(node.file || '');
        if (!fileBox) continue;

        const wp = mesh.getAbsolutePosition();

        for (const seg of segments) {
          if (seg.fromId === nodeId || seg.toId === nodeId) continue;

          const ABx = seg.to.x - seg.from.x;
          const ABy = seg.to.y - seg.from.y;
          const ABz = seg.to.z - seg.from.z;
          const AB2 = ABx * ABx + ABy * ABy + ABz * ABz;
          if (AB2 < 0.0001) continue;

          const t = Math.max(0, Math.min(1,
            ((wp.x - seg.from.x) * ABx +
             (wp.y - seg.from.y) * ABy +
             (wp.z - seg.from.z) * ABz) / AB2
          ));

          const cx = seg.from.x + t * ABx;
          const cy = seg.from.y + t * ABy;
          const cz = seg.from.z + t * ABz;

          const dx = wp.x - cx;
          const dy = wp.y - cy;
          const dz = wp.z - cz;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 >= required * required) continue;

          const dist    = Math.sqrt(dist2);
          const deficit = required - dist;

          let pushX: number, pushY: number, pushZ: number;
          if (dist < 0.001) {
            // Node centre lies on the segment – push perpendicular to edge direction.
            const ABlen = Math.sqrt(AB2);
            const ex = ABx / ABlen, ey = ABy / ABlen, ez = ABz / ABlen;
            let perpX = ey * 0 - ez * 1;
            let perpZ = ex * 1 - ey * 0;
            let perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);
            if (perpLen < 0.001) { perpX = 1; perpZ = 0; perpLen = 1; }
            pushX = (perpX / perpLen) * required;
            pushY = 0;
            pushZ = (perpZ / perpLen) * required;
          } else {
            pushX = (dx / dist) * deficit;
            pushY = (dy / dist) * deficit;
            pushZ = (dz / dist) * deficit;
          }

          // Convert world-space push into parent file-box local space.
          mesh.position.x += pushX / fileBox.scaling.x;
          mesh.position.y += pushY / fileBox.scaling.y;
          mesh.position.z += pushZ / fileBox.scaling.z;
          moved = true;
        }
      }

      if (!moved) break;
    }

    // Re-clamp all nudged nodes to remain inside their parent file box.
    this.clampNodesInsideFileBoxes();
  }

  /**
   * Push function boxes away from file/directory label planes so labels remain readable.
   * Internal nodes can move freely; exported nodes move tangentially on their pinned face.
   */
  private resolveFunctionLabelObstructions(iterations: number = 14): void {
    const labelMeshes = this.scene.meshes.filter(
      (m) => m.name.startsWith('filelabel_') || m.name.startsWith('dirlabel_')
    ) as BABYLON.Mesh[];
    if (labelMeshes.length === 0) {
      return;
    }

    type Axis = 'x' | 'y' | 'z';
    const faceThresh = 0.45;
    const maxTangent = 0.49;
    const extraGap = 2.2;

    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;

      for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
        const node = this.graphNodeMap.get(nodeId);
        if (!node || node.type !== 'function') continue;

        const file = node.file;
        if (!file || file === 'external') continue;
        const fileBox = this.fileBoxMeshes.get(file);
        if (!fileBox || mesh.parent !== fileBox) continue;

        const wp = mesh.getAbsolutePosition();
        const nodeRadius = node.isExported ? 3.0 : 0.8;

        let normalAxis: Axis | null = null;
        let normalSign = 1;
        let tangentAxes: Axis[] = ['x', 'y'];
        if (node.isExported) {
          const lp = mesh.position;
          if (Math.abs(lp.x) >= faceThresh) { normalAxis = 'x'; normalSign = Math.sign(lp.x) || 1; }
          else if (Math.abs(lp.y) >= faceThresh) { normalAxis = 'y'; normalSign = Math.sign(lp.y) || 1; }
          else if (Math.abs(lp.z) >= faceThresh) { normalAxis = 'z'; normalSign = Math.sign(lp.z) || 1; }
          if (normalAxis) {
            tangentAxes = (['x', 'y', 'z'] as Axis[]).filter((a) => a !== normalAxis);
          }
        }

        for (const label of labelMeshes) {
          label.computeWorldMatrix(true);
          const lw = label.getAbsolutePosition();
          const dx = wp.x - lw.x;
          const dy = wp.y - lw.y;
          const dz = wp.z - lw.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          const labelRadiusWorld = label.getBoundingInfo().boundingSphere.radiusWorld;
          const effectiveLabelRadius = Math.max(4.0, Math.min(10.0, labelRadiusWorld * 0.45));
          const required = nodeRadius + effectiveLabelRadius + extraGap;
          if (dist >= required) continue;

          const deficit = required - dist;
          let pushX: number, pushY: number, pushZ: number;
          if (dist < 0.001) {
            pushX = required;
            pushY = 0;
            pushZ = 0;
          } else {
            pushX = (dx / dist) * deficit;
            pushY = (dy / dist) * deficit;
            pushZ = (dz / dist) * deficit;
          }

          const pushLocal: Record<Axis, number> = {
            x: pushX / Math.max(0.0001, fileBox.scaling.x),
            y: pushY / Math.max(0.0001, fileBox.scaling.y),
            z: pushZ / Math.max(0.0001, fileBox.scaling.z),
          };

          if (node.isExported && normalAxis) {
            pushLocal[normalAxis] = 0;
            for (const axis of tangentAxes) {
              (mesh.position as any)[axis] = Math.max(-maxTangent,
                Math.min(maxTangent, (mesh.position as any)[axis] + pushLocal[axis]));
            }
            const target = this.getExportedFaceLocalTarget(fileBox, mesh, normalAxis, normalSign);
            (mesh.position as any)[normalAxis] = target;
          } else {
            mesh.position.x += pushLocal.x;
            mesh.position.y += pushLocal.y;
            mesh.position.z += pushLocal.z;
          }

          moved = true;
        }
      }

      if (!moved) break;
    }

    this.clampNodesInsideFileBoxes();
  }

  private renderEdges(): void {
    // Get the current graph edges in correct format for MeshFactory
    const graphEdges = Array.from(this.currentEdges).map(edgeId => {
      const [from, to] = edgeId.split('→');
      return { from, to, kind: this.currentEdgeKinds.get(edgeId) ?? 'call' as const };
    });
    
    // Build a map of node IDs to their exported status for edge material selection
    const nodeExportedMap = new Map<string, boolean>();
    const nodeFileMap = new Map<string, string>();
    if (this.currentGraphData && this.currentGraphData.nodes) {
      for (const node of this.currentGraphData.nodes) {
        nodeExportedMap.set(node.id, node.isExported || false);
        if (node.file) {
          nodeFileMap.set(node.id, node.file);
        }
      }
    }
    
    // Create edges - they'll be positioned by updateEdges() in the physics loop
    this.meshFactory.createEdges(graphEdges, new Map(), this.sceneRoot, nodeExportedMap, this.fileColorMap, nodeFileMap);
  }

  /**
   * Position and target the camera so visible function meshes are in view.
   */
  private frameCameraToExportedFunctions(): void {
    const exportedPoints: BABYLON.Vector3[] = [];
    const functionPoints: BABYLON.Vector3[] = [];

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      const isFunctionNode = !!node && node.type !== 'variable' && node.type !== 'external';
      if (!node || !isFunctionNode) {
        continue;
      }
      if (!mesh.isVisible || !mesh.isEnabled()) {
        continue;
      }
      const p = mesh.getAbsolutePosition().clone();
      functionPoints.push(p);
      if (node.isExported) {
        exportedPoints.push(p);
      }
    }

    let points = functionPoints;
    const modeLabel = 'all';

    if (points.length === 0) {
      console.warn('⚠ No visible function meshes found for camera framing');
      this.camera.setTarget(BABYLON.Vector3.Zero());
      this.camera.position = new BABYLON.Vector3(0, 0, -20);
      return;
    }

    // Ignore extreme outliers so one bad mesh position cannot push the camera
    // so far away that the full graph appears invisible.
    if (points.length >= 20) {
      const centroid = points.reduce(
        (acc, p) => acc.addInPlace(p),
        BABYLON.Vector3.Zero()
      ).scale(1 / points.length);

      const sortedDistances = points
        .map((p) => ({ p, d2: BABYLON.Vector3.DistanceSquared(p, centroid) }))
        .sort((a, b) => a.d2 - b.d2);

      const keepCount = Math.max(12, Math.floor(sortedDistances.length * 0.95));
      const trimmed = sortedDistances.slice(0, keepCount).map((x) => x.p);
      if (trimmed.length >= 12) {
        points = trimmed;
      }
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      return;
    }

    const center = new BABYLON.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    );

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const radius = Math.max(1.0, Math.max(sizeX, sizeY, sizeZ) * 0.5);

    // Compute camera distance needed to fit the largest scene extent.
    const fov = Math.max(0.1, this.camera.fov);
    const distance = Math.max(20, Math.min(1800, (radius / Math.tan(fov * 0.5)) * 1.2));

    // Ensure the far clip plane covers the full scene depth from the camera position.
    // If the scene is large, distance can exceed maxZ and clip everything.
    this.camera.maxZ = Math.max(2000, distance + radius * 2 + 100);
    // Keep near clip tight enough to maintain depth precision (minZ ≥ 0.05).
    this.camera.minZ = Math.max(0.05, distance * 0.0001);

    this.camera.setTarget(center);
    this.camera.position = new BABYLON.Vector3(center.x, center.y, center.z - distance);
    console.log(`👁 Framed camera to ${points.length} ${modeLabel} function meshes (distance=${distance.toFixed(1)}, maxZ=${this.camera.maxZ.toFixed(1)})`);
  }

  /**
   * Place file boxes in a deterministic visible grid near the origin.
   */
  /**
   * Minimise the total bounding volume of the file-box layout by iteratively
   * nudging each box toward the group centroid.  A candidate move is only
   * applied when the AABB gap to every other box remains ≥ minGap, so boxes
   * never collide or crowd one another.
   */
  private compactFileBoxLayout(iterations: number = 80, minGap: number = 10.0): void {
    if (!this.fileLayout) return;

    const files = Array.from(this.fileNodeIds.keys());
    if (files.length < 2) return;

    const fileNodes = this.fileLayout.getNodes();

    // AABB overlap test using per-axis half-extents + gap.
    const overlaps = (
      pos1: { x: number; y: number; z: number },
      pos2: { x: number; y: number; z: number },
      box1: BABYLON.Mesh,
      box2: BABYLON.Mesh
    ): boolean => {
      const dx = Math.abs(pos2.x - pos1.x);
      const dy = Math.abs(pos2.y - pos1.y);
      const dz = Math.abs(pos2.z - pos1.z);
      return (
        dx < box1.scaling.x / 2 + box2.scaling.x / 2 + minGap &&
        dy < box1.scaling.y / 2 + box2.scaling.y / 2 + minGap &&
        dz < box1.scaling.z / 2 + box2.scaling.z / 2 + minGap
      );
    };

    for (let iter = 0; iter < iterations; iter++) {
      // Compute centroid of all file-box centres.
      let cx = 0, cy = 0, cz = 0, count = 0;
      for (const file of files) {
        const n = fileNodes.get(file);
        if (!n) continue;
        cx += n.position.x;
        cy += n.position.y;
        cz += n.position.z;
        count++;
      }
      if (count === 0) break;
      cx /= count;
      cy /= count;
      cz /= count;

      let movedAny = false;

      for (const file of files) {
        const node = fileNodes.get(file);
        const box = this.fileBoxMeshes.get(file);
        if (!node || !box) continue;

        const dirX = cx - node.position.x;
        const dirY = cy - node.position.y;
        const dirZ = cz - node.position.z;
        const dist = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        if (dist < 0.5) continue; // Already close enough to centroid.

        // Attempt a step of 10 % of remaining distance (min 0.5 units).
        const step = Math.max(0.5, dist * 0.10);
        const scale = step / dist;
        const candidate = {
          x: node.position.x + dirX * scale,
          y: node.position.y + dirY * scale,
          z: node.position.z + dirZ * scale,
        };

        // Accept move only if it preserves gap with every other box.
        let safe = true;
        for (const other of files) {
          if (other === file) continue;
          const otherNode = fileNodes.get(other);
          const otherBox = this.fileBoxMeshes.get(other);
          if (!otherNode || !otherBox) continue;
          if (overlaps(candidate, otherNode.position, box, otherBox)) {
            safe = false;
            break;
          }
        }

        if (safe) {
          node.position.x = candidate.x;
          node.position.y = candidate.y;
          node.position.z = candidate.z;
          movedAny = true;
        }
      }

      if (!movedAny) break;
    }

    // Sync compacted positions to file-box meshes.
    for (const [file, fileBox] of this.fileBoxMeshes.entries()) {
      const fileNode = fileNodes.get(file);
      if (!fileNode) continue;
      fileBox.position.x = fileNode.position.x;
      fileBox.position.y = fileNode.position.y;
      fileBox.position.z = fileNode.position.z;
    }
  }

  private positionFileBoxesInGrid(): void {
    const files = Array.from(this.fileBoxMeshes.keys()).sort();
    if (files.length === 0) {
      return;
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
    let maxHalfExtent = 0;
    for (const file of files) {
      const box = this.fileBoxMeshes.get(file);
      if (!box) {
        continue;
      }
      box.computeWorldMatrix(true);
      const bounds = box.getBoundingInfo().boundingBox;
      const extentX = (bounds.maximumWorld.x - bounds.minimumWorld.x) / 2;
      const extentY = (bounds.maximumWorld.y - bounds.minimumWorld.y) / 2;
      const extentZ = (bounds.maximumWorld.z - bounds.minimumWorld.z) / 2;
      maxHalfExtent = Math.max(maxHalfExtent, extentX, extentY, extentZ);
    }

    const minGap = 40; // guaranteed surface-to-surface separation
    const spacing = Math.max(60, (maxHalfExtent * 2) + minGap);
    const centerX = (columns - 1) * 0.5;
    const rows = Math.ceil(files.length / columns);
    const centerY = (rows - 1) * 0.5;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileBox = this.fileBoxMeshes.get(file);
      if (!fileBox) {
        continue;
      }

      const row = Math.floor(i / columns);
      const col = i % columns;
      fileBox.position.x = (col - centerX) * spacing;
      fileBox.position.y = (centerY - row) * spacing;
      fileBox.position.z = 0;
    }
  }



  private ensureFunctionEditorScreen(): void {
    if (this.functionEditorScreen && this.functionEditorTexture && this.functionEditorMaterial) {
      return;
    }

    const screen = BABYLON.MeshBuilder.CreatePlane(
      'functionEditorScreen',
      { width: 1, height: 1 },
      this.scene,
    );
    screen.isPickable = true;
    screen.alwaysSelectAsActiveMesh = true;
    screen.setEnabled(false);

    const texture = new BABYLON.DynamicTexture(
      'functionEditorTexture',
      { width: EDITOR_TEXTURE_WIDTH, height: EDITOR_TEXTURE_HEIGHT },
      this.scene,
      true,
    );
    texture.hasAlpha = true;
    // Canvas text appears mirrored on the plane without this horizontal UV flip.
    texture.uScale = -1;
    texture.uOffset = 1;

    const material = new BABYLON.StandardMaterial('functionEditorMaterial', this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1);
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.zOffset = -6;
    material.backFaceCulling = false;
    screen.material = material;
    screen.renderingGroupId = 3;
    screen.alphaIndex = 1000;

    this.functionEditorScreen = screen;
    this.functionEditorTexture = texture;
    this.functionEditorMaterial = material;
  }

  private showFunctionEditor(node: GraphNode): void {
    if (!node.code || !node.id) {
      this.hideFunctionEditor();
      return;
    }

    const hostMesh = this.nodeMeshMap.get(node.id);
    if (!hostMesh) {
      this.hideFunctionEditor();
      return;
    }

    this.ensureFunctionEditorScreen();
    if (!this.functionEditorScreen || !this.functionEditorTexture) {
      return;
    }

    const meshAny = hostMesh as any;
    const boxSize = typeof meshAny.boxSize === 'number'
      ? meshAny.boxSize
      : Math.max(1.0, (hostMesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);

    this.drawFunctionEditorTexture(node);

    this.attachEditorScreenToVisibleFace(hostMesh, boxSize, node.id);
    this.functionEditorScreen.setEnabled(true);
    this.editorVisibleForNodeId = node.id;
    this.editorCurrentNodeId = node.id;

    console.log('🖥️ Editor shown', {
      nodeId: node.id,
      name: node.name,
      file: node.file,
      line: node.line,
      selectedFunctionId: this.currentFunctionId,
      selectedFaceNormal: this.currentFaceNormal ? this.formatDebugVector(this.currentFaceNormal) : null,
      codeLength: node.code.length,
    });
  }

  private hideFunctionEditor(): void {
    const previousNodeId = this.editorVisibleForNodeId;
    this.editorVisibleForNodeId = null;
    this.editorCurrentNodeId = null;
    this.editorCallButtons = [];
    this.editorScrollButtons = [];
    this.editorCurrentCodeLineCount = 0;
    this.editorCurrentCodeMaxLines = 0;
    this.lastEditorAttachmentSignature = null;
    if (this.functionEditorScreen) {
      this.functionEditorScreen.parent = null;
      this.functionEditorScreen.setEnabled(false);
    }
    if (previousNodeId) {
      console.log('🖥️ Editor hidden', { nodeId: previousNodeId });
    }
  }

  private drawFunctionEditorTexture(node: GraphNode): void {
    if (!this.functionEditorTexture) {
      return;
    }

    const width = EDITOR_TEXTURE_WIDTH;
    const height = EDITOR_TEXTURE_HEIGHT;
    const ctx = this.functionEditorTexture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(5, 9, 16, 0.98)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(188, 228, 255, 0.38)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    ctx.fillStyle = 'rgba(26, 38, 57, 0.95)';
    ctx.fillRect(16, 16, width - 32, 88);

    ctx.fillStyle = '#f6f9ff';
    ctx.font = '700 36px Consolas';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(node.name, 40, 34);

    const metaParts = [node.file ? toProjectRelativePath(node.file) : undefined, node.line ? `line ${node.line}` : undefined]
      .filter((part): part is string => Boolean(part));
    ctx.fillStyle = '#b3cae8';
    ctx.font = '25px Consolas';
    ctx.fillText(metaParts.join('  •  '), 40, 72);

    // High-contrast code body panel
    ctx.fillStyle = 'rgba(10, 16, 26, 0.98)';
    const codeAreaPanelX = 26;
    const codeAreaPanelY = 126;
    const codeAreaPanelWidth = width - 52;
    const codeAreaPanelHeight = height - 140;
    ctx.fillRect(codeAreaPanelX, codeAreaPanelY, codeAreaPanelWidth, codeAreaPanelHeight);
    ctx.strokeStyle = 'rgba(122, 168, 220, 0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(codeAreaPanelX, codeAreaPanelY, codeAreaPanelWidth, codeAreaPanelHeight);

    ctx.font = '24px Consolas';
    const codeAreaX = 40;
    const codeAreaY = 138;
    const codeAreaWidth = width - 140;
    const lineHeight = 31;
    const viewerConnections = collectCodeViewerConnections(node.id || '', this.currentGraphData, this.graphNodeMap);
    const { outgoingCalls, incomingCalls, externalCalls } = viewerConnections;
    const currentFilePath = node.file ? toProjectRelativePath(node.file) : '';
    const hasCallButtons = outgoingCalls.length > 0 || incomingCalls.length > 0 || externalCalls.length > 0;
    const reserveFooterHeight = hasCallButtons ? 280 : 30;
    const maxLines = Math.floor((height - codeAreaY - reserveFooterHeight) / lineHeight);
    const requestedStartLine = this.editorCodeScrollByNodeId.get(node.id || '') ?? 0;

    const codeRender = this.drawHighlightedCode(
      ctx,
      node.code || '',
      codeAreaX,
      codeAreaY,
      codeAreaWidth,
      lineHeight,
      maxLines,
      requestedStartLine,
    );
    this.editorCodeScrollByNodeId.set(node.id || '', codeRender.appliedStartLine);
    this.editorCurrentCodeLineCount = codeRender.totalLines;
    this.editorCurrentCodeMaxLines = Math.max(1, maxLines);
    this.drawCodeScrollControls(ctx, codeAreaX, codeAreaY, codeAreaWidth, lineHeight, maxLines, codeRender);
    this.editorCallButtons = drawCodeViewerConnectionButtons(
      ctx,
      outgoingCalls,
      incomingCalls,
      externalCalls,
      width,
      height,
      currentFilePath,
    );

    this.functionEditorTexture.update();
  }

  private handleEditorScreenClick(uv: BABYLON.Vector2): boolean {
    if (!this.editorCurrentNodeId) {
      return false;
    }

    // DynamicTexture is mirrored on U, so convert accordingly.
    const texX = (1 - uv.x) * EDITOR_TEXTURE_WIDTH;
    const texY = (1 - uv.y) * EDITOR_TEXTURE_HEIGHT;

    for (const btn of this.editorScrollButtons) {
      const inside = texX >= btn.x && texX <= (btn.x + btn.width)
        && texY >= btn.y && texY <= (btn.y + btn.height);
      if (!inside) {
        continue;
      }
      return this.applyEditorScrollAction(btn.action);
    }

    for (const btn of this.editorCallButtons) {
      const inside = texX >= btn.x && texX <= (btn.x + btn.width)
        && texY >= btn.y && texY <= (btn.y + btn.height);
      if (!inside) {
        continue;
      }

      const targetMesh = this.nodeMeshMap.get(btn.targetNodeId);
      if (!targetMesh) {
        return false;
      }

      const toViewer = this.getViewerWorldPosition().subtract(targetMesh.getAbsolutePosition());
      let faceNormal = new BABYLON.Vector3(0, 0, 1);
      const absX = Math.abs(toViewer.x);
      const absZ = Math.abs(toViewer.z);
      if (absX >= absZ) {
        faceNormal = new BABYLON.Vector3(toViewer.x >= 0 ? 1 : -1, 0, 0);
      } else {
        faceNormal = new BABYLON.Vector3(0, 0, toViewer.z >= 0 ? 1 : -1);
      }

      this.navigateToFunctionMesh(targetMesh, faceNormal);
      return true;
    }

    return this.focusCurrentEditorFaceCloseUp();
  }

  private focusCurrentEditorFaceCloseUp(): boolean {
    if (!this.editorCurrentNodeId) {
      return false;
    }

    const mesh = this.nodeMeshMap.get(this.editorCurrentNodeId);
    if (!mesh) {
      return false;
    }

    let faceNormal = this.currentFaceNormal?.clone() || new BABYLON.Vector3(0, 0, 1);
    faceNormal = this.coerceFaceNormalToSide(faceNormal, faceNormal);

    this.currentFunctionId = this.editorCurrentNodeId;
    this.currentFaceNormal = faceNormal.clone();
    this.flyToWorldPosition(mesh.getAbsolutePosition(), mesh, false, faceNormal);
    return true;
  }

  private flattenPrismTokens(
    tokens: Array<string | Prism.Token>,
    parentType = '',
  ): Array<{ type: string; text: string }> {
    const result: Array<{ type: string; text: string }> = [];
    for (const token of tokens) {
      if (typeof token === 'string') {
        if (token.length > 0) result.push({ type: parentType, text: token });
      } else {
        const content = token.content;
        if (typeof content === 'string') {
          result.push({ type: token.type, text: content });
        } else if (Array.isArray(content)) {
          result.push(...this.flattenPrismTokens(content as Array<string | Prism.Token>, token.type));
        }
      }
    }
    return result;
  }

  private drawHighlightedCode(
    ctx: CanvasRenderingContext2D,
    code: string,
    x: number,
    startY: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
    startLine: number,
  ): { totalLines: number; appliedStartLine: number } {
    const grammar = Prism.languages['typescript'] ?? Prism.languages['javascript'] ?? Prism.languages.clike;
    const rawTokens = Prism.tokenize(code, grammar) as Array<string | Prism.Token>;
    const flat = this.flattenPrismTokens(rawTokens);

    // Group flat token segments into source lines by splitting on \n
    const sourceLines: Array<Array<{ type: string; text: string }>> = [[]];
    for (const seg of flat) {
      const parts = seg.text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].length > 0) {
          sourceLines[sourceLines.length - 1].push({ type: seg.type, text: parts[i] });
        }
        if (i < parts.length - 1) {
          sourceLines.push([]);
        }
      }
    }

    const safeMaxLines = Math.max(1, maxLines);
    const maxStart = Math.max(0, sourceLines.length - safeMaxLines);
    const appliedStartLine = Math.max(0, Math.min(startLine, maxStart));

    let drawY = startY;
    let rendered = 0;
    for (let li = appliedStartLine; li < sourceLines.length && rendered < safeMaxLines; li++) {
      this.drawHighlightedLine(ctx, sourceLines[li], x, drawY, maxWidth);
      drawY += lineHeight;
      rendered++;
    }

    return {
      totalLines: sourceLines.length,
      appliedStartLine,
    };
  }

  private drawCodeScrollControls(
    ctx: CanvasRenderingContext2D,
    codeAreaX: number,
    codeAreaY: number,
    codeAreaWidth: number,
    lineHeight: number,
    maxLines: number,
    codeRender: { totalLines: number; appliedStartLine: number },
  ): void {
    this.editorScrollButtons = [];

    if (codeRender.totalLines <= maxLines) {
      return;
    }

    const buttonWidth = 38;
    const buttonHeight = 28;
    const scrollX = codeAreaX + codeAreaWidth + 12;
    const viewportHeight = Math.max(1, maxLines * lineHeight);
    const upY = codeAreaY + 4;
    const downY = codeAreaY + viewportHeight - buttonHeight - 4;

    const drawButton = (x: number, y: number, label: string): void => {
      ctx.fillStyle = 'rgba(56, 84, 128, 0.90)';
      ctx.fillRect(x, y, buttonWidth, buttonHeight);
      ctx.strokeStyle = 'rgba(182, 212, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, buttonWidth, buttonHeight);
      ctx.fillStyle = '#eef5ff';
      ctx.font = '700 20px Consolas';
      ctx.fillText(label, x + 11, y + 3);
    };

    drawButton(scrollX, upY, '↑');
    drawButton(scrollX, downY, '↓');

    this.editorScrollButtons.push({ x: scrollX, y: upY, width: buttonWidth, height: buttonHeight, action: 'up' });
    this.editorScrollButtons.push({ x: scrollX, y: downY, width: buttonWidth, height: buttonHeight, action: 'down' });

    const firstVisible = codeRender.appliedStartLine + 1;
    const lastVisible = Math.min(codeRender.totalLines, codeRender.appliedStartLine + maxLines);
    ctx.fillStyle = '#9fc1e8';
    ctx.font = '14px Consolas';
    const indicator = `${firstVisible}-${lastVisible}/${codeRender.totalLines}`;
    ctx.fillText(indicator, scrollX - 12, upY + buttonHeight + 8);
  }

  private applyEditorScrollAction(action: 'up' | 'down'): boolean {
    if (!this.editorCurrentNodeId) {
      return false;
    }

    const node = this.graphNodeMap.get(this.editorCurrentNodeId);
    if (!node || node.type !== 'function' || !node.code) {
      return false;
    }

    const current = this.editorCodeScrollByNodeId.get(node.id) ?? 0;
    const maxStart = Math.max(0, this.editorCurrentCodeLineCount - this.editorCurrentCodeMaxLines);
    const step = Math.max(1, Math.floor(this.editorCurrentCodeMaxLines * 0.35));
    const next = action === 'up'
      ? Math.max(0, current - step)
      : Math.min(maxStart, current + step);

    if (next === current) {
      return true;
    }

    this.editorCodeScrollByNodeId.set(node.id, next);
    this.drawFunctionEditorTexture(node);
    return true;
  }

  private drawHighlightedLine(
    ctx: CanvasRenderingContext2D,
    segs: Array<{ type: string; text: string }>,
    x: number,
    y: number,
    maxWidth: number,
  ): void {
    let curX = x;
    const ellipsisWidth = ctx.measureText('...').width;
    for (const seg of segs) {
      ctx.fillStyle = PRISM_TOKEN_COLORS[seg.type] ?? PRISM_DEFAULT_COLOR;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      const segWidth = ctx.measureText(seg.text).width;
      if (curX + segWidth <= x + maxWidth) {
        ctx.strokeText(seg.text, curX, y);
        ctx.fillText(seg.text, curX, y);
        curX += segWidth;
      } else {
        // Truncate this segment to fit with ellipsis
        let truncated = seg.text;
        while (truncated.length > 0 && curX + ctx.measureText(truncated).width + ellipsisWidth > x + maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        ctx.strokeText(truncated + '...', curX, y);
        ctx.fillText(truncated + '...', curX, y);
        return;
      }
    }
  }

  private getPreferredEditorFaceNormal(nodeId: string, hostMesh: BABYLON.Mesh): BABYLON.Vector3 {
    if (this.currentFunctionId === nodeId && this.currentFaceNormal) {
      return this.currentFaceNormal.clone();
    }

    const viewerWorldPos = this.getViewerWorldPosition();
    let fallback = viewerWorldPos.subtract(hostMesh.getAbsolutePosition());
    if (!Number.isFinite(fallback.length()) || fallback.lengthSquared() < 0.000001) {
      fallback = new BABYLON.Vector3(0, 0, 1);
    }
    return fallback;
  }

  private attachEditorScreenToVisibleFace(hostMesh: BABYLON.Mesh, boxSize: number, nodeId: string): void {
    if (!this.functionEditorScreen) {
      return;
    }

    const screen = this.functionEditorScreen;
    const faceNormal = this.getPreferredEditorFaceNormal(nodeId, hostMesh);

    const absX = Math.abs(faceNormal.x);
    const absY = Math.abs(faceNormal.y);
    const absZ = Math.abs(faceNormal.z);
    const half = boxSize * 0.5;
    const offset = Math.max(0.14, boxSize * 0.045);

    let position = new BABYLON.Vector3(0, 0, half + offset);
    let rotation = BABYLON.Vector3.Zero();

    // Explicit per-face transforms keep the editor plane coplanar with each face.
    if (absX >= absY && absX >= absZ) {
      if (faceNormal.x >= 0) {
        position = new BABYLON.Vector3(half + offset, 0, 0);
        rotation = new BABYLON.Vector3(0, Math.PI / 2, 0);
      } else {
        position = new BABYLON.Vector3(-(half + offset), 0, 0);
        rotation = new BABYLON.Vector3(0, -Math.PI / 2, 0);
      }
    } else if (absY >= absX && absY >= absZ) {
      if (faceNormal.y >= 0) {
        position = new BABYLON.Vector3(0, half + offset, 0);
        rotation = new BABYLON.Vector3(-Math.PI / 2, 0, 0);
      } else {
        position = new BABYLON.Vector3(0, -(half + offset), 0);
        rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0);
      }
    } else if (faceNormal.z < 0) {
      position = new BABYLON.Vector3(0, 0, -(half + offset));
      rotation = new BABYLON.Vector3(0, Math.PI, 0);
    }

    screen.parent = hostMesh;
    screen.position = position;
    // Clear quaternion so Euler rotations apply deterministically.
    screen.rotationQuaternion = null;
    screen.rotation = rotation;
    screen.scaling = new BABYLON.Vector3(
      boxSize * EDITOR_WORLD_WIDTH_SCALE,
      boxSize * EDITOR_WORLD_HEIGHT_SCALE,
      1,
    );
    (screen as any).editorHostNodeId = nodeId;

    const attachmentSignature = [
      nodeId,
      position.x.toFixed(3),
      position.y.toFixed(3),
      position.z.toFixed(3),
      rotation.x.toFixed(3),
      rotation.y.toFixed(3),
      rotation.z.toFixed(3),
    ].join('|');
    if (attachmentSignature !== this.lastEditorAttachmentSignature) {
      this.lastEditorAttachmentSignature = attachmentSignature;
      console.log('🖥️ Editor screen attached', {
        nodeId,
        faceNormal: this.formatDebugVector(faceNormal),
        localPosition: this.formatDebugVector(position),
        localRotation: this.formatDebugVector(rotation),
        boxSize: Number(boxSize.toFixed(3)),
      });
    }
  }

  private getViewerWorldPosition(): BABYLON.Vector3 {
    const activeCamera = this.scene.activeCamera || this.camera;
    const activeGlobal = (activeCamera as any)?.globalPosition as BABYLON.Vector3 | undefined;
    if (activeGlobal && Number.isFinite(activeGlobal.x) && Number.isFinite(activeGlobal.y) && Number.isFinite(activeGlobal.z)) {
      return activeGlobal.clone();
    }
    return activeCamera.position.clone();
  }

  private getFocusedFilePath(): string | null {
    const selectedNodeId = this.editorVisibleForNodeId || this.currentFunctionId;
    if (selectedNodeId) {
      const selectedNode = this.graphNodeMap.get(selectedNodeId);
      if (selectedNode?.file) {
        return toProjectRelativePath(selectedNode.file);
      }
    }

    return null;
  }

  private buildFocusedDirectoryChain(filePath: string | null): Set<string> {
    const chain = new Set<string>();
    if (!filePath) {
      return chain;
    }

    let current = getDirectoryPath(filePath);
    chain.add(current);
    while (current) {
      current = getParentDirectoryPath(current);
      chain.add(current);
    }

    return chain;
  }

  private applySceneDeclutter(): void {
    const focusedFile = this.getFocusedFilePath();
    const focusedDirectories = this.buildFocusedDirectoryChain(focusedFile);
    const signature = `${focusedFile ?? 'none'}|${Array.from(focusedDirectories).sort().join(',')}|${this.labelsVisible ? 'labels' : 'nolabels'}`;

    if (signature === this.lastDeclutterSignature && !this.isAnimating) {
      this.meshFactory.setDeclutterContext(focusedFile, focusedDirectories);
      return;
    }

    this.lastDeclutterSignature = signature;
    this.meshFactory.setDeclutterContext(focusedFile, focusedDirectories);

    for (const [file, box] of this.fileBoxMeshes.entries()) {
      const relativeFile = toProjectRelativePath(file);
      const fileDir = getDirectoryPath(relativeFile);
      const material = box.material as BABYLON.StandardMaterial | null;
      const isFocused = focusedFile !== null && relativeFile === focusedFile;
      const isContext = focusedFile !== null && focusedDirectories.has(fileDir);

      box.visibility = isFocused
        ? SceneConfig.DECLUTTER_FOCUS_VISIBILITY
        : isContext
          ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
          : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY;

      if (material) {
        material.alpha = isFocused
          ? SceneConfig.DECLUTTER_ACTIVE_FILE_BOX_ALPHA
          : isContext
            ? SceneConfig.DECLUTTER_CONTEXT_FILE_BOX_ALPHA
            : SceneConfig.DECLUTTER_BACKGROUND_FILE_BOX_ALPHA;
      }
    }

    for (const [dir, box] of this.directoryBoxMeshes.entries()) {
      const relativeDir = toProjectRelativePath(dir);
      const showBox = focusedFile === null || focusedDirectories.has(relativeDir);
      box.setEnabled(showBox);
      box.visibility = showBox
        ? (focusedFile !== null && relativeDir === getDirectoryPath(focusedFile)
          ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
          : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY)
        : SceneConfig.DECLUTTER_HIDDEN_VISIBILITY;

      const material = box.material as BABYLON.StandardMaterial | null;
      if (material) {
        material.alpha = focusedFile !== null && relativeDir === getDirectoryPath(focusedFile)
          ? SceneConfig.DECLUTTER_ACTIVE_DIRECTORY_BOX_ALPHA
          : SceneConfig.DECLUTTER_CONTEXT_DIRECTORY_BOX_ALPHA;
      }
    }

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node) {
        continue;
      }

      const relativeFile = node.file ? toProjectRelativePath(node.file) : null;
      const fileDir = relativeFile ? getDirectoryPath(relativeFile) : '';
      const isFocusedNode = focusedFile !== null && relativeFile === focusedFile;
      const isContextNode = focusedFile !== null && focusedDirectories.has(fileDir);
      const isExternalOrVariable = node.type === 'external' || node.type === 'variable';
      const shouldHide = focusedFile !== null && isExternalOrVariable && !isFocusedNode;

      mesh.setEnabled(!shouldHide);
      mesh.isVisible = !shouldHide;
      mesh.visibility = shouldHide
        ? SceneConfig.DECLUTTER_HIDDEN_VISIBILITY
        : isFocusedNode
          ? SceneConfig.DECLUTTER_FOCUS_VISIBILITY
          : isContextNode
            ? SceneConfig.DECLUTTER_CONTEXT_VISIBILITY
            : SceneConfig.DECLUTTER_BACKGROUND_VISIBILITY;

      const material = mesh.material as BABYLON.StandardMaterial | null;
      if (material) {
        material.alpha = shouldHide
          ? 0.0
          : isFocusedNode
            ? 1.0
            : isContextNode
              ? 0.78
              : 0.18;
        material.transparencyMode = material.alpha >= 0.999
          ? BABYLON.Material.MATERIAL_OPAQUE
          : BABYLON.Material.MATERIAL_ALPHABLEND;
      }
    }

    for (const [file, label] of this.fileBoxLabels.entries()) {
      const relativeFile = toProjectRelativePath(file);
      const shouldShow = this.labelsVisible && (focusedFile === null || relativeFile === focusedFile || focusedDirectories.has(getDirectoryPath(relativeFile)));
      this.setBreadcrumbAnchorInteractivity(label, shouldShow);
      label.visibility = shouldShow ? 1 : 0;
    }

    for (const [dir, label] of this.directoryBoxLabels.entries()) {
      const relativeDir = toProjectRelativePath(dir);
      const shouldShow = this.labelsVisible && (focusedFile === null || focusedDirectories.has(relativeDir));
      this.setBreadcrumbAnchorInteractivity(label, shouldShow);
      label.visibility = shouldShow ? 1 : 0;
    }
  }

  private findNearbyFunctionForEditor(): GraphNode | null {
    const viewerWorldPos = this.getViewerWorldPosition();

    if (this.currentFunctionId) {
      const selectedNode = this.graphNodeMap.get(this.currentFunctionId);
      const selectedMesh = this.nodeMeshMap.get(this.currentFunctionId);
      if (selectedNode && selectedMesh && selectedNode.type === 'function' && selectedNode.code && selectedMesh.isEnabled() && selectedMesh.isVisible) {
        // Keep the editor pinned to the selected function while selection is active.
        // This prevents flicker/hide when camera or scene-root transitions briefly
        // move outside distance thresholds during face changes.
        return selectedNode;
      }
    }

    let closestNode: GraphNode | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.type !== 'function' || !node.code || !mesh.isEnabled() || !mesh.isVisible) {
        continue;
      }

      const radius = mesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
      const activationDistance = Math.max(12, radius + 6);
      const distance = BABYLON.Vector3.Distance(viewerWorldPos, mesh.getAbsolutePosition());
      if (distance > activationDistance || distance >= closestDistance) {
        continue;
      }

      closestDistance = distance;
      closestNode = node;
    }

    return closestNode;
  }

  private updateFunctionEditorProximity(): void {
    const nearbyNode = this.findNearbyFunctionForEditor();
    if (!nearbyNode) {
      if (this.editorVisibleForNodeId !== null) {
        this.hideFunctionEditor();
      }
      return;
    }

    if (this.editorVisibleForNodeId === nearbyNode.id) {
      const hostMesh = this.nodeMeshMap.get(nearbyNode.id);
      if (hostMesh && this.functionEditorScreen) {
        const meshAny = hostMesh as any;
        const boxSize = typeof meshAny.boxSize === 'number'
          ? meshAny.boxSize
          : Math.max(1.0, (hostMesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);
        this.attachEditorScreenToVisibleFace(hostMesh, boxSize, nearbyNode.id);
      }
      return;
    }

    // Ensure a clean redraw whenever the editor switches to a different function.
    if (this.editorVisibleForNodeId && this.editorVisibleForNodeId !== nearbyNode.id) {
      this.hideFunctionEditor();
    }

    this.showFunctionEditor(nearbyNode);
  }

  private async setupWebXR(): Promise<void> {
    this.setXRLoadingPanelVisible(false);
    try {
      const xrNavigator = (navigator as any).xr as {
        isSessionSupported?: (mode: string) => Promise<boolean>;
      } | undefined;

      if (!xrNavigator || typeof xrNavigator.isSessionSupported !== 'function') {
        console.log('WebXR API not available in this browser context; running desktop mode.');
        return;
      }

      const supportsImmersiveVR = await xrNavigator.isSessionSupported('immersive-vr');
      if (!supportsImmersiveVR) {
        console.log('WebXR immersive-vr is not supported here; running desktop mode.');
        return;
      }

      this.xrExperience = await this.scene.createDefaultXRExperienceAsync();
      console.log('WebXR experience created successfully');

      // Initialize Quest 3 Grip Controller (sole input handler for VR)
      this.gripController = new Quest3GripController(this.scene);
      
      // Setup VR controller input
      const xrInput = this.xrExperience.input;
      
      // Initialize grip controller from XR input
      this.gripController.initializeFromXRInput(xrInput);
      
      // Register grip gesture callback
      this.gripController.onGripGesture((gesture) => {
        this.handleGripGesture(gesture);
      });

      // Log when controllers connect/disconnect
      xrInput.onControllerAddedObservable.add((controller) => {
        console.log(`VR Controller connected: ${controller.inputSource.handedness}`);
      });

      xrInput.onControllerRemovedObservable.add((controller) => {
        console.log(`VR Controller disconnected: ${controller.inputSource.handedness}`);
      });

      this.xrExperience.baseExperience.onStateChangedObservable.add((state) => {
        if (this.xrLoadingHideTimer !== null) {
          window.clearTimeout(this.xrLoadingHideTimer);
          this.xrLoadingHideTimer = null;
        }

        if (state === BABYLON.WebXRState.ENTERING_XR) {
          // ENTERING_XR is still mirrored on desktop canvas, so keep panel hidden here.
          this.setXRLoadingPanelVisible(false);
          return;
        }

        if (state === BABYLON.WebXRState.IN_XR) {
          this.recenterGraphInFrontOfXRCamera();

          // Show briefly once the session is actually in-headset.
          this.setXRLoadingPanelVisible(true);
          this.xrLoadingHideTimer = window.setTimeout(() => {
            this.setXRLoadingPanelVisible(false);
            this.xrLoadingHideTimer = null;
          }, 1200);
          return;
        }

        if (state === BABYLON.WebXRState.NOT_IN_XR) {
          this.setXRLoadingPanelVisible(false);
        }
      });

      this.setXRLoadingPanelVisible(false);
    } catch (error) {
      this.setXRLoadingPanelVisible(false);
      console.warn('WebXR not available or failed to initialize:', error);
    }
  }

  private recenterGraphInFrontOfXRCamera(): void {
    const activeCamera = this.scene.activeCamera || this.camera;
    if (!activeCamera) {
      return;
    }

    const activeGlobal = (activeCamera as any).globalPosition as BABYLON.Vector3 | undefined;
    const cameraWorldPos = (activeGlobal && Number.isFinite(activeGlobal.x))
      ? activeGlobal.clone()
      : activeCamera.position.clone();

    let forward = activeCamera.getForwardRay(1).direction;
    if (!Number.isFinite(forward.length()) || forward.lengthSquared() < 0.000001) {
      forward = new BABYLON.Vector3(0, 0, 1);
    }
    // Keep recentering on horizontal plane to avoid placing graph too high/low.
    forward.y = 0;
    if (forward.lengthSquared() < 0.000001) {
      forward = new BABYLON.Vector3(0, 0, 1);
    }
    forward.normalize();

    const desiredDistance = 22;
    const desiredCenterWorld = cameraWorldPos.add(forward.scale(desiredDistance));

    // Estimate current graph center from visible function nodes.
    let sum = BABYLON.Vector3.Zero();
    let count = 0;
    for (const [nodeId, mesh] of this.nodeMeshMap.entries()) {
      const node = this.graphNodeMap.get(nodeId);
      if (!node || node.type === 'variable' || node.type === 'external') {
        continue;
      }
      if (!mesh.isEnabled() || !mesh.isVisible) {
        continue;
      }
      sum = sum.add(mesh.getAbsolutePosition());
      count++;
    }
    if (count === 0) {
      return;
    }

    const currentCenterWorld = sum.scale(1 / count);
    const delta = desiredCenterWorld.subtract(currentCenterWorld);
    this.sceneRoot.position.addInPlace(delta);

    this.logXRNavigationDebug('xr-recenter:on-entry', {
      cameraWorldPos: this.formatDebugVector(cameraWorldPos),
      desiredCenterWorld: this.formatDebugVector(desiredCenterWorld),
      currentCenterWorld: this.formatDebugVector(currentCenterWorld),
      sceneRootDelta: this.formatDebugVector(delta),
      sceneRootAfter: this.formatDebugVector(this.sceneRoot.position),
      nodeCount: count,
    });
  }

  /**
   * Handle grip gestures from Quest 3 controllers
   */
  private handleGripGesture(gesture: GripGesture): void {
    console.log(`🎮 Grip Gesture: ${gesture.hand} - ${gesture.type} (intensity: ${gesture.intensity})`);
    
    if (!this.gripController) return;
    
    const gripState = this.gripController.getGripState(gesture.hand);
    
    switch (gesture.type) {
      case 'grab':
        // On grip press, try to grab a nearby object
        this.attemptGrabObject(gesture.hand, gripState);
        break;

      case 'press':
        // Trigger press teleports to the targeted function mesh.
        this.attemptTeleportToFunction(gesture.hand, gripState);
        break;
        
      case 'release':
        // On grip release, release any held objects
        this.releaseHeldObjects(gesture.hand);
        break;
        
      case 'manipulate':
        // On grip pressure change, update held object positions
        this.updateHeldObjectPositions(gesture.hand, gripState);
        break;

      case 'menu':
        this.toggleLabelsVisibility();
        break;
        
      default:
        break;
    }
  }

  private toggleLabelsVisibility(): void {
    this.setLabelsVisibility(!this.labelsVisible);

    console.log(`🏷️ Navigation labels ${this.labelsVisible ? 'shown' : 'hidden'} via secondary/menu button`);
  }

  private setBreadcrumbAnchorInteractivity(labelAnchor: BABYLON.Mesh, enabled: boolean): void {
    labelAnchor.setEnabled(enabled);
    labelAnchor.isPickable = false;

    for (const child of labelAnchor.getChildMeshes(false)) {
      child.isPickable = enabled;
    }
  }

  private setLabelsVisibility(visible: boolean): void {
    this.labelsVisible = visible;

    if (!this.labelsVisible) {
      this.clearBreadcrumbHoverState();
    }

    for (const label of this.fileBoxLabels.values()) {
      this.setBreadcrumbAnchorInteractivity(label, this.labelsVisible);
    }
    for (const label of this.directoryBoxLabels.values()) {
      this.setBreadcrumbAnchorInteractivity(label, this.labelsVisible);
    }
  }

  public toggleNavigationLabels(): void {
    this.toggleLabelsVisibility();
  }

  public setNavigationLabelsVisible(visible: boolean): void {
    this.setLabelsVisibility(visible);
  }

  public areNavigationLabelsVisible(): boolean {
    return this.labelsVisible;
  }

  /**
   * Rebuild the exported function layout to bring them closer to file box surfaces
   */
  public rebuildExportedFunctionLayout(): void {
    if (!this.currentGraphData || this.fileBoxMeshes.size === 0) {
      return;
    }

    console.log('🔄 Rebuilding exported function layout...');

    // Re-run exported function positioning
    if (this.useLegacyExportedFaceLayout) {
      this.placeExportedFunctionsOnOptimalFace();
      this.spreadExportedFunctionsOnFaces(12);
      this.pullInternalNodesToExportedFace();
      this.rerunInternalLayoutsAfterExportPlacement(120);
      this.resizeAndResolveAfterInternalRelayout();
      this.resolveNodeEdgeObstructions(20);
      this.resolveExportedFaceEdgeObstructions(15);
      this.spreadExportedFunctionsOnFaces(8);
      this.resolveFunctionLabelObstructions(12);
    }

    // Resolve any remaining collisions
    this.resolveInitialFileBoxOverlaps(6);
    this.enforceMinimumFileBoxGap(28.0, 4);
    this.enforceTopLevelDirectoryGap(36.0, 2);

    // Refresh labels after repositioning
    this.refreshLabelTransformsIfScaleChanged(true);

    // Update edges for new positions
    this.clearEdgesAndRender();

    console.log('✓ Exported function layout rebuilt');
  }

  private clearEdgesAndRender(): void {
    // Clear and re-render edges
    this.meshFactory.clearEdges();
    if (this.currentGraphData) {
      this.populateCurrentEdges(this.currentGraphData);
      this.resolveEdgeObstructions(30);
      this.resolveNodeEdgeObstructions(20);
      this.renderEdges();
      this.meshFactory.updateEdges();
    }
  }

  /**
   * Navigate to a function mesh with face-aware logic used by desktop and VR.
   */
  private navigateToFunctionMesh(targetMesh: BABYLON.Mesh, faceNormal: BABYLON.Vector3): void {
    const clickedNode = (targetMesh as any).nodeData as GraphNode | undefined;
    if (!clickedNode) {
      return;
    }

    if (clickedNode.type === 'variable') {
      this.currentFunctionId = null;
      this.currentFaceNormal = null;
      this.flyToWorldPosition(targetMesh.getAbsolutePosition(), targetMesh);
      return;
    }

    if (clickedNode.type === 'external') {
      this.currentFunctionId = null;
      this.currentFaceNormal = null;
      this.flyToWorldPosition(targetMesh.getAbsolutePosition(), targetMesh);
      return;
    }

    console.log('🎯 Function face selected', {
      nodeId: clickedNode.id,
      name: clickedNode.name,
      faceNormal: this.formatDebugVector(faceNormal),
      currentFunctionId: this.currentFunctionId,
      currentFaceNormal: this.currentFaceNormal ? this.formatDebugVector(this.currentFaceNormal) : null,
    });

    const isSameFunction = clickedNode.id === this.currentFunctionId;
    const isSameFace = isSameFunction && this.isFaceNormalEqual(faceNormal, this.currentFaceNormal);

    if (isSameFace) {
      // Keep editor stable when the same face is clicked again.
      if (this.editorVisibleForNodeId === clickedNode.id) {
        return;
      }
      // Same face clicked again - slide to show that face
      this.slideFaceView(targetMesh.getAbsolutePosition(), faceNormal, targetMesh);
    } else if (isSameFunction) {
      // Different face of same function - slide to new face
      this.currentFaceNormal = faceNormal.clone();
      this.slideFaceView(targetMesh.getAbsolutePosition(), faceNormal, targetMesh);
    } else {
      // Different function - jump to it, positioning camera orthogonally to clicked face
      this.currentFunctionId = clickedNode.id;
      this.currentFaceNormal = faceNormal.clone();

      // Refresh editor content immediately for the newly selected function box.
      // This prevents stale code text/buttons from the previous selection.
      if (clickedNode.type === 'function' && clickedNode.code) {
        if (this.editorVisibleForNodeId && this.editorVisibleForNodeId !== clickedNode.id) {
          this.hideFunctionEditor();
        }
        this.showFunctionEditor(clickedNode);
      }

      this.flyToWorldPosition(targetMesh.getAbsolutePosition(), targetMesh, false, faceNormal);
    }
  }

  /**
   * Teleport/navigate to the interactive mesh currently targeted by the VR
   * controller ray (function node, edge, or file/directory label).
   */
  private attemptTeleportToFunction(hand: 'left' | 'right', gripState: GripState): void {
    if (this.isAnimating) {
      return;
    }

    const now = performance.now();
    const TELEPORT_DEBOUNCE_MS = 250;
    if (now - this.lastTeleportAtByHand[hand] < TELEPORT_DEBOUNCE_MS) {
      return;
    }
    this.lastTeleportAtByHand[hand] = now;

    const ray = new BABYLON.Ray(gripState.position, gripState.direction, 2000);
    const hits = this.scene.multiPickWithRay(ray, (mesh) => {
      if (!mesh.isPickable) return false;
      const meshAny = mesh as any;
      return meshAny.nodeData !== undefined
        || meshAny.edgeData !== undefined
        || meshAny.labelData !== undefined;
    }) || [];

    const interactiveHits = hits.filter((h) => h?.hit && h.pickedMesh);
    if (interactiveHits.length === 0) {
      return;
    }

    const hit = this.selectPrioritizedInteractiveHit(interactiveHits) || interactiveHits[0];

    if (this.functionEditorScreen && hit.pickedMesh === this.functionEditorScreen) {
      const uv = hit.getTextureCoordinates();
      if (uv) {
        this.handleEditorScreenClick(uv);
      }
      return;
    }

    const pickedMesh = hit.pickedMesh as BABYLON.Mesh;
    const pickedPoint = hit.pickedPoint || pickedMesh.getAbsolutePosition();
    const pickedEdge = (pickedMesh as any).edgeData as { from: string; to: string } | undefined;
    const pickedLabel = (pickedMesh as any).labelData as { kind: 'file' | 'directory'; path: string } | undefined;

    this.logXRNavigationDebug('teleport:pick', {
      meshName: pickedMesh.name,
      isNode: (pickedMesh as any).nodeData !== undefined,
      isEdge: pickedEdge !== undefined,
      isLabel: pickedLabel !== undefined,
      pickedPoint: this.formatDebugVector(pickedPoint),
      meshWorldPos: this.formatDebugVector(pickedMesh.getAbsolutePosition()),
      rayOrigin: this.formatDebugVector(gripState.position),
      rayDirection: this.formatDebugVector(gripState.direction),
      hitDistance: Number(((hit as any).distance ?? 0).toFixed(3)),
    });

    if (pickedEdge) {
      const fromMesh = this.nodeMeshMap.get(pickedEdge.from);
      const toMesh = this.nodeMeshMap.get(pickedEdge.to);
      if (!fromMesh || !toMesh) {
        return;
      }

      const fromPos = fromMesh.getAbsolutePosition();
      const toPos = toMesh.getAbsolutePosition();
      const nearSource = BABYLON.Vector3.DistanceSquared(pickedPoint, fromPos)
        <= BABYLON.Vector3.DistanceSquared(pickedPoint, toPos);

      const destinationMesh = nearSource ? toMesh : fromMesh;
      const destinationId = nearSource ? pickedEdge.to : pickedEdge.from;

      this.currentFunctionId = destinationId;
      this.currentFaceNormal = null;
      this.logXRNavigationDebug('teleport:edge-destination', {
        fromId: pickedEdge.from,
        toId: pickedEdge.to,
        destinationId,
        destinationWorldPos: this.formatDebugVector(destinationMesh.getAbsolutePosition()),
      });
      this.flyToWorldPosition(destinationMesh.getAbsolutePosition(), destinationMesh);
      return;
    }

    if (pickedLabel) {
      this.currentFunctionId = null;
      this.currentFaceNormal = null;
      const targetLabel = this.resolveBreadcrumbNavigationTarget(pickedLabel.kind, pickedLabel.path, pickedMesh);
      this.logXRNavigationDebug('teleport:label-destination', {
        labelKind: pickedLabel.kind,
        labelPath: pickedLabel.path,
        destinationWorldPos: this.formatDebugVector(targetLabel.getAbsolutePosition()),
      });
      this.flyToWorldPosition(targetLabel.getAbsolutePosition(), targetLabel, 12);
      return;
    }

    let faceNormal = hit.getNormal(true) || new BABYLON.Vector3(0, 0, 1);
    faceNormal = this.quantizeFaceNormalFromPickedPoint(pickedMesh, pickedPoint, faceNormal);

    this.logXRNavigationDebug('teleport:node-destination', {
      nodeId: ((pickedMesh as any).nodeData as GraphNode | undefined)?.id ?? 'unknown',
      destinationWorldPos: this.formatDebugVector(pickedMesh.getAbsolutePosition()),
      faceNormal: this.formatDebugVector(faceNormal),
    });

    this.navigateToFunctionMesh(pickedMesh, faceNormal);
  }

  /**
   * Attempt to grab an object with a hand based on grip ray
   */
  private attemptGrabObject(hand: 'left' | 'right', gripState: GripState): void {
    // Cast a ray from the grip position forward
    const origin = gripState.position;
    const direction = gripState.direction;
    const length = this.gripController?.getMaxGripDistance() || 5.0;
    
    const ray = new BABYLON.Ray(origin, direction, length);
    
    // Pick objects that can be grabbed
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      const nodeData = (mesh as any).nodeData as GraphNode | undefined;
      return mesh.isPickable && nodeData !== undefined;
    });
    
    if (hit && hit.hit && hit.pickedMesh) {
      const mesh = hit.pickedMesh as BABYLON.Mesh;
      this.gripController?.grabObject(hand, mesh);
      console.log(`✋ Grabbed object: ${mesh.name} (${hand})`);
    }
  }

  /**
   * Release objects held by a hand
   */
  private releaseHeldObjects(hand: 'left' | 'right'): void {
    if (!this.gripController) return;
    
    const heldObjects = this.gripController.getHeldObjects(hand);
    if (heldObjects.size > 0) {
      console.log(`🔓 Released ${heldObjects.size} object(s) from ${hand} hand`);
      this.gripController.releaseObject(hand);
    }
  }

  /**
   * Update positions of held objects based on grip movement
   */
  private updateHeldObjectPositions(hand: 'left' | 'right', gripState: GripState): void {
    if (!this.gripController) return;
    
    const heldObjects = this.gripController.getHeldObjects(hand);
    if (heldObjects.size === 0) return;
    
    const gripVelocity = this.gripController.getGripVelocity(hand);
    
    for (const mesh of heldObjects) {
      // Move held object with the grip position
      mesh.position = gripState.position.clone();
      
      // Apply grip velocity for physics-based interaction
      if ((mesh as any).physicsImpostor) {
        const newVel = gripVelocity.scale(0.01); // Scale down for reasonable physics
        (mesh as any).physicsImpostor.setLinearVelocity(newVel);
      }
    }
  }

  public run(): void {
    this.engine.runRenderLoop(() => {
      this.applySceneDeclutter();
      // Update edge cylinders each frame
      this.meshFactory.updateEdges();
      this.updateFunctionEditorProximity();
      this.scene.render();
    });
  }

  public dispose(): void {
    if (this.xrLoadingHideTimer !== null) {
      window.clearTimeout(this.xrLoadingHideTimer);
      this.xrLoadingHideTimer = null;
    }
    this.xrLoadingPanel?.dispose(false, true);
    this.xrLoadingTexture?.dispose();
    this.functionEditorScreen?.dispose(false, true);
    this.functionEditorMaterial?.dispose();
    this.functionEditorTexture?.dispose();
    this.functionEditorScreen = null;
    this.functionEditorMaterial = null;
    this.functionEditorTexture = null;
    this.scene.dispose();
    this.engine.dispose();
  }
}
