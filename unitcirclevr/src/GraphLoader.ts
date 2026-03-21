/**
 * Service for loading and managing graph data from different sources
 */
import type { GraphData } from './types';

export class GraphLoader {
  private cache: GraphData | null = null;
  private lastLoadTime: number = 0;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 2000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Load graph from appropriate source based on environment
   */
  async loadGraph(): Promise<GraphData | null> {
    try {
      // In development, try live API first, then fall back to prebuilt
      // In production, use prebuilt graph.json
      const isDev = import.meta.env.DEV;
      
      if (isDev) {
        // Try API endpoint first in dev mode
        try {
          const response = await fetch('/api/graph.json');
          if (response.ok) {
            const data = await response.json();
            this.cache = data;
            this.lastLoadTime = Date.now();
            return data;
          }
        } catch (apiError) {
          // API not available, fall through to prebuilt
        }
        
        // Fall back to prebuilt graph.json
        const response = await fetch('/graph.json');
        if (response.ok) {
          const data = await response.json();
          this.cache = data;
          this.lastLoadTime = Date.now();
          return data;
        }
      } else {
        // Production: use prebuilt graph.json
        const response = await fetch('/unitcircle/graph.json');
        if (response.ok) {
          const data = await response.json();
          this.cache = data;
          this.lastLoadTime = Date.now();
          return data;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error loading graph:', error);
      return null;
    }
  }

  /**
   * Check if graph has been updated since last load
   */
  hasGraphUpdated(lastSeenUpdate: string): boolean {
    if (!this.cache) return false;
    return this.cache.lastUpdated !== lastSeenUpdate;
  }

  /**
   * Get cached graph data
   */
  getCachedGraph(): GraphData | null {
    return this.cache;
  }

  /**
   * Get time since last load in milliseconds
   */
  getTimeSinceLastLoad(): number {
    return Date.now() - this.lastLoadTime;
  }

  /**
   * Check if enough time has passed for next poll
   */
  shouldPoll(): boolean {
    return this.getTimeSinceLastLoad() >= this.pollIntervalMs;
  }

  /**
   * Clear cached data
   */
  clearCache(): void {
    this.cache = null;
    this.lastLoadTime = 0;
  }

  /**
   * Set polling interval in milliseconds
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;
  }
}
