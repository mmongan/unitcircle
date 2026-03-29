/**
 * Service for loading and managing graph data from different sources
 */
import type { GraphData } from './types';
import { createLogger } from './logger';

const log = createLogger('GraphLoader');

export class GraphLoader {
  private cache: GraphData | null = null;
  private lastLoadTime: number = 0;
  private lastSeenVersion: string = '';
  private lastLoggedGraphVersion: string = '';
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 2000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Check if graph has been updated without loading full graph
   * Polls lightweight version.json first, only loads graph.json if version changed
   */
  async checkForUpdates(): Promise<boolean> {
    try {
      const baseUrl = import.meta.env.BASE_URL;
      const versionUrl = `${baseUrl}version.json`;
      
      const response = await fetch(versionUrl);
      if (!response.ok) return false;
      
      const versionData = await response.json();
      const currentVersion = versionData.buildTime;
      
      if (currentVersion !== this.lastSeenVersion) {
        this.lastSeenVersion = currentVersion;
        return true;  // Version changed, should reload graph
      }
      
      return false;  // No update needed
    } catch (error) {
      log.warn('Error checking version', error);
      return false;
    }
  }

  /**
   * Load graph from appropriate source based on environment
   * Should only be called after checkForUpdates() returns true
   */
  async loadGraph(): Promise<GraphData | null> {
    try {
      // Use BASE_URL which respects Vite's base configuration
      // In dev: /unitcircle/ 
      // In prod: /unitcircle/
      const baseUrl = import.meta.env.BASE_URL;
      const url = `${baseUrl}graph.json`;
      
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        this.cache = data;
        this.lastLoadTime = Date.now();
        const graphVersion = data.lastUpdated || '';
        // Prime version tracking on the initial load so the first poll doesn't
        // immediately treat the current graph as a new update. This is safe as
        // long as graph.lastUpdated and version.json.buildTime are kept in sync.
        if (!this.lastSeenVersion && graphVersion) {
          this.lastSeenVersion = graphVersion;
        }
        if (graphVersion !== this.lastLoggedGraphVersion) {
          log.debug(`Loaded graph with ${data.nodes?.length || 0} functions and ${data.edges?.length || 0} calls`);
          this.lastLoggedGraphVersion = graphVersion;
        }
        return data;
      }
      
      log.warn(`Failed to load graph: ${response.status} ${response.statusText}`);
      // If fetch fails, try returning cached version
      if (this.cache) {
        log.warn('Using cached graph data');
        return this.cache;
      }
      return null;
    } catch (error) {
      log.error('Error loading graph', error);
      // Return cached version if available
      if (this.cache) {
        log.warn('Using cached graph data due to error');
        return this.cache;
      }
      return null;
    }
  }

  /**
   * Get cached graph data
   */
  getCachedGraph(): GraphData | null {
    return this.cache;
  }

  /**
   * Check if enough time has passed for next poll
   */
  shouldPoll(): boolean {
    const timeSinceLastLoad = Date.now() - this.lastLoadTime;
    return timeSinceLastLoad >= this.pollIntervalMs;
  }

  /**
   * Set polling interval in milliseconds
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = intervalMs;
  }
}
