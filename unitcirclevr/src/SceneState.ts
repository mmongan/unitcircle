import * as BABYLON from '@babylonjs/core';
import type { GraphData, GraphEdge, GraphNode } from './types';
import type { ForceDirectedLayout } from './ForceDirectedLayout';

/**
 * Shared mutable scene state passed by reference to all sub-services.
 * Mutations made by one service are immediately visible to all others.
 */
export interface SceneState {
  // ── Graph data ──────────────────────────────────────────────────────────────
  currentGraphData: GraphData | null;
  graphNodeMap: Map<string, GraphNode>;
  currentEdges: Set<string>;
  currentEdgeKinds: Map<string, GraphEdge['kind']>;

  // ── Node / file topology ────────────────────────────────────────────────────
  nodeMeshMap: Map<string, BABYLON.Mesh>;
  nodeToFile: Map<string, string>;
  fileNodeIds: Map<string, Set<string>>;
  fileBoxMeshes: Map<string, BABYLON.Mesh>;
  directoryBoxMeshes: Map<string, BABYLON.Mesh>;

  // ── Layout engines ──────────────────────────────────────────────────────────
  fileLayout: ForceDirectedLayout | null;
  fileInternalLayouts: Map<string, ForceDirectedLayout>;

  // ── Physics loop ────────────────────────────────────────────────────────────
  physicsActive: boolean;
  physicsIterationCount: number;
  physicsLoopInitialized: boolean;

  // ── Labels ──────────────────────────────────────────────────────────────────
  fileBoxLabels: Map<string, BABYLON.Mesh>;
  directoryBoxLabels: Map<string, BABYLON.Mesh>;
  fileLabelLookup: Map<string, BABYLON.Mesh>;
  directoryLabelLookup: Map<string, BABYLON.Mesh>;
  lastFileBoxScales: Map<string, BABYLON.Vector3>;
  lastDirectoryBoxScales: Map<string, BABYLON.Vector3>;
  labelScaleState: Map<number, number>;
  labelsVisible: boolean;
  labelCollisionTick: number;

  // ── Navigation state ────────────────────────────────────────────────────────
  currentFunctionId: string | null;
  currentFaceNormal: BABYLON.Vector3 | null;
  isAnimating: boolean;
  flyObserver: BABYLON.Observer<BABYLON.Scene> | null;
  desktopStartupRecenterDone: boolean;

  // ── Color cache ─────────────────────────────────────────────────────────────
  fileColorMap: Map<string, BABYLON.Color3>;

  // ── Hover / interaction ─────────────────────────────────────────────────────
  hoveredBreadcrumbChip: BABYLON.Mesh | null;

  // ── Function editor ─────────────────────────────────────────────────────────
  editorVisibleForNodeId: string | null;
  functionEditorScreen: BABYLON.Mesh | null;
  functionEditorTexture: BABYLON.DynamicTexture | null;
  functionEditorMaterial: BABYLON.StandardMaterial | null;
  editorCurrentNodeId: string | null;
  editorCallButtons: Array<{ x: number; y: number; width: number; height: number; targetNodeId: string }>;
  editorScrollButtons: Array<{ x: number; y: number; width: number; height: number; action: 'up' | 'down' }>;
  editorCodeScrollByNodeId: Map<string, number>;
  editorCurrentCodeLineCount: number;
  editorCurrentCodeMaxLines: number;
  lastEditorAttachmentSignature: string | null;

  // ── XR loading panel ────────────────────────────────────────────────────────
  xrLoadingPanel: BABYLON.Mesh | null;
  xrLoadingTexture: BABYLON.DynamicTexture | null;
  xrLoadingVisible: boolean;
  xrLoadingHideTimer: number | null;

  // ── VR flight / locomotion ──────────────────────────────────────────────────
  flightSpeed: number;
  keysPressed: Map<string, boolean>;
  isFlying: boolean;
  lastTeleportAtByHand: Record<'left' | 'right', number>;

  // ── Feature flags (read-only after construction) ────────────────────────────
  xrNavigationDebug: boolean;
  exportedFaceCircleLayout: boolean;
  useLegacyExportedFaceLayout: boolean;

  // ── Graph polling ───────────────────────────────────────────────────────────
  graphUpdateInProgress: boolean;
  lastGraphReloadAtMs: number;
}

/** Construct a `SceneState` with every field initialised to its empty / false default. */
export function createSceneState(): SceneState {
  return {
    currentGraphData: null,
    graphNodeMap: new Map(),
    currentEdges: new Set(),
    currentEdgeKinds: new Map(),

    nodeMeshMap: new Map(),
    nodeToFile: new Map(),
    fileNodeIds: new Map(),
    fileBoxMeshes: new Map(),
    directoryBoxMeshes: new Map(),

    fileLayout: null,
    fileInternalLayouts: new Map(),

    physicsActive: false,
    physicsIterationCount: 0,
    physicsLoopInitialized: false,

    fileBoxLabels: new Map(),
    directoryBoxLabels: new Map(),
    fileLabelLookup: new Map(),
    directoryLabelLookup: new Map(),
    lastFileBoxScales: new Map(),
    lastDirectoryBoxScales: new Map(),
    labelScaleState: new Map(),
    labelsVisible: false,
    labelCollisionTick: 0,

    currentFunctionId: null,
    currentFaceNormal: null,
    isAnimating: false,
    flyObserver: null,
    desktopStartupRecenterDone: false,

    fileColorMap: new Map(),
    hoveredBreadcrumbChip: null,

    editorVisibleForNodeId: null,
    functionEditorScreen: null,
    functionEditorTexture: null,
    functionEditorMaterial: null,
    editorCurrentNodeId: null,
    editorCallButtons: [],
    editorScrollButtons: [],
    editorCodeScrollByNodeId: new Map(),
    editorCurrentCodeLineCount: 0,
    editorCurrentCodeMaxLines: 0,
    lastEditorAttachmentSignature: null,

    xrLoadingPanel: null,
    xrLoadingTexture: null,
    xrLoadingVisible: false,
    xrLoadingHideTimer: null,

    flightSpeed: 100,
    keysPressed: new Map(),
    isFlying: false,
    lastTeleportAtByHand: { left: 0, right: 0 },

    xrNavigationDebug: ((import.meta.env.VITE_XR_NAV_DEBUG ?? 'false').toLowerCase() === 'true'),
    exportedFaceCircleLayout: ((import.meta.env.VITE_EXPORTED_FACE_CIRCLE ?? 'false').toLowerCase() === 'true'),
    useLegacyExportedFaceLayout: ((import.meta.env.VITE_LEGACY_EXPORTED_FACE_LAYOUT ?? 'false').toLowerCase() === 'true'),

    graphUpdateInProgress: false,
    lastGraphReloadAtMs: 0,
  };
}
