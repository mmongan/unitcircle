import type { GraphData } from './types';

export interface PersistedVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PersistedLayoutSnapshot {
  schemaVersion: 1;
  savedAt: string;
  graph: GraphData;
  fileBoxes: Record<string, { position: PersistedVector3; scaling: PersistedVector3 }>;
  nodeWorldPositions: Record<string, PersistedVector3>;
}

const SNAPSHOT_STORAGE_KEY = 'unitcirclevr.layoutSnapshot.v1';

export class LayoutPersistenceManager {
  public hasSnapshot(): boolean {
    return this.readSnapshot() !== null;
  }

  public loadSnapshot(): PersistedLayoutSnapshot | null {
    return this.readSnapshot();
  }

  public saveSnapshot(snapshot: PersistedLayoutSnapshot): boolean {
    try {
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  public clearSnapshot(): void {
    try {
      localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    } catch {
      // Ignore persistence failures to keep runtime interaction resilient.
    }
  }

  private readSnapshot(): PersistedLayoutSnapshot | null {
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedLayoutSnapshot>;
      if (parsed.schemaVersion !== 1) {
        return null;
      }
      if (!parsed.graph || !Array.isArray(parsed.graph.nodes) || !Array.isArray(parsed.graph.edges)) {
        return null;
      }
      if (!parsed.fileBoxes || !parsed.nodeWorldPositions) {
        return null;
      }

      return parsed as PersistedLayoutSnapshot;
    } catch {
      return null;
    }
  }
}
