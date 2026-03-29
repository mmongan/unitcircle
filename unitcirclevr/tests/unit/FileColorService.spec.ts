import { describe, it, expect, vi } from 'vitest';
import { FileColorService } from '../../src/FileColorService';

vi.mock('@babylonjs/core', () => ({
  Color3: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
}));

describe('FileColorService', () => {
  describe('getFileColor', () => {
    it('returns a color with r, g, b components', () => {
      const cache = new Map();
      const color = FileColorService.getFileColor('src/main.ts', cache);
      expect(color).toHaveProperty('r');
      expect(color).toHaveProperty('g');
      expect(color).toHaveProperty('b');
    });

    it('all components are in [0, 1] range', () => {
      const cache = new Map();
      for (const name of ['src/a.ts', 'src/b.ts', 'index.ts', 'utils/helpers.ts']) {
        const { r, g, b } = FileColorService.getFileColor(name, cache);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
    });

    it('returns the same reference on repeated calls (cache hit)', () => {
      const cache = new Map();
      const color1 = FileColorService.getFileColor('src/main.ts', cache);
      const color2 = FileColorService.getFileColor('src/main.ts', cache);
      expect(color1).toBe(color2);
    });

    it('stores computed color in the cache', () => {
      const cache = new Map();
      FileColorService.getFileColor('src/main.ts', cache);
      expect(cache.has('src/main.ts')).toBe(true);
    });

    it('uses an existing cache entry without recomputing', () => {
      const prebuilt = { r: 0.5, g: 0.5, b: 0.5 } as any;
      const cache = new Map([['src/main.ts', prebuilt]]);
      const result = FileColorService.getFileColor('src/main.ts', cache);
      expect(result).toBe(prebuilt);
    });

    it('generates different colors for different filenames', () => {
      const cache = new Map();
      const colorA = FileColorService.getFileColor('src/alpha.ts', cache);
      const colorB = FileColorService.getFileColor('src/beta.ts', cache);
      const identical = colorA.r === colorB.r && colorA.g === colorB.g && colorA.b === colorB.b;
      expect(identical).toBe(false);
    });

    it('generates consistent colors across separate cache instances', () => {
      const color1 = FileColorService.getFileColor('src/stable.ts', new Map());
      const color2 = FileColorService.getFileColor('src/stable.ts', new Map());
      expect(color1.r).toBeCloseTo(color2.r, 10);
      expect(color1.g).toBeCloseTo(color2.g, 10);
      expect(color1.b).toBeCloseTo(color2.b, 10);
    });

    it('avoids near-pure-red hues (hue palette excludes reds)', () => {
      // The hue mapping restricts output to cyan/blue and green/olive bands.
      // True red would have r >> g and r >> b with r ≈ 1.
      const cache = new Map();
      const names = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'index.ts', 'main.ts', 'server.ts'];
      for (const name of names) {
        const { r, g, b } = FileColorService.getFileColor(name, cache);
        const isPureRed = r > 0.75 && g < 0.25 && b < 0.25;
        expect(isPureRed).toBe(false);
      }
    });
  });
});
