import type { GraphData, GraphNode } from './types';
import { toProjectRelativePath } from './PathUtils';

export interface CodeViewerButton {
  x: number;
  y: number;
  width: number;
  height: number;
  targetNodeId: string;
}

export interface CodeViewerConnections {
  outgoingCalls: GraphNode[];
  incomingCalls: GraphNode[];
  externalCalls: GraphNode[];
}

export function collectCodeViewerConnections(
  nodeId: string,
  graphData: GraphData | null,
  graphNodeMap: Map<string, GraphNode>,
): CodeViewerConnections {
  if (!nodeId || !graphData) {
    return {
      outgoingCalls: [],
      incomingCalls: [],
      externalCalls: [],
    };
  }

  const outgoingSeen = new Set<string>();
  const incomingSeen = new Set<string>();
  const externalSeen = new Set<string>();
  const outgoingCalls: GraphNode[] = [];
  const incomingCalls: GraphNode[] = [];
  const externalCalls: GraphNode[] = [];

  for (const edge of graphData.edges) {
    if (edge.from === nodeId) {
      const target = graphNodeMap.get(edge.to);
      if ((target?.type === 'function' || target?.type === 'class' || target?.type === 'interface' || target?.type === 'type-alias' || target?.type === 'enum' || target?.type === 'namespace') && !outgoingSeen.has(target.id)) {
        outgoingSeen.add(target.id);
        outgoingCalls.push(target);
      }
      if (target?.type === 'external' && !externalSeen.has(target.id)) {
        externalSeen.add(target.id);
        externalCalls.push(target);
      }
    }

    if (edge.to === nodeId) {
      const source = graphNodeMap.get(edge.from);
      if ((source?.type === 'function' || source?.type === 'class' || source?.type === 'interface' || source?.type === 'type-alias' || source?.type === 'enum' || source?.type === 'namespace') && !incomingSeen.has(source.id)) {
        incomingSeen.add(source.id);
        incomingCalls.push(source);
      }
    }
  }

  outgoingCalls.sort((a, b) => a.name.localeCompare(b.name));
  incomingCalls.sort((a, b) => a.name.localeCompare(b.name));
  externalCalls.sort((a, b) => a.name.localeCompare(b.name));

  return {
    outgoingCalls: outgoingCalls.slice(0, 6),
    incomingCalls: incomingCalls.slice(0, 6),
    externalCalls: externalCalls.slice(0, 6),
  };
}

export function drawCodeViewerConnectionButtons(
  ctx: CanvasRenderingContext2D,
  outgoingCalls: GraphNode[],
  incomingCalls: GraphNode[],
  externalCalls: GraphNode[],
  width: number,
  height: number,
  currentFilePath: string,
): CodeViewerButton[] {
  const buttons: CodeViewerButton[] = [];
  if (outgoingCalls.length === 0 && incomingCalls.length === 0 && externalCalls.length === 0) {
    return buttons;
  }

  const panelX = 32;
  const panelY = height - 268;
  const panelWidth = width - 64;
  const panelHeight = 236;

  ctx.fillStyle = 'rgba(18, 27, 40, 0.92)';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.strokeStyle = 'rgba(110, 168, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

  const columnGap = 12;
  const columnWidth = Math.floor((panelWidth - 28 - (columnGap * 2)) / 3);
  const incomingX = panelX + 14;
  const outgoingX = incomingX + columnWidth + columnGap;
  const externalX = outgoingX + columnWidth + columnGap;
  const buttonHeight = 28;
  const buttonGap = 6;
  const buttonWidth = columnWidth;
  let outgoingY = panelY + 40;
  let incomingY = panelY + 40;
  let externalY = panelY + 40;

  ctx.fillStyle = '#a8c7ff';
  ctx.font = '700 22px Consolas';
  ctx.fillText('Incoming Calls', incomingX, panelY + 10);
  ctx.fillText('Outgoing Calls', outgoingX, panelY + 10);
  ctx.fillText('External Calls', externalX, panelY + 10);

  ctx.font = '700 17px Consolas';
  for (const call of outgoingCalls) {
    if (outgoingY + buttonHeight > panelY + panelHeight - 8) {
      break;
    }

    ctx.fillStyle = 'rgba(32, 74, 138, 0.95)';
    ctx.fillRect(outgoingX, outgoingY, buttonWidth, buttonHeight);
    ctx.strokeStyle = 'rgba(194, 223, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(outgoingX, outgoingY, buttonWidth, buttonHeight);

    const targetFilePath = call.file ? toProjectRelativePath(call.file) : '';
    const filePart = targetFilePath && targetFilePath !== currentFilePath
      ? `  ${targetFilePath}`
      : '';
    let label = `→ ${call.name}${filePart}`;
    while (label.length > 1 && ctx.measureText(label).width > buttonWidth - 12) {
      label = `${label.slice(0, -2)}…`;
    }

    ctx.fillStyle = '#eaf3ff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(label, outgoingX + 7, outgoingY + 4);
    ctx.fillText(label, outgoingX + 7, outgoingY + 4);

    buttons.push({
      x: outgoingX,
      y: outgoingY,
      width: buttonWidth,
      height: buttonHeight,
      targetNodeId: call.id,
    });

    outgoingY += buttonHeight + buttonGap;
  }

  for (const call of incomingCalls) {
    if (incomingY + buttonHeight > panelY + panelHeight - 8) {
      break;
    }

    ctx.fillStyle = 'rgba(95, 62, 150, 0.95)';
    ctx.fillRect(incomingX, incomingY, buttonWidth, buttonHeight);
    ctx.strokeStyle = 'rgba(221, 199, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(incomingX, incomingY, buttonWidth, buttonHeight);

    const sourceFilePath = call.file ? toProjectRelativePath(call.file) : '';
    const filePart = sourceFilePath && sourceFilePath !== currentFilePath
      ? `  ${sourceFilePath}`
      : '';
    let label = `← ${call.name}${filePart}`;
    while (label.length > 1 && ctx.measureText(label).width > buttonWidth - 12) {
      label = `${label.slice(0, -2)}…`;
    }

    ctx.fillStyle = '#f0e8ff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(label, incomingX + 7, incomingY + 4);
    ctx.fillText(label, incomingX + 7, incomingY + 4);

    buttons.push({
      x: incomingX,
      y: incomingY,
      width: buttonWidth,
      height: buttonHeight,
      targetNodeId: call.id,
    });

    incomingY += buttonHeight + buttonGap;
  }

  for (const call of externalCalls) {
    if (externalY + buttonHeight > panelY + panelHeight - 8) {
      break;
    }

    ctx.fillStyle = 'rgba(42, 114, 108, 0.95)';
    ctx.fillRect(externalX, externalY, buttonWidth, buttonHeight);
    ctx.strokeStyle = 'rgba(181, 243, 230, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(externalX, externalY, buttonWidth, buttonHeight);

    let label = `⇢ ${call.name}`;
    while (label.length > 1 && ctx.measureText(label).width > buttonWidth - 12) {
      label = `${label.slice(0, -2)}…`;
    }

    ctx.fillStyle = '#e8fffb';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(label, externalX + 7, externalY + 4);
    ctx.fillText(label, externalX + 7, externalY + 4);

    buttons.push({
      x: externalX,
      y: externalY,
      width: buttonWidth,
      height: buttonHeight,
      targetNodeId: call.id,
    });

    externalY += buttonHeight + buttonGap;
  }

  return buttons;
}
