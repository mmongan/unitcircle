import * as BABYLON from '@babylonjs/core';
import type {
  ColorLike,
  FunctionBoxCreator,
  FunctionBoxFactoryConfig,
  FunctionBoxInput,
  FunctionBoxRenderAdapter,
  PositionLike,
} from './FunctionBoxContracts';

class BabylonFunctionBoxRenderAdapter implements FunctionBoxRenderAdapter {
  private readonly scene: BABYLON.Scene;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  createBox(name: string, size: number, faceUV: BABYLON.Vector4[]): BABYLON.Mesh {
    return BABYLON.MeshBuilder.CreateBox(name, { size, faceUV }, this.scene);
  }

  createMaterial(name: string): BABYLON.StandardMaterial {
    return new BABYLON.StandardMaterial(name, this.scene);
  }

  createDynamicTexture(name: string, width: number, height: number): BABYLON.DynamicTexture {
    return new BABYLON.DynamicTexture(name, { width, height }, this.scene);
  }

  createColor3(r: number, g: number, b: number): BABYLON.Color3 {
    return new BABYLON.Color3(r, g, b);
  }

  createVector4(x: number, y: number, z: number, w: number): BABYLON.Vector4 {
    return new BABYLON.Vector4(x, y, z, w);
  }
}

export class FunctionBoxFactory implements FunctionBoxCreator {
  private config: FunctionBoxFactoryConfig;
  private renderAdapter: FunctionBoxRenderAdapter;

  constructor(
    config: FunctionBoxFactoryConfig,
    renderAdapter: FunctionBoxRenderAdapter,
  ) {
    this.config = config;
    this.renderAdapter = renderAdapter;
  }

  public create(
    node: FunctionBoxInput,
    position: PositionLike,
    fileColor: ColorLike | null,
  ): { mesh: BABYLON.Mesh; material: BABYLON.StandardMaterial } {
    // Keep both exported and internal function boxes large enough to see.
    const boxSize = node.isExported
      ? Math.max(this.config.exportedFunctionBoxSize, this.config.functionBoxSize)
      : Math.max(this.config.internalFunctionBoxSize, this.config.functionBoxSize);

    const { texture, faceUV } = this.createFunctionFaceTextureAtlas(node, fileColor);
    const box = this.renderAdapter.createBox(`func_${node.id}`, boxSize, faceUV);
    if (typeof (box.position as any).copyFromFloats === 'function') {
      (box.position as any).copyFromFloats(position.x, position.y, position.z);
    } else {
      box.position.x = position.x;
      box.position.y = position.y;
      box.position.z = position.z;
    }
    box.isPickable = true;
    (box as any).boxSize = boxSize;

    const material = this.renderAdapter.createMaterial(`mat_${node.id}`);
    material.diffuseColor = this.renderAdapter.createColor3(1, 1, 1);
    material.diffuseTexture = texture;

    // Subtle emissive glow based on file color.
    if (fileColor) {
      material.emissiveColor = this.renderAdapter.createColor3(
        fileColor.r * 0.1,
        fileColor.g * 0.1,
        fileColor.b * 0.1,
      );
    } else {
      material.emissiveColor = this.renderAdapter.createColor3(0.05, 0.05, 0.05);
    }

    material.specularColor = this.renderAdapter.createColor3(0.1, 0.1, 0.1);
    material.specularPower = 16;
    material.wireframe = false;

    // Exported functions are highlighted; internal functions remain visible.
    if (node.isExported) {
      material.alpha = 1.0;
      material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      material.disableLighting = false;
      material.emissiveColor = this.renderAdapter.createColor3(0.22, 0.22, 0.22);
      box.isVisible = true;
      box.setEnabled(true);
    } else {
      material.alpha = 1.0;
      material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
      material.disableLighting = false;
      if (fileColor) {
        material.emissiveColor = this.renderAdapter.createColor3(
          0.08 + (fileColor.r * 0.10),
          0.08 + (fileColor.g * 0.10),
          0.08 + (fileColor.b * 0.10),
        );
      } else {
        material.emissiveColor = this.renderAdapter.createColor3(0.12, 0.12, 0.12);
      }
      box.isVisible = true;
      box.setEnabled(true);
    }

    box.material = material;
    return { mesh: box, material };
  }

  /**
   * Build a texture atlas plus face UV mapping for a single box mesh.
   */
  private createFunctionFaceTextureAtlas(
    node: FunctionBoxInput,
    fileColor: ColorLike | null,
  ): { texture: BABYLON.DynamicTexture; faceUV: BABYLON.Vector4[] } {
    const tileSize = Math.floor(this.config.signatureTextureSize / 2);
    const atlasCols = 3;
    const atlasRows = 2;
    const textureWidth = tileSize * atlasCols;
    const textureHeight = tileSize * atlasRows;

    const dynamicTexture = this.renderAdapter.createDynamicTexture(
      `signatureTexture_${node.id}`,
      textureWidth,
      textureHeight,
    );
    dynamicTexture.hasAlpha = false;
    const ctx = dynamicTexture.getContext() as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, textureWidth, textureHeight);

    // Draw background using the file color, darkened for contrast with white text.
    let bgColor = 'rgb(0, 0, 0)';
    if (fileColor) {
      const r = Math.max(0, Math.floor(fileColor.r * 200));
      const g = Math.max(0, Math.floor(fileColor.g * 200));
      const b = Math.max(0, Math.floor(fileColor.b * 200));
      bgColor = `rgb(${r}, ${g}, ${b})`;
    }

    const faceLabels = ['front', 'back', 'right', 'left', 'top', 'bottom'];
    for (let i = 0; i < faceLabels.length; i++) {
      const col = i % atlasCols;
      const row = Math.floor(i / atlasCols);
      const x = col * tileSize;
      const y = row * tileSize;
      const centerX = x + (tileSize / 2);
      const centerY = y + (tileSize / 2);
      const maxTextWidth = tileSize * 0.86;
      const lineHeight = Math.floor(tileSize * 0.16);
      const maxLines = 4;

      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y, tileSize, tileSize);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.01));
      ctx.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);

      const faceFontSize = Math.max(18, Math.floor(tileSize * 0.22));
      ctx.font = `bold ${faceFontSize}px ${this.config.signatureFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';

      const wrappedLines = this.wrapTextToWidth(ctx, node.name, maxTextWidth, maxLines);
      const totalHeight = wrappedLines.length * lineHeight;
      let lineY = centerY - (totalHeight / 2) + (lineHeight / 2);
      for (const line of wrappedLines) {
        ctx.fillText(line, centerX, lineY);
        lineY += lineHeight;
      }
    }

    dynamicTexture.update();

    const buildUV = (index: number): BABYLON.Vector4 => {
      const col = index % atlasCols;
      const row = Math.floor(index / atlasCols);
      const u0 = col / atlasCols;
      const v0 = row / atlasRows;
      const u1 = (col + 1) / atlasCols;
      const v1 = (row + 1) / atlasRows;
      return this.renderAdapter.createVector4(u0, v0, u1, v1);
    };

    const faceUV: BABYLON.Vector4[] = [
      buildUV(0),
      buildUV(1),
      buildUV(2),
      buildUV(3),
      buildUV(4),
      buildUV(5),
    ];

    return { texture: dynamicTexture, faceUV };
  }

  /**
   * Wrap text to fit a target pixel width, preserving readability for long symbol names.
   */
  private wrapTextToWidth(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number,
  ): string[] {
    const normalized = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [text];
    }

    const lines: string[] = [];
    let currentLine = '';

    const pushLine = () => {
      if (currentLine.trim().length > 0) {
        lines.push(currentLine.trim());
      }
      currentLine = '';
    };

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (!currentLine) {
        // Fallback: break very long tokens by character width.
        let remaining = word;
        while (remaining.length > 0) {
          let take = remaining.length;
          while (take > 1 && ctx.measureText(remaining.slice(0, take)).width > maxWidth) {
            take--;
          }
          const chunk = remaining.slice(0, take);
          lines.push(chunk);
          remaining = remaining.slice(take);
          if (lines.length >= maxLines) {
            break;
          }
        }
      } else {
        pushLine();
        currentLine = word;
      }

      if (lines.length >= maxLines) {
        break;
      }
    }

    if (lines.length < maxLines && currentLine) {
      pushLine();
    }

    if (lines.length === 0) {
      return [text];
    }

    if (lines.length > maxLines) {
      return lines.slice(0, maxLines);
    }

    // Add ellipsis if we had to truncate words.
    if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
      const lastIndex = lines.length - 1;
      let last = lines[lastIndex];
      while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lastIndex] = `${last}...`;
    }

    return lines;
  }
}

export function createDefaultFunctionBoxFactory(
  scene: BABYLON.Scene,
  config: FunctionBoxFactoryConfig,
): FunctionBoxCreator {
  return new FunctionBoxFactory(config, new BabylonFunctionBoxRenderAdapter(scene));
}
