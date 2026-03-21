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
      // Use BASE_URL which respects Vite's base configuration
      // In dev: /unitcircle/ 
      // In prod: /unitcircle/
      const baseUrl = import.meta.env.BASE_URL;
      const url = `${baseUrl}graph.json`;
      
      console.log(`📊 Loading graph from: ${url}`);
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        this.cache = data;
        this.lastLoadTime = Date.now();
        console.log(`✓ Loaded graph with ${data.nodes?.length || 0} functions and ${data.edges?.length || 0} calls`);
        return data;
      }
      
      console.warn(`Failed to load graph: ${response.status} ${response.statusText}`);
      // If fetch fails, try returning cached version
      if (this.cache) {
        console.warn('Using cached graph data');
        return this.cache;
      }
      return null;
    } catch (error) {
      console.error('Error loading graph:', error);
      // Return cached version if available
      if (this.cache) {
        console.warn('Using cached graph data due to error');
        return this.cache;
      }
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
