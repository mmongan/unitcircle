import { describe, it, expect } from 'vitest';
import { SceneConfig } from '../../src/SceneConfig';

describe('SceneConfig', () => {
  describe('Edge Radius Constants', () => {
    it('INTERNAL_EDGE_RADIUS is defined', () => {
      expect(SceneConfig.INTERNAL_EDGE_RADIUS).toBeDefined();
    });

    it('INTERNAL_EDGE_RADIUS is less than EDGE_RADIUS', () => {
      expect(SceneConfig.INTERNAL_EDGE_RADIUS).toBeLessThan(SceneConfig.EDGE_RADIUS);
    });

    it('INTERNAL_EDGE_RADIUS is 0.14', () => {
      expect(SceneConfig.INTERNAL_EDGE_RADIUS).toBe(0.14);
    });

    it('EDGE_RADIUS is 0.2', () => {
      expect(SceneConfig.EDGE_RADIUS).toBe(0.2);
    });
  });

  describe('Other Constants', () => {
    it('FUNCTION_BOX_SIZE is a positive number', () => {
      expect(SceneConfig.FUNCTION_BOX_SIZE).toBeGreaterThan(0);
    });

    it('GRAPH_POLL_INTERVAL_MS is a positive number', () => {
      expect(SceneConfig.GRAPH_POLL_INTERVAL_MS).toBeGreaterThan(0);
    });

    it('FLY_TO_ANIMATION_TIME_MS is a positive number', () => {
      expect(SceneConfig.FLY_TO_ANIMATION_TIME_MS).toBeGreaterThan(0);
    });

    it('FLY_TO_ANIMATION_FPS is 60', () => {
      expect(SceneConfig.FLY_TO_ANIMATION_FPS).toBe(60);
    });
  });
});
