import * as BABYLON from '@babylonjs/core';

export class FileColorService {
  static getFileColor(
    fileName: string,
    colorCache: Map<string, BABYLON.Color3>
  ): BABYLON.Color3 {
    if (colorCache.has(fileName)) {
      return colorCache.get(fileName)!;
    }

    const color = FileColorService.generateColorFromString(fileName);
    colorCache.set(fileName, color);
    return color;
  }

  private static generateColorFromString(str: string): BABYLON.Color3 {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    const rawHue = (Math.abs(hash) % 360) / 360;
    const hue = FileColorService.mapToNonRedHue(rawHue);
    const saturation = 0.5 + ((Math.abs(hash) >> 8) % 100) / 200;
    const brightness = 0.6 + ((Math.abs(hash) >> 16) % 100) / 250;

    const rgb = FileColorService.hsbToRgb(hue, saturation, brightness);
    return new BABYLON.Color3(rgb.r, rgb.g, rgb.b);
  }

  private static mapToNonRedHue(rawHue: number): number {
    // Restrict palette to non-red hue bands:
    // cyan/blue (0.48-0.72) and green/olive (0.23-0.42).
    // This keeps generated file colors away from red/pink tones.
    const normalized = ((rawHue % 1) + 1) % 1;
    if (normalized < 0.6) {
      return 0.48 + (normalized / 0.6) * 0.24;
    }
    return 0.23 + ((normalized - 0.6) / 0.4) * 0.19;
  }

  private static hsbToRgb(h: number, s: number, b: number): { r: number; g: number; b: number } {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = b * (1 - s);
    const q = b * (1 - f * s);
    const t = b * (1 - (1 - f) * s);

    let r = 0;
    let g = 0;
    let bOut = 0;

    switch (i % 6) {
      case 0:
        r = b;
        g = t;
        bOut = p;
        break;
      case 1:
        r = q;
        g = b;
        bOut = p;
        break;
      case 2:
        r = p;
        g = b;
        bOut = t;
        break;
      case 3:
        r = p;
        g = q;
        bOut = b;
        break;
      case 4:
        r = t;
        g = p;
        bOut = b;
        break;
      case 5:
        r = b;
        g = p;
        bOut = q;
        break;
    }

    return { r, g, b: bOut };
  }
}
