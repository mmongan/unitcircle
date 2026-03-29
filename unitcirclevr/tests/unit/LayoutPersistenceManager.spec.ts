import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutPersistenceManager, type PersistedLayoutSnapshot } from '../../src/LayoutPersistenceManager';

describe('LayoutPersistenceManager', () => {
  let manager: LayoutPersistenceManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new LayoutPersistenceManager();
  });

  const createSnapshot = (): PersistedLayoutSnapshot => ({
    schemaVersion: 1,
    savedAt: '2026-03-29T00:00:00.000Z',
    graph: {
      nodes: [{ id: 'n1', name: 'fn', type: 'function' }],
      edges: [{ from: 'n1', to: 'n1', kind: 'call' }],
      files: ['src/a.ts'],
      lastUpdated: '2026-03-29T00:00:00.000Z',
    },
    fileBoxes: {
      'src/a.ts': {
        position: { x: 1, y: 2, z: 3 },
        scaling: { x: 4, y: 5, z: 6 },
      },
    },
    nodeWorldPositions: {
      n1: { x: 10, y: 20, z: 30 },
    },
  });

  it('saves and loads a snapshot', () => {
    const snapshot = createSnapshot();
    const saved = manager.saveSnapshot(snapshot);

    expect(saved).toBe(true);
    expect(manager.hasSnapshot()).toBe(true);

    const restored = manager.loadSnapshot();
    expect(restored).toEqual(snapshot);
  });

  it('returns null for missing snapshot', () => {
    expect(manager.hasSnapshot()).toBe(false);
    expect(manager.loadSnapshot()).toBeNull();
  });

  it('clears saved snapshot', () => {
    manager.saveSnapshot(createSnapshot());
    expect(manager.hasSnapshot()).toBe(true);

    manager.clearSnapshot();

    expect(manager.hasSnapshot()).toBe(false);
    expect(manager.loadSnapshot()).toBeNull();
  });

  it('ignores invalid schema versions', () => {
    localStorage.setItem('unitcirclevr.layoutSnapshot.v1', JSON.stringify({
      schemaVersion: 2,
      graph: { nodes: [], edges: [], lastUpdated: 'x' },
      fileBoxes: {},
      nodeWorldPositions: {},
    }));

    expect(manager.loadSnapshot()).toBeNull();
  });
});
