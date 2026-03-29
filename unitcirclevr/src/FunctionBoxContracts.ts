import * as BABYLON from '@babylonjs/core';

export interface FunctionBoxInput {
  id: string;
  name: string;
  isExported?: boolean;
}

export interface ColorLike {
  r: number;
  g: number;
  b: number;
}

export interface PositionLike {
  x: number;
  y: number;
  z: number;
}

export interface FunctionBoxFactoryConfig {
  exportedFunctionBoxSize: number;
  internalFunctionBoxSize: number;
  functionBoxSize: number;
  signatureTextureSize: number;
  signatureFontFamily: string;
}

export interface FunctionBoxRenderAdapter {
  createBox(name: string, size: number, faceUV: BABYLON.Vector4[]): BABYLON.Mesh;
  createMaterial(name: string): BABYLON.StandardMaterial;
  createDynamicTexture(name: string, width: number, height: number): BABYLON.DynamicTexture;
  createColor3(r: number, g: number, b: number): BABYLON.Color3;
  createVector4(x: number, y: number, z: number, w: number): BABYLON.Vector4;
}

export interface FunctionBoxCreator {
  create(
    node: FunctionBoxInput,
    position: PositionLike,
    fileColor: ColorLike | null,
  ): { mesh: BABYLON.Mesh; material: BABYLON.StandardMaterial };
}
