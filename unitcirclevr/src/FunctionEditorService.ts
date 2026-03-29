import * as BABYLON from '@babylonjs/core';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import type { GraphNode } from './types';
import type { SceneState } from './SceneState';
import { collectCodeViewerConnections, drawCodeViewerConnectionButtons } from './CodeViewerPanel';
import { toProjectRelativePath } from './PathUtils';

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
export const EDITOR_WORLD_WIDTH_SCALE = 1.75;
export const EDITOR_WORLD_HEIGHT_SCALE = 1.08;

export class FunctionEditorService {
  private scene: BABYLON.Scene;
  private state: SceneState;
  private onNavigateToMesh: (mesh: BABYLON.Mesh, faceNormal: BABYLON.Vector3) => void;
  private getViewerWorldPosition: () => BABYLON.Vector3;
  private coerceFaceNormalToSide: (face: BABYLON.Vector3, fallback: BABYLON.Vector3) => BABYLON.Vector3;
  private formatDebugVector: (v: BABYLON.Vector3) => { x: number; y: number; z: number };
  private readonly editorDebug = ((import.meta.env.VITE_EDITOR_DEBUG ?? 'false').toLowerCase() === 'true');

  constructor(
    scene: BABYLON.Scene,
    state: SceneState,
    onNavigateToMesh: (mesh: BABYLON.Mesh, faceNormal: BABYLON.Vector3) => void,
    getViewerWorldPosition: () => BABYLON.Vector3,
    coerceFaceNormalToSide: (face: BABYLON.Vector3, fallback: BABYLON.Vector3) => BABYLON.Vector3,
    formatDebugVector: (v: BABYLON.Vector3) => { x: number; y: number; z: number },
  ) {
    this.scene = scene;
    this.state = state;
    this.onNavigateToMesh = onNavigateToMesh;
    this.getViewerWorldPosition = getViewerWorldPosition;
    this.coerceFaceNormalToSide = coerceFaceNormalToSide;
    this.formatDebugVector = formatDebugVector;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  ensureFunctionEditorScreen(): void {
    if (this.state.functionEditorScreen && this.state.functionEditorTexture && this.state.functionEditorMaterial) {
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

    this.state.functionEditorScreen = screen;
    this.state.functionEditorTexture = texture;
    this.state.functionEditorMaterial = material;
  }

  showFunctionEditor(node: GraphNode): void {
    if (!node.id) {
      this.hideFunctionEditor();
      return;
    }

    const hostMesh = this.state.nodeMeshMap.get(node.id);
    if (!hostMesh) {
      this.hideFunctionEditor();
      return;
    }

    this.ensureFunctionEditorScreen();
    if (!this.state.functionEditorScreen || !this.state.functionEditorTexture) {
      return;
    }

    const meshAny = hostMesh as any;
    const boxSize = typeof meshAny.boxSize === 'number'
      ? meshAny.boxSize
      : Math.max(1.0, (hostMesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);

    this.drawFunctionEditorTexture(node);
    this.attachEditorScreenToVisibleFace(hostMesh, boxSize, node.id);
    this.state.functionEditorScreen.setEnabled(true);
    this.state.editorVisibleForNodeId = node.id;
    this.state.editorCurrentNodeId = node.id;

    if (this.editorDebug) {
      console.log('🖥️ Editor shown', {
        nodeId: node.id,
        name: node.name,
        file: node.file,
        line: node.line,
        selectedFunctionId: this.state.currentFunctionId,
        selectedFaceNormal: this.state.currentFaceNormal ? this.formatDebugVector(this.state.currentFaceNormal) : null,
        codeLength: node.code?.length ?? 0,
      });
    }
  }

  hideFunctionEditor(): void {
    const previousNodeId = this.state.editorVisibleForNodeId;
    this.state.editorVisibleForNodeId = null;
    this.state.editorCurrentNodeId = null;
    this.state.editorCallButtons = [];
    this.state.editorScrollButtons = [];
    this.state.editorCloseButton = null;
    this.state.editorCurrentCodeLineCount = 0;
    this.state.editorCurrentCodeMaxLines = 0;
    this.state.lastEditorAttachmentSignature = null;
    if (this.state.functionEditorScreen) {
      this.state.functionEditorScreen.parent = null;
      this.state.functionEditorScreen.setEnabled(false);
    }
    if (previousNodeId && this.editorDebug) {
      console.log('🖥️ Editor hidden', { nodeId: previousNodeId });
    }
  }

  handleEditorScreenClick(uv: BABYLON.Vector2): boolean {
    const texX = (1 - uv.x) * EDITOR_TEXTURE_WIDTH;
    const texY = (1 - uv.y) * EDITOR_TEXTURE_HEIGHT;

    if (this.state.editorCloseButton) {
      const insideClose = texX >= this.state.editorCloseButton.x
        && texX <= (this.state.editorCloseButton.x + this.state.editorCloseButton.width)
        && texY >= this.state.editorCloseButton.y
        && texY <= (this.state.editorCloseButton.y + this.state.editorCloseButton.height);
      if (insideClose) {
        this.state.editorDismissedNodeId = this.state.editorCurrentNodeId;
        this.hideFunctionEditor();
        return true;
      }
    }

    if (!this.state.editorCurrentNodeId) {
      return false;
    }

    for (const btn of this.state.editorScrollButtons) {
      const inside = texX >= btn.x && texX <= (btn.x + btn.width)
        && texY >= btn.y && texY <= (btn.y + btn.height);
      if (!inside) continue;
      return this.applyEditorScrollAction(btn.action);
    }

    for (const btn of this.state.editorCallButtons) {
      const inside = texX >= btn.x && texX <= (btn.x + btn.width)
        && texY >= btn.y && texY <= (btn.y + btn.height);
      if (!inside) continue;

      const targetMesh = this.state.nodeMeshMap.get(btn.targetNodeId);
      if (!targetMesh) return false;

      const toViewer = this.getViewerWorldPosition().subtract(targetMesh.getAbsolutePosition());
      let faceNormal = new BABYLON.Vector3(0, 0, 1);
      const absX = Math.abs(toViewer.x);
      const absZ = Math.abs(toViewer.z);
      if (absX >= absZ) {
        faceNormal = new BABYLON.Vector3(toViewer.x >= 0 ? 1 : -1, 0, 0);
      } else {
        faceNormal = new BABYLON.Vector3(0, 0, toViewer.z >= 0 ? 1 : -1);
      }

      this.onNavigateToMesh(targetMesh, faceNormal);
      return true;
    }

    return this.focusCurrentEditorFaceCloseUp();
  }

  updateFunctionEditorProximity(): void {
    const nearbyNode = this.findNearbyFunctionForEditor();
    if (!nearbyNode) {
      this.state.editorDismissedNodeId = null;
      if (this.state.editorVisibleForNodeId !== null) {
        this.hideFunctionEditor();
      }
      return;
    }

    if (this.state.editorDismissedNodeId === nearbyNode.id) {
      return;
    }

    if (this.state.editorVisibleForNodeId === nearbyNode.id) {
      const hostMesh = this.state.nodeMeshMap.get(nearbyNode.id);
      if (hostMesh && this.state.functionEditorScreen) {
        const meshAny = hostMesh as any;
        const boxSize = typeof meshAny.boxSize === 'number'
          ? meshAny.boxSize
          : Math.max(1.0, (hostMesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 1) * 1.15);
        this.attachEditorScreenToVisibleFace(hostMesh, boxSize, nearbyNode.id);
      }
      return;
    }

    if (this.state.editorVisibleForNodeId && this.state.editorVisibleForNodeId !== nearbyNode.id) {
      this.hideFunctionEditor();
    }

    this.showFunctionEditor(nearbyNode);
  }

  attachEditorScreenToVisibleFace(hostMesh: BABYLON.Mesh, boxSize: number, nodeId: string): void {
    if (!this.state.functionEditorScreen) return;

    const screen = this.state.functionEditorScreen;
    const faceNormal = this.getPreferredEditorFaceNormal(nodeId, hostMesh);

    const absX = Math.abs(faceNormal.x);
    const absY = Math.abs(faceNormal.y);
    const absZ = Math.abs(faceNormal.z);
    const half = boxSize * 0.5;
    const offset = Math.max(0.14, boxSize * 0.045);

    let position = new BABYLON.Vector3(0, 0, half + offset);
    let rotation = BABYLON.Vector3.Zero();

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

    const attachmentSignature = [
      nodeId,
      position.x.toFixed(3),
      position.y.toFixed(3),
      position.z.toFixed(3),
      rotation.x.toFixed(3),
      rotation.y.toFixed(3),
      rotation.z.toFixed(3),
      boxSize.toFixed(3),
    ].join('|');

    if (attachmentSignature === this.state.lastEditorAttachmentSignature) {
      return;
    }

    screen.parent = hostMesh;
    screen.position = position;
    screen.rotationQuaternion = null;
    screen.rotation = rotation;
    screen.scaling = new BABYLON.Vector3(
      boxSize * EDITOR_WORLD_WIDTH_SCALE,
      boxSize * EDITOR_WORLD_HEIGHT_SCALE,
      1,
    );
    (screen as any).editorHostNodeId = nodeId;

    this.state.lastEditorAttachmentSignature = attachmentSignature;
    if (this.editorDebug) {
      console.log('🖥️ Editor screen attached', {
        nodeId,
        faceNormal: this.formatDebugVector(faceNormal),
        localPosition: this.formatDebugVector(position),
        localRotation: this.formatDebugVector(rotation),
        boxSize: Number(boxSize.toFixed(3)),
      });
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private drawFunctionEditorTexture(node: GraphNode): void {
    if (!this.state.functionEditorTexture) return;

    const width = EDITOR_TEXTURE_WIDTH;
    const height = EDITOR_TEXTURE_HEIGHT;
    const ctx = this.state.functionEditorTexture.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(5, 9, 16, 0.98)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(188, 228, 255, 0.38)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    ctx.fillStyle = 'rgba(26, 38, 57, 0.95)';
    ctx.fillRect(16, 16, width - 32, 88);

    const closeSize = 52;
    const closeX = width - 24 - closeSize;
    const closeY = 34;
    this.state.editorCloseButton = { x: closeX, y: closeY, width: closeSize, height: closeSize };

    ctx.fillStyle = 'rgba(210, 44, 44, 0.96)';
    ctx.fillRect(closeX, closeY, closeSize, closeSize);
    ctx.strokeStyle = 'rgba(255, 224, 224, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(closeX, closeY, closeSize, closeSize);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    const iconInset = 14;
    ctx.beginPath();
    ctx.moveTo(closeX + iconInset, closeY + iconInset);
    ctx.lineTo(closeX + closeSize - iconInset, closeY + closeSize - iconInset);
    ctx.moveTo(closeX + closeSize - iconInset, closeY + iconInset);
    ctx.lineTo(closeX + iconInset, closeY + closeSize - iconInset);
    ctx.stroke();

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
    const viewerConnections = collectCodeViewerConnections(node.id || '', this.state.currentGraphData, this.state.graphNodeMap);
    const { outgoingCalls, incomingCalls, externalCalls } = viewerConnections;
    const currentFilePath = node.file ? toProjectRelativePath(node.file) : '';
    const hasCallButtons = outgoingCalls.length > 0 || incomingCalls.length > 0 || externalCalls.length > 0;
    const reserveFooterHeight = hasCallButtons ? 280 : 30;
    const maxLines = Math.floor((height - codeAreaY - reserveFooterHeight) / lineHeight);
    const requestedStartLine = this.state.editorCodeScrollByNodeId.get(node.id || '') ?? 0;

    const renderCode = this.getRenderableEditorCode(node);
    const codeRender = this.drawHighlightedCode(
      ctx, renderCode, codeAreaX, codeAreaY, codeAreaWidth, lineHeight, maxLines, requestedStartLine,
    );
    this.state.editorCodeScrollByNodeId.set(node.id || '', codeRender.appliedStartLine);
    this.state.editorCurrentCodeLineCount = codeRender.totalLines;
    this.state.editorCurrentCodeMaxLines = Math.max(1, maxLines);
    this.drawCodeScrollControls(ctx, codeAreaX, codeAreaY, codeAreaWidth, lineHeight, maxLines, codeRender);
    this.state.editorCallButtons = drawCodeViewerConnectionButtons(
      ctx, outgoingCalls, incomingCalls, externalCalls, width, height, currentFilePath,
    );

    this.state.functionEditorTexture.update();
  }

  private focusCurrentEditorFaceCloseUp(): boolean {
    if (!this.state.editorCurrentNodeId) return false;

    const mesh = this.state.nodeMeshMap.get(this.state.editorCurrentNodeId);
    if (!mesh) return false;

    let faceNormal = this.state.currentFaceNormal?.clone() || new BABYLON.Vector3(0, 0, 1);
    faceNormal = this.coerceFaceNormalToSide(faceNormal, faceNormal);

    this.state.currentFunctionId = this.state.editorCurrentNodeId;
    this.state.currentFaceNormal = faceNormal.clone();

    // NavigationController.flyToWorldPosition wired via onNavigateToMesh:
    // pass a neutral face so the caller routes via the face-normal path.
    this.onNavigateToMesh(mesh, faceNormal);
    return true;
  }

  private findNearbyFunctionForEditor(): GraphNode | null {
    const viewerWorldPos = this.getViewerWorldPosition();

    if (this.state.currentFunctionId) {
      const selectedNode = this.state.graphNodeMap.get(this.state.currentFunctionId);
      const selectedMesh = this.state.nodeMeshMap.get(this.state.currentFunctionId);
      if (selectedNode && selectedMesh && (selectedNode.type === 'function' || selectedNode.type === 'class' || selectedNode.type === 'interface' || selectedNode.type === 'type-alias' || selectedNode.type === 'enum' || selectedNode.type === 'namespace')) {
        return selectedNode;
      }
    }

    let closestNode: GraphNode | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const [nodeId, mesh] of this.state.nodeMeshMap.entries()) {
      const node = this.state.graphNodeMap.get(nodeId);
      if (!node || (node.type !== 'function' && node.type !== 'class' && node.type !== 'interface' && node.type !== 'type-alias' && node.type !== 'enum' && node.type !== 'namespace') || !mesh.isEnabled() || !mesh.isVisible) continue;

      const radius = mesh.getBoundingInfo()?.boundingSphere?.radiusWorld ?? 0;
      const activationDistance = Math.max(12, radius + 6);
      const distance = BABYLON.Vector3.Distance(viewerWorldPos, mesh.getAbsolutePosition());
      if (distance > activationDistance || distance >= closestDistance) continue;

      closestDistance = distance;
      closestNode = node;
    }

    return closestNode;
  }

  private getPreferredEditorFaceNormal(nodeId: string, hostMesh: BABYLON.Mesh): BABYLON.Vector3 {
    if (this.state.currentFunctionId === nodeId && this.state.currentFaceNormal) {
      return this.state.currentFaceNormal.clone();
    }

    const viewerWorldPos = this.getViewerWorldPosition();
    let fallback = viewerWorldPos.subtract(hostMesh.getAbsolutePosition());
    if (!Number.isFinite(fallback.length()) || fallback.lengthSquared() < 0.000001) {
      fallback = new BABYLON.Vector3(0, 0, 1);
    }
    return fallback;
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

    return { totalLines: sourceLines.length, appliedStartLine };
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
    this.state.editorScrollButtons = [];
    if (codeRender.totalLines <= maxLines) return;

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

    this.state.editorScrollButtons.push({ x: scrollX, y: upY, width: buttonWidth, height: buttonHeight, action: 'up' });
    this.state.editorScrollButtons.push({ x: scrollX, y: downY, width: buttonWidth, height: buttonHeight, action: 'down' });

    const firstVisible = codeRender.appliedStartLine + 1;
    const lastVisible = Math.min(codeRender.totalLines, codeRender.appliedStartLine + maxLines);
    ctx.fillStyle = '#9fc1e8';
    ctx.font = '14px Consolas';
    const indicator = `${firstVisible}-${lastVisible}/${codeRender.totalLines}`;
    ctx.fillText(indicator, scrollX - 12, upY + buttonHeight + 8);
  }

  private applyEditorScrollAction(action: 'up' | 'down'): boolean {
    if (!this.state.editorCurrentNodeId) return false;

    const node = this.state.graphNodeMap.get(this.state.editorCurrentNodeId);
    if (!node || (node.type !== 'function' && node.type !== 'class' && node.type !== 'interface' && node.type !== 'type-alias' && node.type !== 'enum' && node.type !== 'namespace')) return false;

    const current = this.state.editorCodeScrollByNodeId.get(node.id) ?? 0;
    const maxStart = Math.max(0, this.state.editorCurrentCodeLineCount - this.state.editorCurrentCodeMaxLines);
    const step = Math.max(1, Math.floor(this.state.editorCurrentCodeMaxLines * 0.35));
    const next = action === 'up'
      ? Math.max(0, current - step)
      : Math.min(maxStart, current + step);

    if (next === current) return true;

    this.state.editorCodeScrollByNodeId.set(node.id, next);
    this.drawFunctionEditorTexture(node);
    return true;
  }

  private getRenderableEditorCode(node: GraphNode): string {
    if (node.code && node.code.trim().length > 0) {
      return node.code;
    }

    const fileLabel = node.file ? toProjectRelativePath(node.file) : '(unknown file)';
    const lineLabel = node.line ? ` at line ${node.line}` : '';
    return [
      '// Source code unavailable for this symbol node.',
      `// Symbol: ${node.name}${lineLabel}`,
      `// File: ${fileLabel}`,
      '//',
      '// This usually means the parser could not extract a concrete code block',
      '// for this symbol (for example generated/ambient declarations).',
    ].join('\n');
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

  dispose(): void {
    this.state.functionEditorScreen?.dispose(false, true);
    this.state.functionEditorMaterial?.dispose();
    this.state.functionEditorTexture?.dispose();
    this.state.functionEditorScreen = null;
    this.state.functionEditorMaterial = null;
    this.state.functionEditorTexture = null;
  }
}
